import type { Trajectory } from '../model/trajectory'
import type { SourceIndex } from './source-adapter'

/**
 * Redaction hook, applied in the ingest pipeline (after the adapter, before
 * the store). The adapter already masks profile PII at the type boundary;
 * text masking arms with the future share feature.
 */
export interface Sanitizer {
  sanitizeIndex(source: SourceIndex): SourceIndex
  sanitizeSession(trajectory: Trajectory): Trajectory
}
