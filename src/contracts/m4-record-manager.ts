// Source: documentation/docs/public-interface.md. No business implementation.

import type { InspectionFields, InspectionRecord } from '../shared/data-models'

export type RecordSortField =
  | "workOrder"
  | "createdAt";

export type SortDirection =
  | "asc"
  | "desc";

export interface RecordQuery {

  workOrder?: string;

  createdFrom?: string;

  createdTo?: string;

  sortBy?: RecordSortField;

  sortDirection?: SortDirection;
}

export type RecordUpdate = Partial<InspectionFields>;

export type RecordErrorCode =
  | "NOT_INITIALIZED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_DATA_CORRUPTED"
  | "INVALID_DATA"
  | "INVALID_QUERY"
  | "RECORD_NOT_FOUND"
  | "DUPLICATE_ID";

export interface RecordManagerError extends Error {
  code: RecordErrorCode;
}

export interface RecordManagerModule {

  initialize(): InspectionRecord[];

  save(
    record: InspectionRecord
  ): InspectionRecord;

  getAll(): InspectionRecord[];

  getById(
    id: string
  ): InspectionRecord | null;

  query(
    query: RecordQuery
  ): InspectionRecord[];

  update(
    id: string,
    changes: RecordUpdate
  ): InspectionRecord;

  delete(
    id: string
  ): boolean;

  onRecordsChange(
    callback: (
      records: InspectionRecord[]
    ) => void
  ): () => void;
}
