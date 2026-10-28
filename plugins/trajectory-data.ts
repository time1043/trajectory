import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

export interface SourceFileEntry {
  path: string
  size: number
  mtimeMs: number
}

export interface SourceManifest {
  dirName: string
  files: SourceFileEntry[]
}

export const DATA_API_HMR_EVENT = 'trajectory:data-changed'

const MANIFEST_TTL_MS = 1000

/**
 * Dev-only data host for local trajectory exports.
 *
 * Serves only what the browser cannot get by itself:
 * 1. a manifest of the source directories under data/
 * 2. raw file bytes for paths that appear in a manifest
 * 3. chokidar watch -> HMR custom event when data changes
 *
 * All parsing/mapping stays in the browser (src/adapters/**) so adapters
 * remain isomorphic pure functions.
 */
export function trajectoryData(opts: { dataDir?: string } = {}): Plugin {
  const dataDir = opts.dataDir ?? 'data'
  let realRoot = ''
  let manifestCache: { at: number; value: SourceManifest[] } | null = null

  async function scan(): Promise<SourceManifest[]> {
    if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS)
      return manifestCache.value

    const manifests: SourceManifest[] = []
    let groups: string[] = []
    try {
      groups = await fsp.readdir(realRoot)
    }
    catch {
      return manifests
    }

    for (const group of groups) {
      const groupPath = path.join(realRoot, group)
      let stat: fs.Stats
      try {
        stat = await fsp.stat(groupPath)
      }
      catch {
        continue
      }
      if (!stat.isDirectory())
        continue

      let sources: string[] = []
      try {
        sources = await fsp.readdir(groupPath)
      }
      catch {
        continue
      }
      for (const source of sources.sort()) {
        const sourcePath = path.join(groupPath, source)
        let sourceStat: fs.Stats
        try {
          sourceStat = await fsp.stat(sourcePath)
        }
        catch {
          continue
        }
        if (!sourceStat.isDirectory())
          continue

        const files: SourceFileEntry[] = []
        const entries = await fsp.readdir(sourcePath, { withFileTypes: true })
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isFile())
            continue
          const filePath = path.join(sourcePath, entry.name)
          const fileStat = await fsp.stat(filePath)
          files.push({
            path: `${group}/${source}/${entry.name}`,
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
          })
        }
        manifests.push({ dirName: `${group}/${source}`, files })
      }
    }

    manifestCache = { at: Date.now(), value: manifests }
    return manifests
  }

  return {
    name: 'trajectory-data',
    enforce: 'pre',

    configResolved(config) {
      const root = path.resolve(config.root, dataDir)
      try {
        // data/ is a symlink to a directory outside the repo — resolve once
        realRoot = fs.realpathSync(root)
        config.server.fs.allow.push(realRoot)
      }
      catch {
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
          if (!filePath.startsWith(realRoot))
            return
          manifestCache = null
          if (timer)
            clearTimeout(timer)
          timer = setTimeout(() => {
            server.ws.send({
              type: 'custom',
              event: DATA_API_HMR_EVENT,
              data: { path: path.relative(realRoot, filePath) },
            })
          }, 250)
        }
        server.watcher.on('change', notify)
        server.watcher.on('add', notify)
        server.watcher.on('unlink', notify)
      }

      // ---- endpoints ----
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/@api/'))
          return next()

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
          const known = manifests.some(m => m.files.some(f => f.path === requested))
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
          }
          catch (error) {
            res.statusCode = 500
            res.end(String(error))
          }
          return
        }

        res.statusCode = 404
        res.end('not found')
      })

      // startup log, dev-tool style
      void scan().then((manifests) => {
        if (!manifests.length)
          return
        const list = manifests.map(m => `  · ${m.dirName} (${m.files.length} files)`).join('\n')
        server.config.logger.info(`[trajectory-data] sources:\n${list}`, { clear: false })
      })
    },
  }
}
