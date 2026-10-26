import type { ParseResult, TranscriptSegment } from '../shared/data-models'

export interface TextParserModule {
  parse(segment: TranscriptSegment): ParseResult
}
