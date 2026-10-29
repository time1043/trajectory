import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import type {
  SourceFileEntry,
  SourceManifest,
  SqliteQueryResult,
} from '../src/domain/ports/data-host.ts'

import { DATA_API_HMR_EVENT } from '../src/domain/ports/data-host.ts'

const MANIFEST_TTL_MS = 1000
const MAX_SCAN_FILES = 20000
const SQLITE_SUFFIXES = new Set(['.sqlite', '.sqlite3', '.db'])

// minimal structural typing so the plugin does not depend on @types/better-sqlite3 shapes
interface SqliteDatabase {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
  close(): void
}
type SqliteCtor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase

// lazily resolved so the plugin still loads without better-sqlite3 installed
let sqliteCtor: SqliteCtor | null | undefined
function getSqlite(): SqliteCtor | null {
  if (sqliteCtor !== undefined) return sqliteCtor
  try {
    sqliteCtor = createRequire(import.meta.url)('better-sqlite3') as unknown as SqliteCtor
  } catch {
    sqliteCtor = null
  }
  return sqliteCtor
}

/**
 * Dev-only data host for local trajectory exports.
 *
 * The node side stays format-agnostic; adapters own all schema knowledge:
 * 1. manifests of the source directories under data/ (recursive file listing)
 * 2. raw file bytes for paths that appear in a manifest
 * 3. read-only SQL over SQLite files that appear in a manifest — a read-only
 *    connection also sees WAL data, which a wasm single-file reader cannot
 * 4. chokidar watch -> HMR custom event when data changes
 */
export function trajectoryData(opts: { dataDir?: string } = {}): Plugin {
  const dataDir = opts.dataDir ?? 'data'
  let realRoot = ''
  let manifestCache: { at: number; value: SourceManifest[] } | null = null
  const sqliteHandles = new Map<string, SqliteDatabase>()

  async function scan(): Promise<SourceManifest[]> {
    if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value

    const manifests: SourceManifest[] = []
    let groups: string[] = []
    try {
      groups = await fsp.readdir(realRoot)
    } catch {
      return manifests
    }

    for (const group of groups) {
      const groupPath = path.join(realRoot, group)
      let groupStat: fs.Stats
      try {
        groupStat = await fsp.stat(groupPath)
      } catch {
        continue
      }
      if (!groupStat.isDirectory()) continue

      let sources: string[] = []
      try {
        sources = await fsp.readdir(groupPath)
      } catch {
        continue
      }
      for (const source of sources.sort()) {
        const sourcePath = path.join(groupPath, source)
        let sourceStat: fs.Stats
        try {
          sourceStat = await fsp.stat(sourcePath)
        } catch {
          continue
        }
        if (!sourceStat.isDirectory()) continue

        const files: SourceFileEntry[] = []
        const walk = async (dir: string, prefix: string): Promise<void> => {
          if (files.length >= MAX_SCAN_FILES) return
          let entries: fs.Dirent[]
          try {
            entries = await fsp.readdir(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const rel = `${prefix}${entry.name}`
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              await walk(full, `${rel}/`)
            } else if (entry.isFile()) {
              // transient sqlite sidecars and OS noise are not data
              if (entry.name.startsWith('.') || /-wal$|-shm$/.test(entry.name)) continue
              const fileStat = await fsp.stat(full)
              files.push({
                path: `${group}/${source}/${rel}`,
                size: fileStat.size,
                mtimeMs: fileStat.mtimeMs,
              })
            }
            if (files.length >= MAX_SCAN_FILES) return
          }
        }
        await walk(sourcePath, '')
        manifests.push({ dirName: `${group}/${source}`, files })
      }
    }

    manifestCache = { at: Date.now(), value: manifests }
    return manifests
  }

  function sqliteFor(requested: string): SqliteDatabase {
    const cached = sqliteHandles.get(requested)
    if (cached) return cached
    const Database = getSqlite()
    if (!Database) throw new Error('better-sqlite3 is not installed')
    const resolved = path.resolve(realRoot, requested)
    const db = new Database(resolved, { readonly: true, fileMustExist: true })
    sqliteHandles.set(requested, db)
    return db
  }

  function createApiMiddleware() {
    const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
      new Promise((resolve, reject) => {
        let body = ''
        req.on('data', (chunk: Buffer) => (body += chunk))
        req.on('end', () => resolve(body))
        req.on('error', reject)
      })

    return async (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
      next: (err?: unknown) => void,
    ) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith('/@api/')) return next()

      if (url.pathname === '/@api/sources') {
        const manifests = await scan()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(manifests))
        return
      }

      if (url.pathname === '/@api/file') {
        const requested = url.searchParams.get('path')
        if (!requested) {
          res.statusCode = 400
          res.end('missing ?path=')
          return
        }
        const manifests = await scan()
        const known = manifests.some((m) => m.files.some((f) => f.path === requested))
        if (!known) {
          res.statusCode = 404
          res.end('path not in manifest')
          return
        }
        const resolved = path.resolve(realRoot, requested)
        if (path.relative(realRoot, resolved).startsWith('..')) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        try {
          const body = await fsp.readFile(resolved)
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', body.byteLength)
          res.end(body)
        } catch (error) {
          res.statusCode = 500
          res.end(String(error))
        }
        return
      }

      if (url.pathname === '/@api/sqlite' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req)) as {
            path?: string
            sql?: string
            params?: unknown[]
          }
          if (!body.path || !body.sql) {
            res.statusCode = 400
            res.end('missing path or sql')
            return
          }
          const manifests = await scan()
          const known = manifests.some((m) =>
            m.files.some((f) => f.path === body.path && SQLITE_SUFFIXES.has(path.extname(f.path))),
          )
          if (!known) {
            res.statusCode = 404
            res.end('database not in manifest')
            return
          }
          if (path.relative(realRoot, path.resolve(realRoot, body.path)).startsWith('..')) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          if (!/^\s*(select|with)\b/i.test(body.sql)) {
            res.statusCode = 403
            res.end('read-only: only SELECT/WITH statements')
            return
          }
          const db = sqliteFor(body.path)
          const rows = db.prepare(body.sql).all(...(body.params ?? [])) as Record<string, unknown>[]
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ rows } satisfies SqliteQueryResult))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(error) }))
        }
        return
      }

      res.statusCode = 404
      res.end('not found')
    }
  }

  return {
    name: 'trajectory-data',
    enforce: 'pre',

    configResolved(config) {
      const root = path.resolve(config.root, dataDir)
      try {
        // data/ may be a symlink outside the repo — resolve once
        realRoot = fs.realpathSync(root)
        config.server.fs.allow.push(realRoot)
      } catch {
        realRoot = root
        config.logger.warn(`[trajectory-data] data dir not found: ${root}`)
      }
    },

    configureServer(server: ViteDevServer) {
      // ---- watch -> HMR ----
      if (realRoot) {
        server.watcher.add(realRoot)
        let timer: ReturnType<typeof setTimeout> | null = null
        const notify = (filePath: string) => {
          if (!filePath.startsWith(realRoot)) return
          manifestCache = null
          for (const [key, db] of sqliteHandles) {
            if (filePath.startsWith(path.resolve(realRoot, key))) {
              db.close()
              sqliteHandles.delete(key)
            }
          }
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            server.ws.send({
              type: 'custom',
              event: DATA_API_HMR_EVENT,
              data: { path: path.relative(realRoot, filePath) },
            })
          }, 500)
        }
        server.watcher.on('change', notify)
        server.watcher.on('add', notify)
        server.watcher.on('unlink', notify)
      }

      // ---- endpoints ----
      server.middlewares.use(createApiMiddleware())

      // startup log
      void scan().then((manifests) => {
        if (!manifests.length) return
        const list = manifests.map((m) => `  · ${m.dirName} (${m.files.length} files)`).join('\n')
        server.config.logger.info(`[trajectory-data] sources:\n${list}`, { clear: false })
      })
    },

    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(createApiMiddleware())
    },
  }
}
