import type { ParsedSource } from '../model/trajectory'

/**
 * Sanitizer — 脱敏钩子。位于 ingest 管道（adapter 之后、store 之前）收口，
 * 不放 adapter（避免每来源重写一遍正则），不放 UI（必漏）。
 * 本期默认仅掩码 profile；文本脱敏待"分享"需求落地时启用实现。
 */
export interface Sanitizer {
  sanitize(source: ParsedSource): ParsedSource
}
