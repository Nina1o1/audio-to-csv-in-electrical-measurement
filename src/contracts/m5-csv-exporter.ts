// Source: documentation/docs/public-interface.md. No business implementation.

import type { InspectionRecord } from '../shared/data-models'

export interface CsvExportOptions {
  filename?: string;
  includeBom?: boolean;
}

export interface CsvExportResult {
  filename: string;
  recordCount: number;
}

export type CsvExportErrorCode =
  | "EMPTY_RECORDS"
  | "INVALID_RECORD"
  | "INVALID_FILENAME"
  | "CSV_GENERATION_FAILED"
  | "DOWNLOAD_FAILED";

export interface CsvExportError extends Error {
  code: CsvExportErrorCode;
}

export interface CsvExporterModule {

  generateCsv(
    records: readonly InspectionRecord[]
  ): string;

  export(
    records: readonly InspectionRecord[],
    options?: CsvExportOptions
  ): CsvExportResult;
}
