// Compiled by vue-tsc, never executed. Each expect-error must remain a real error.
import type { SpeechRecognitionModule } from '@/contracts/m1-speech-recognition'
import type { TextParserModule } from '@/contracts/m2-text-parser'
import type { DraftManagerModule } from '@/contracts/m3-draft-manager'
import type { RecordManagerModule } from '@/contracts/m4-record-manager'
import type { CsvExporterModule } from '@/contracts/m5-csv-exporter'
import type {
  DraftFields,
  InspectionRecord,
  MeasurementUpdate,
  ParseResult,
  TranscriptSegment,
} from '@/shared/data-models'

export function verifyContracts(
  speech: SpeechRecognitionModule,
  parser: TextParserModule,
  draft: DraftManagerModule,
  records: RecordManagerModule,
  csv: CsvExporterModule,
  record: InspectionRecord,
  readonlyRecords: readonly InspectionRecord[],
) {
  const started: Promise<void> = speech.startListening()
  const unsubscribe: () => void = speech.onTranscriptComplete((segment) => {
    const input: TranscriptSegment = segment
    const parsed: ParseResult = parser.parse(input)
    const updated: DraftFields = draft.applyParseResult(parsed)
    void updated
  })
  const partial: MeasurementUpdate<'mΩ'> = { value: null }
  const sparse: ParseResult = { contactResistance: partial }
  draft.applyParseResult(sparse)
  draft.updateField('workOrder', null)
  draft.updateField('result', 'PASS')
  draft.updateMeasurement('contactResistance', 'value', 0)
  draft.updateMeasurement('contactResistance', 'unit', null)
  draft.updateMeasurement('insulationResistance', 'unit', 'MΩ')
  draft.updateMeasurement('withstandVoltage', 'unit', 'V')

  // @ts-expect-error Contact resistance cannot use the insulation unit.
  draft.updateMeasurement('contactResistance', 'unit', 'MΩ')
  // @ts-expect-error A measurement value is numeric or null, not a numeric string.
  draft.updateMeasurement('contactResistance', 'value', '12.5')
  // @ts-expect-error The result enum cannot accept arbitrary UI text.
  draft.updateField('result', '合格')
  // @ts-expect-error Measurements must use updateMeasurement, not updateField.
  draft.updateField('contactResistance', { value: 12.5, unit: 'mΩ' })

  const pending: InspectionRecord = draft.confirmSave()
  const persisted: InspectionRecord = records.save(pending)
  const found: InspectionRecord | null = records.getById(persisted.id)
  records.update(record.id, { contactResistance: { value: 12.5, unit: 'mΩ' } })
  records.query({ sortBy: 'createdAt', sortDirection: 'desc' })
  // @ts-expect-error A history measurement update must include its unit.
  records.update(record.id, { contactResistance: { value: 12.5 } })
  // @ts-expect-error History updates cannot change record identity.
  records.update(record.id, { id: 'replacement-id' })
  // @ts-expect-error Only the two contracted sort fields are supported.
  records.query({ sortBy: 'partNumber' })
  // @ts-expect-error Persisted measurement values cannot be null.
  const invalidRecord: InspectionRecord = { ...record, withstandVoltage: { value: null, unit: 'V' } }

  const content: string = csv.generateCsv(readonlyRecords)
  csv.export(readonlyRecords, { includeBom: true })
  // @ts-expect-error Drafts cannot be exported as official records.
  csv.generateCsv([draft.getDraft()])

  void [started, unsubscribe, found, invalidRecord, content]
}
