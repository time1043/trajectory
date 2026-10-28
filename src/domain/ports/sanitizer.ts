import type { ParsedSource } from '../model/trajectory'

/**
 * Redaction hook, applied in the ingest pipeline (after the adapter, before
 * the store). The adapter already masks profile PII at the type boundary;
 * text masking arms with the future share feature.
 */
export interface Sanitizer {
  sanitize(source: ParsedSource): ParsedSource
}
