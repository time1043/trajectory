#!/usr/bin/env node

/**
 * Converts the published dataset (data-public/) into static JSON files that
 * a GitHub Pages / Cloudflare Pages deployment can serve without a backend.
 *
 * Usage:  node scripts/build-public-data.mjs
 * Output: public/data/index.json          (session summaries, all sources)
 *         public/data/sessions/<id>.json  (one per session: the session's RAW
 *         body — jsonl lines for file sources, the per-session sqlite rows for
 *         zcode/opencode sources — re-parsed by the app's adapters in static
 *         mode, see src/app/stores/static-data.ts)
 *
 * public/data/ is wiped on every run: a session unpublished since the last
 * build must not linger in the output.
 *
 * Prerequisites: data-public/ must exist (scripts/init-data-dir.sh creates
 * the symlink) and contain only published sessions. The publish flow copies
 * whole .jsonl files or mirrors sqlite rows per session, so every source the
 * reading view can publish is covered here.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const ROOT = path.resolve('data-public')
const OUT_DIR = path.resolve('public/data')
const SESSIONS_DIR = path.join(OUT_DIR, 'sessions')

const SQLITE_SUFFIXES = new Set(['.sqlite', '.sqlite3', '.db'])

async function walk(dir, prefix, files) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${prefix}${entry.name}`
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, `${rel}/`, files)
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.') || /-wal$|-shm$/.test(entry.name)) continue
      const stat = await fsp.stat(full)
      files.push({ path: rel, fullPath: full, size: stat.size })
    }
  }
}

async function scan(root) {
  const manifests = []
  let groups
  try {
    groups = await fsp.readdir(root)
  } catch {
    return manifests
  }
  for (const group of groups) {
    const groupPath = path.join(root, group)
    let providers
    try {
      providers = await fsp.readdir(groupPath)
    } catch {
      continue
    }
    for (const provider of providers.sort()) {
      const providerPath = path.join(groupPath, provider)
      let users
      try {
        users = await fsp.readdir(providerPath)
      } catch {
        continue
      }
      for (const user of users.sort()) {
        const sourcePath = path.join(providerPath, user)
        try {
          if (!fs.statSync(sourcePath).isDirectory()) continue
        } catch {
          continue
        }
        const files = []
        await walk(sourcePath, '', files)
        manifests.push({ dirName: `${group}/${provider}/${user}`, provider, user, files })
      }
    }
  }
  return manifests
}

async function writeSessionBody(id, body) {
  const bodyPath = path.join(SESSIONS_DIR, `${id}.json`)
  await fsp.mkdir(path.dirname(bodyPath), { recursive: true })
  await fsp.writeFile(bodyPath, JSON.stringify(body))
}

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name)))
}

/**
 * sqlite source (zcode / opencode — opencode-family schema): one summary plus
 * one body file per session. The body stores exactly the rows the adapter's
 * three per-session queries return; column availability decides the dialect
 * (zcode has `sequence` ordering, opencode orders by time/id).
 */
async function emitSqliteSource(manifest, dbFile, summaries) {
  const db = new Database(dbFile.fullPath, { readonly: true })
  try {
    const messageCols = columnNames(db, 'message')
    if (!messageCols.has('id') || !messageCols.has('data')) {
      throw new Error('message table lacks id/data — not an opencode-family schema')
    }
    const sequenced = messageCols.has('sequence')
    const messageOrder = sequenced ? 'sequence, time_created' : 'time_created, id'
    const partOrder = sequenced ? 'sequence' : 'time_created, id'
    const partCols = columnNames(db, 'part')
    const partSelect = [
      'message_id',
      ...(sequenced ? ['sequence'] : []),
      ...(partCols.has('time_created') ? ['time_created'] : []),
      'data',
    ].join(', ')

    const sessions = db
      .prepare('SELECT id, title, time_created, time_updated FROM session ORDER BY time_updated DESC')
      .all()
    const messageStmt = db.prepare(
      `SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY ${messageOrder}`,
    )
    const partStmt = db.prepare(
      `SELECT ${partSelect} FROM part WHERE session_id = ? ORDER BY ${partOrder}`,
    )
    const turnStmt = db.prepare(
      `SELECT m.time_created AS at FROM message m WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user' ORDER BY m.time_created`,
    )

    for (const s of sessions) {
      const turnRows = turnStmt.all(s.id)
      const id = `${manifest.provider}:${manifest.user}:${s.id}`
      summaries.push({
        id,
        sessionId: s.id,
        provider: manifest.provider,
        user: manifest.user,
        title: s.title,
        startedAt: s.time_created,
        updatedAt: s.time_updated,
        turnStarts: turnRows.map((r) => r.at),
        messageCount: turnRows.length,
        firstPrompt: '',
      })
      // the raw per-session rows; the app's adapter re-parses them in static mode
      await writeSessionBody(id, {
        id: s.id,
        session: [s],
        messages: messageStmt.all(s.id),
        parts: partStmt.all(s.id),
      })
    }
  } finally {
    db.close()
  }
}

async function main() {
  console.log('[build-public-data] scanning data-public/...')
  const manifests = await scan(ROOT)
  const summaries = []

  await fsp.rm(OUT_DIR, { recursive: true, force: true })
  await fsp.mkdir(SESSIONS_DIR, { recursive: true })

  for (const manifest of manifests) {
    const dbFile = manifest.files.find((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))

    if (dbFile) {
      try {
        await emitSqliteSource(manifest, dbFile, summaries)
      } catch (error) {
        console.warn(`[build-public-data] skipping ${manifest.dirName}: ${error.message}`)
      }
    } else {
      // jsonl source: parse each file, build a summary + body
      for (const file of manifest.files) {
        if (!file.path.endsWith('.jsonl')) continue
        const text = await fsp.readFile(file.fullPath, 'utf8')
        const lines = text
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
        const sessionId = file.path.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] ?? file.path
        const timestamps = lines.filter((l) => l.timestamp).map((l) => Date.parse(l.timestamp))
        const userLines = lines.filter((l) => l.type === 'user' || l.message?.role === 'user')
        const firstPrompt =
          lines
            .filter((l) => l.type === 'user' || l.message?.role === 'user')
            .map((l) => {
              const c = l.message?.content
              if (typeof c === 'string') return c
              if (Array.isArray(c)) {
                for (const item of c) {
                  if (item?.type === 'text' && item.text) return item.text
                }
              }
              return ''
            })
            .find((t) => t.trim()) ?? ''

        const id = `${manifest.provider}:${manifest.user}:${sessionId}`
        summaries.push({
          id,
          sessionId,
          provider: manifest.provider,
          user: manifest.user,
          title: lines.find((l) => l.aiTitle)?.aiTitle || firstPrompt.slice(0, 80) || '(untitled)',
          startedAt: timestamps.length ? Math.min(...timestamps) : 0,
          updatedAt: timestamps.length ? Math.max(...timestamps) : 0,
          turnStarts: [],
          messageCount: lines.length,
          firstPrompt,
        })

        // write the full body
        await writeSessionBody(id, { id: sessionId, lines })
      }
    }
  }

  await fsp.writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(summaries))
  console.log(
    `[build-public-data] wrote ${summaries.length} session summaries to public/data/index.json`,
  )
}

main()
