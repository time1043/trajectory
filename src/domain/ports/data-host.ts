/**
 * DataHost 端口 — 数据宿主（本地为 vite 插件 plugins/trajectory-data.ts）向浏览器暴露的契约。
 * node 侧只做文件系统：清单 + 字节流 + watch。
 */

export interface SourceFileEntry {
  path: string
  size: number
  mtimeMs: number
}

export interface SourceManifest {
  /** 相对 data/ 的两级路径，如 'web/deepseek' */
  dirName: string
  files: SourceFileEntry[]
}

/** manifest 中登记的路径之外一律拒绝取用 */
export type FetchDataFile = (path: string) => Promise<ArrayBuffer>

/** 数据变化事件（HMR custom event payload） */
export interface DataChangeEvent {
  path: string
}

/** HMR custom event 名（node 侧插件 plugins/trajectory-data.ts 使用同名常量，改动需两侧同步） */
export const DATA_API_HMR_EVENT = 'trajectory:data-changed'
