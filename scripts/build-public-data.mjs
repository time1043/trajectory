#!/usr/bin/env node

/**
 * Converts the published dataset (data-public/) into static JSON files that
 * a GitHub Pages / Cloudflare Pages deployment can serve without a backend.
 *
 * Usage:  node scripts/build-public-data.mjs
 * Output: public/data/index.json          (session summaries)
 *         public/data/sessions/<id>.json  (one per session, full trajectory)
 *
 * Prerequisites: data-public/ must exist (scripts/init-data-dir.sh creates
 * the symlink) and contain only published sessions.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

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

async function main() {
  console.log('[build-public-data] scanning data-public/...')
  const manifests = await scan(ROOT)
  const summaries = []

  for (const manifest of manifests) {
    const dbFile = manifest.files.find((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))

    if (dbFile) {
      // sqlite source: query sessions + turn times via json_extract
      const db = new Database(dbFile.fullPath, { readonly: true })
      const sessions = db
        .prepare('SELECT id, title, time_created, time_updated FROM session ORDER BY time_updated DESC')
        .all()
      for (const s of sessions) {
        const turnRows = db
          .prepare(
            `SELECT m.time_created AS at FROM message m WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user' ORDER BY m.time_created`,
          )
          .all(s.id)
        summaries.push({
          id: `${manifest.provider}:${manifest.user}:${s.id}`,
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
      }
      db.close()
    } else {
      // jsonl source: parse each file, build a summary + body
      for (const file of manifest.files) {
        if (!file.path.endsWith('.jsonl')) continue
        const text = await fsp.readFile(file.fullPath, 'utf8')
        const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
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

        summaries.push({
          id: `${manifest.provider}:${manifest.user}:${sessionId}`,
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
        const bodyPath = path.join(SESSIONS_DIR, `${manifest.provider}:${manifest.user}:${sessionId}.json`)
        await fsp.mkdir(path.dirname(bodyPath), { recursive: true })
        await fsp.writeFile(bodyPath, JSON.stringify({ id: sessionId, lines }))
      }
    }
  }

  await fsp.mkdir(SESSIONS_DIR, { recursive: true })
  await fsp.writeFile(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify(summaries),
  )
  console.log(`[build-public-data] wrote ${summaries.length} session summaries to public/data/index.json`)
}

main()
