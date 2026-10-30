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
  readonly open: boolean
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
  }
  exec(sql: string): unknown
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

export const DATA_DIR = 'data'
export const DATA_PUBLIC_DIR = 'data-public'

/**
 * Dev-only data host for local trajectory exports.
 *
 * The node side stays format-agnostic; adapters own all schema knowledge:
 * 1. manifests of the source directories under data/ (recursive file listing)
 * 2. raw file bytes for paths that appear in a manifest
 * 3. read-only SQL over SQLite files that appear in a manifest — a read-only
 *    connection also sees WAL data, which a wasm single-file reader cannot
 * 4. publish/unpublish: copy or remove one session's data under data-public/
 * 5. chokidar watch -> HMR custom event when data changes
 *
 * Two roots: the dev server serves data/ (everything), `vite preview` serves
 * data-public/ (only published sessions) — the operator's view of what a
 * static deployment would show.
 */
export function trajectoryData(opts: { dataDir?: string } = {}): Plugin {
  const dataDir = opts.dataDir ?? DATA_DIR
  let realRoot = ''
  let publicRoot = ''

  interface RootContext {
    root: string
    scan(): Promise<SourceManifest[]>
    sqliteFor(requested: string): SqliteDatabase
    dropHandlesFor(prefix: string): void
  }

  function makeContext(root: string): RootContext {
    let manifestCache: { at: number; value: SourceManifest[] | null } = { at: 0, value: null }
    const sqliteHandles = new Map<string, SqliteDatabase>()

    async function scan(): Promise<SourceManifest[]> {
      if (manifestCache.value && Date.now() - manifestCache.at < MANIFEST_TTL_MS)
        return manifestCache.value

      const manifests: SourceManifest[] = []
      let groups: string[] = []
      try {
        groups = await fsp.readdir(root)
      } catch {
        manifestCache = { at: Date.now(), value: manifests }
        return manifests
      }

      for (const group of groups) {
        const groupPath = path.join(root, group)
        let groupStat: fs.Stats
        try {
          groupStat = await fsp.stat(groupPath)
        } catch {
          continue
        }
        if (!groupStat.isDirectory()) continue

        // layout: <group>/<provider>/<user>/<data...>
        let providers: string[] = []
        try {
          providers = await fsp.readdir(groupPath)
        } catch {
          continue
        }
        for (const provider of providers.sort()) {
          const providerPath = path.join(groupPath, provider)
          let users: string[] = []
          try {
            users = await fsp.readdir(providerPath)
          } catch {
            continue
          }
          for (const user of users.sort()) {
            const sourcePath = path.join(providerPath, user)
            let sourceStat: fs.Stats
            try {
              sourceStat = await fsp.stat(sourcePath)
            } catch {
              continue
            }
            if (!sourceStat.isDirectory()) continue
            const dirName = `${group}/${provider}/${user}`

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
                    path: `${dirName}/${rel}`,
                    size: fileStat.size,
                    mtimeMs: fileStat.mtimeMs,
                  })
                }
                if (files.length >= MAX_SCAN_FILES) return
              }
            }
            await walk(sourcePath, '')
            manifests.push({ dirName, files })
          }
        }
      }

      manifestCache = { at: Date.now(), value: manifests }
      return manifests
    }

    function sqliteFor(requested: string): SqliteDatabase {
      const cached = sqliteHandles.get(requested)
      // a closed handle can linger after dropHandlesFor raced with an in-flight query
      if (cached) {
        if (cached.open) return cached
        sqliteHandles.delete(requested)
      }
      const Database = getSqlite()
      if (!Database) throw new Error('better-sqlite3 is not installed')
      const resolved = path.resolve(root, requested)
      const db = new Database(resolved, { readonly: true, fileMustExist: true })
      sqliteHandles.set(requested, db)
      return db
    }

    function dropHandlesFor(prefix: string): void {
      manifestCache = { at: 0, value: null }
      for (const [key, db] of sqliteHandles) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          db.close()
          sqliteHandles.delete(key)
        }
      }
    }

    return { root, scan, sqliteFor, dropHandlesFor }
  }

  // contexts are created after configResolved resolves the real paths
  let dev: RootContext | null = null
  let preview: RootContext | null = null

  async function readTags(dir: string): Promise<Record<string, string[]>> {
    const filePath = path.join(dir, 'tags.json')
    try {
      const raw = await fsp.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string[]>)
        : {}
    } catch {
      return {}
    }
  }

  async function writeTags(dir: string, tags: Record<string, string[]>): Promise<void> {
    const filePath = path.join(dir, 'tags.json')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(filePath, JSON.stringify(tags, null, 2) + '\n', 'utf-8')
  }

  /** One published session = one normalized body file + the shared index. */
  function publishEndpoints(privateCtx: RootContext, publicCtx: RootContext) {
    const publicRoot = publicCtx.root
    async function publishedList(): Promise<unknown> {
      const manifests = await publicCtx.scan()
      const out: { dirName: string; provider: string; user: string; sessionIds: string[] }[] = []
      for (const m of manifests) {
        const [, provider, user] = m.dirName.split('/')
        const dbFile = m.files.find((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))
        const sessionIds: string[] = []
        if (dbFile) {
          try {
            const rows = publicCtx
              .sqliteFor(dbFile.path)
              .prepare('SELECT id FROM session')
              .all() as {
              id: string
            }[]
            sessionIds.push(...rows.map((r) => String(r.id)))
          } catch {
            // an unreadable public db publishes nothing
          }
        } else {
          for (const f of m.files) {
            const uuid =
              /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(
                f.path,
              )?.[1]
            if (uuid) sessionIds.push(uuid)
          }
        }
        out.push({ dirName: m.dirName, provider, user, sessionIds })
      }
      return out
    }

    async function publishOne(payload: {
      provider: string
      user: string
      sessionId: string
      publish: boolean
    }): Promise<unknown> {
      const manifests = await privateCtx.scan()
      const suffix = `${payload.provider}/${payload.user}`
      const manifest = manifests.find((m) => m.dirName.endsWith(suffix))
      if (!manifest) throw new Error(`source not found: ${suffix}`)

      const publicSourceDir = path.join(publicRoot, manifest.dirName)
      await fsp.mkdir(publicSourceDir, { recursive: true })

      const dbFile = manifest.files.find((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))
      if (dbFile) {
        // sqlite sources: copy the session's rows into a mirrored public db
        const publicDbPath = path.join(publicRoot, dbFile.path)
        const Database = getSqlite()
        if (!Database) throw new Error('better-sqlite3 is not installed')
        const privateDb = privateCtx.sqliteFor(dbFile.path)
        const publicDb = new Database(publicDbPath)

        try {
          if (payload.publish) {
            // mirror the schema once (tables then the rest), straight from the private db;
            // rewrite CREATE to CREATE IF NOT EXISTS so re-publishing doesn't collide
            const schema = privateDb
              .prepare(
                "SELECT sql FROM sqlite_master WHERE sql NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
              )
              .all() as { sql: string }[]
            for (const { sql } of schema) {
              publicDb.exec(
                sql.replace(
                  /^CREATE\s+(UNIQUE\s+INDEX|INDEX|TABLE|TRIGGER|VIEW)(\s+IF\s+NOT\s+EXISTS)?/i,
                  'CREATE $1 IF NOT EXISTS',
                ),
              )
            }

            const insert = (table: string, rows: Record<string, unknown>[]) => {
              for (const row of rows) {
                const cols = Object.keys(row)
                publicDb
                  .prepare(
                    `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
                  )
                  .run(...cols.map((c) => row[c]))
              }
            }
            insert(
              'session',
              privateDb
                .prepare('SELECT * FROM session WHERE id = ?')
                .all(payload.sessionId) as Record<string, unknown>[],
            )
            insert(
              'message',
              privateDb
                .prepare('SELECT * FROM message WHERE session_id = ?')
                .all(payload.sessionId) as Record<string, unknown>[],
            )
            insert(
              'part',
              privateDb
                .prepare('SELECT * FROM part WHERE session_id = ?')
                .all(payload.sessionId) as Record<string, unknown>[],
            )
          } else {
            const hasTable = publicDb
              .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'")
              .get()
            if (hasTable) {
              publicDb.prepare('DELETE FROM part WHERE session_id = ?').run(payload.sessionId)
              publicDb.prepare('DELETE FROM message WHERE session_id = ?').run(payload.sessionId)
              publicDb.prepare('DELETE FROM session WHERE id = ?').run(payload.sessionId)
            }
          }
        } finally {
          publicDb.close()
        }
      } else {
        // jsonl sources: one file per session, the BASE name carries the id
        // (subagent files only contain the parent id in their directory path)
        const file = manifest.files.find((f) => path.basename(f.path).includes(payload.sessionId))
        if (!file) throw new Error(`session file not found: ${payload.sessionId}`)
        const target = path.join(publicRoot, file.path)
        if (payload.publish) {
          await fsp.mkdir(path.dirname(target), { recursive: true })
          await fsp.copyFile(path.resolve(privateCtx.root, file.path), target)
        } else {
          await fsp.rm(target, { force: true })
        }
      }

      // sync tags for this session between data/tags.json and data-public/tags.json
      const trajectoryId = `${payload.provider}:${payload.user}:${payload.sessionId}`
      const privateTags = await readTags(privateCtx.root)
      const publicTags = await readTags(publicRoot)
      if (payload.publish) {
        if (privateTags[trajectoryId]?.length) {
          publicTags[trajectoryId] = privateTags[trajectoryId]
        } else {
          delete publicTags[trajectoryId]
        }
      } else {
        delete publicTags[trajectoryId]
      }
      await writeTags(publicRoot, publicTags)

      publicCtx.dropHandlesFor(manifest.dirName)
      return { ok: true, published: payload.publish, list: await publishedList() }
    }

    return { publishedList, publishOne }
  }

  function makeApiMiddleware(
    ctx: RootContext,
    publicCtx: RootContext | null,
    allowMutations = true,
  ) {
    const { publishedList, publishOne } = publicCtx
      ? publishEndpoints(ctx, publicCtx)
      : { publishedList: null, publishOne: null }

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
        const manifests = await ctx.scan()
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
        const manifests = await ctx.scan()
        const known = manifests.some((m) => m.files.some((f) => f.path === requested))
        if (!known) {
          res.statusCode = 404
          res.end('path not in manifest')
          return
        }
        const resolved = path.resolve(ctx.root, requested)
        if (path.relative(ctx.root, resolved).startsWith('..')) {
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
          const manifests = await ctx.scan()
          const known = manifests.some((m) =>
            m.files.some((f) => f.path === body.path && SQLITE_SUFFIXES.has(path.extname(f.path))),
          )
          if (!known) {
            res.statusCode = 404
            res.end('database not in manifest')
            return
          }
          if (path.relative(ctx.root, path.resolve(ctx.root, body.path)).startsWith('..')) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          if (!/^\s*(select|with)\b/i.test(body.sql)) {
            res.statusCode = 403
            res.end('read-only: only SELECT/WITH statements')
            return
          }
          const db = ctx.sqliteFor(body.path)
          const rows = db.prepare(body.sql).all(...(body.params ?? [])) as Record<string, unknown>[]
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ rows } satisfies SqliteQueryResult))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(error) }))
        }
        return
      }

      if (url.pathname === '/@api/tags') {
        if (req.method === 'GET') {
          const tags = await readTags(ctx.root)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(tags))
          return
        }

        if (req.method === 'POST') {
          if (!allowMutations) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'tags editing is disabled in preview' }))
            return
          }
          try {
            const body = JSON.parse(await readBody(req)) as {
              trajectoryId?: string
              tags?: string[]
              allTags?: Record<string, string[]>
            }
            const currentTags = await readTags(ctx.root)
            let touchedId: string | null = null
            if (body.trajectoryId && Array.isArray(body.tags)) {
              touchedId = body.trajectoryId
              if (body.tags.length > 0) {
                currentTags[body.trajectoryId] = body.tags
              } else {
                delete currentTags[body.trajectoryId]
              }
            } else if (body.allTags && typeof body.allTags === 'object') {
              for (const [id, t] of Object.entries(body.allTags)) {
                if (Array.isArray(t) && t.length > 0) {
                  currentTags[id] = t
                } else {
                  delete currentTags[id]
                }
              }
            } else if (typeof body === 'object' && !body.trajectoryId) {
              for (const [id, t] of Object.entries(body)) {
                if (Array.isArray(t) && t.length > 0) {
                  currentTags[id] = t
                } else {
                  delete currentTags[id]
                }
              }
            }
            await writeTags(ctx.root, currentTags)

            // If a session was updated and is currently published in publicCtx, sync public tags
            if (publicCtx) {
              if (touchedId) {
                const [pProvider, pUser, ...rest] = touchedId.split(':')
                const pSessionId = rest.join(':')
                const pubManifests = await publicCtx.scan()
                const isPublished = pubManifests.some((m) => {
                  const [, prov, usr] = m.dirName.split('/')
                  if (prov !== pProvider || usr !== pUser) return false
                  const isSqlite = m.files.some((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))
                  if (isSqlite) {
                    try {
                      const dbFile = m.files.find((f) => SQLITE_SUFFIXES.has(path.extname(f.path)))!
                      const row = publicCtx
                        .sqliteFor(dbFile.path)
                        .prepare('SELECT 1 FROM session WHERE id = ?')
                        .get(pSessionId)
                      return Boolean(row)
                    } catch {
                      return false
                    }
                  }
                  return m.files.some((f) => path.basename(f.path).includes(pSessionId))
                })

                if (isPublished) {
                  const pubTags = await readTags(publicCtx.root)
                  if (currentTags[touchedId]?.length) {
                    pubTags[touchedId] = currentTags[touchedId]
                  } else {
                    delete pubTags[touchedId]
                  }
                  await writeTags(publicCtx.root, pubTags)
                }
              } else if (publishedList) {
                const published = (await publishedList()) as {
                  provider: string
                  user: string
                  sessionIds: string[]
                }[]
                const pubTags = await readTags(publicCtx.root)
                let changed = false
                for (const entry of published) {
                  for (const sId of entry.sessionIds) {
                    const id = `${entry.provider}:${entry.user}:${sId}`
                    if (currentTags[id]?.length) {
                      if (JSON.stringify(pubTags[id]) !== JSON.stringify(currentTags[id])) {
                        pubTags[id] = currentTags[id]
                        changed = true
                      }
                    } else if (pubTags[id]) {
                      delete pubTags[id]
                      changed = true
                    }
                  }
                }
                if (changed) await writeTags(publicCtx.root, pubTags)
              }
            }

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(currentTags))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(error) }))
          }
          return
        }
      }

      if (url.pathname === '/@api/published' && publishedList) {
        try {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(await publishedList()))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(error) }))
        }
        return
      }

      if (url.pathname === '/@api/publish' && req.method === 'POST') {
        if (!allowMutations || !publishOne) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'publishing is disabled in preview' }))
          return
        }
        try {
          const body = JSON.parse(await readBody(req)) as {
            provider?: string
            user?: string
            sessionId?: string
            publish?: boolean
          }
          if (!body.provider || !body.user || !body.sessionId) {
            res.statusCode = 400
            res.end('missing provider/user/sessionId')
            return
          }
          const result = await publishOne({
            provider: body.provider,
            user: body.user,
            sessionId: body.sessionId,
            publish: body.publish !== false,
          })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
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
        // data/ may be a symlink to a directory outside the repo — resolve once
        realRoot = fs.realpathSync(root)
        config.server.fs.allow.push(realRoot)
      } catch {
        realRoot = root
        config.logger.warn(`[trajectory-data] data dir not found: ${root}`)
      }

      // preview serves the public dataset; fall back to the private root
      const publicCandidate = path.resolve(config.root, DATA_PUBLIC_DIR)
      try {
        publicRoot = fs.realpathSync(publicCandidate)
        config.server.fs.allow.push(publicRoot)
      } catch {
        publicRoot = realRoot
      }

      dev = makeContext(realRoot)
      preview = makeContext(publicRoot)
    },

    configureServer(server: ViteDevServer) {
      const ctx = dev!
      const pub = preview!

      // ---- watch -> HMR ----
      server.watcher.add(ctx.root)
      let timer: ReturnType<typeof setTimeout> | null = null
      // dirNames touched since the last send — one event per debounce window
      const pendingDirNames = new Set<string>()
      const notify = (filePath: string) => {
        if (!filePath.startsWith(ctx.root)) return
        // transient sqlite sidecars are written constantly by live agents — a
        // read-only connection sees WAL data anyway, so they are not changes;
        // tags.json is managed by its own endpoints and store invalidation
        const base = path.basename(filePath)
        if (base.startsWith('.') || base === 'tags.json' || /-wal$|-shm$/.test(base)) return
        // a source is the first three segments under the root: <group>/<provider>/<user>
        const dirName = path.relative(ctx.root, filePath).split(path.sep).slice(0, 3).join(path.sep)
        ctx.dropHandlesFor(dirName)
        pendingDirNames.add(dirName)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          const dirNames = [...pendingDirNames]
          pendingDirNames.clear()
          server.ws.send({
            type: 'custom',
            event: DATA_API_HMR_EVENT,
            data: { dirNames },
          })
        }, 500)
      }
      server.watcher.on('change', notify)
      server.watcher.on('add', notify)
      server.watcher.on('unlink', notify)

      server.middlewares.use(makeApiMiddleware(ctx, pub, true))

      // startup log
      void ctx.scan().then((manifests) => {
        if (!manifests.length) return
        const list = manifests.map((m) => `  · ${m.dirName} (${m.files.length} files)`).join('\n')
        server.config.logger.info(`[trajectory-data] sources:\n${list}`, { clear: false })
      })
    },

    configurePreviewServer(server: PreviewServer) {
      const ctx = preview!
      // in preview the ctx IS the public dataset — publishedList derives from it,
      // but mutations (publishing / tag editing) are disabled
      server.middlewares.use(makeApiMiddleware(ctx, ctx, false))

      void ctx.scan().then((manifests) => {
        const list = manifests.map((m) => `  · ${m.dirName} (${m.files.length} files)`).join('\n')
        server.config.logger.info(`[trajectory-data] public sources:\n${list}`, { clear: false })
      })
    },
  }
}
