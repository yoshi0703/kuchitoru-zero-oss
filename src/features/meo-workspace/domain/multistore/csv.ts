import type { Locale } from '../../../../shared/i18n'

export const STORE_CSV_VERSION = 'kuchitoru-zero-stores/v1'
export const STORE_CSV_HEADERS = ['store_id', 'name', 'location_code', 'group_id'] as const

export interface StoreCsvRow { storeId: string; name: string; locationCode: string; groupId?: string }
export interface CsvValidationError { row: number; column?: string; code: 'invalid_version' | 'invalid_header' | 'malformed_csv' | 'required' | 'duplicate_store_id'; message: string }
export interface CsvImportResult { version?: string; rows: StoreCsvRow[]; errors: CsvValidationError[] }

function parseRecords(input: string): { records: string[][]; malformedRows: number[] } {
  const records: string[][] = []; const malformedRows: number[] = []
  let record: string[] = []; let field = ''; let quoted = false; let row = 1
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted && char === '"' && input[index + 1] === '"') { field += '"'; index += 1 }
    else if (char === '"' && field.length === 0) quoted = true
    else if (char === '"' && quoted) quoted = false
    else if (char === ',' && !quoted) { record.push(field); field = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      record.push(field); records.push(record); record = []; field = ''; row += 1
    } else field += char
  }
  if (quoted) malformedRows.push(row)
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record) }
  return { records, malformedRows }
}

export function parseStoreCsv(input: string, locale: Locale = 'ja'): CsvImportResult {
  const normalized = input.replace(/^\uFEFF/, '')
  const { records, malformedRows } = parseRecords(normalized)
  const messages = locale === 'ja' ? {
    unclosed: '引用符付きフィールドが閉じられていません', expectedVersion: `${STORE_CSV_VERSION}が必要です`,
    expectedHeader: (header: string) => `ヘッダー${header}が必要です`, headerCount: 'ヘッダー数が正しくありません',
    required: (column: string) => `${column}は必須です`, columnCount: '列数が正しくありません', duplicate: 'store_idが重複しています',
  } : {
    unclosed: 'Unclosed quoted field', expectedVersion: `Expected ${STORE_CSV_VERSION}`,
    expectedHeader: (header: string) => `Expected header ${header}`, headerCount: 'Unexpected header count',
    required: (column: string) => `${column} is required`, columnCount: 'Unexpected column count', duplicate: 'Duplicate store_id',
  }
  const errors: CsvValidationError[] = malformedRows.map((row) => ({ row, code: 'malformed_csv', message: messages.unclosed }))
  const version = records[0]?.[0]
  if (version !== STORE_CSV_VERSION) errors.push({ row: 1, code: 'invalid_version', message: messages.expectedVersion })
  const headers = records[1] ?? []
  STORE_CSV_HEADERS.forEach((header, index) => { if (headers[index] !== header) errors.push({ row: 2, column: header, code: 'invalid_header', message: messages.expectedHeader(header) }) })
  if (headers.length !== STORE_CSV_HEADERS.length) errors.push({ row: 2, code: 'invalid_header', message: messages.headerCount })
  const rows: StoreCsvRow[] = []; const seen = new Set<string>()
  records.slice(2).forEach((values, index) => {
    const row = index + 3
    if (values.length === 1 && values[0] === '') return
    const [storeId = '', name = '', locationCode = '', groupId = ''] = values
    ;([[storeId, 'store_id'], [name, 'name'], [locationCode, 'location_code']] satisfies [string, string][]).forEach(([value, column]) => {
      if (!value.trim()) errors.push({ row, column, code: 'required', message: messages.required(column) })
    })
    if (values.length !== STORE_CSV_HEADERS.length) errors.push({ row, code: 'invalid_header', message: messages.columnCount })
    if (storeId && seen.has(storeId)) errors.push({ row, column: 'store_id', code: 'duplicate_store_id', message: messages.duplicate })
    seen.add(storeId)
    rows.push({ storeId, name, locationCode, ...(groupId ? { groupId } : {}) })
  })
  return { ...(version === undefined ? {} : { version }), rows, errors }
}

function escapeCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function exportStoreCsv(rows: readonly StoreCsvRow[]): string {
  const lines = [STORE_CSV_VERSION, STORE_CSV_HEADERS.join(',')]
  for (const row of rows) lines.push([row.storeId, row.name, row.locationCode, row.groupId ?? ''].map(escapeCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
