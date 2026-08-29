import { PERFORMANCE_EXPORT_VERSION, type ExportResult, type PerformanceReport } from './types'

function safeCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function exportReportJson(report: PerformanceReport): ExportResult {
  const envelope = { version: PERFORMANCE_EXPORT_VERSION, kind: 'performance_report', report }
  return { version: PERFORMANCE_EXPORT_VERSION, format: 'json', mimeType: 'application/json', filename: `${report.id}.performance.v${PERFORMANCE_EXPORT_VERSION}.json`, content: JSON.stringify(envelope, null, 2) }
}

export function exportReportCsv(report: PerformanceReport): ExportResult {
  const rows: unknown[][] = [[
    'version', 'dataset', 'id', 'store_id', 'keyword_or_metric', 'period_start', 'period_end', 'status', 'value', 'source',
  ]]
  for (const rank of report.ranks) rows.push([
    PERFORMANCE_EXPORT_VERSION, 'rank', rank.id, rank.storeId, rank.keywordId, rank.observedOn, rank.observedOn,
    rank.status, rank.status === 'ranked' ? rank.rank : '', rank.source,
  ])
  for (const insight of report.insights) rows.push([
    PERFORMANCE_EXPORT_VERSION, 'gbp_insight', insight.id, insight.storeId, insight.metric, insight.periodStart,
    insight.periodEnd, 'measured', insight.value, insight.source,
  ])
  return {
    version: PERFORMANCE_EXPORT_VERSION, format: 'csv', mimeType: 'text/csv;charset=utf-8',
    filename: `${report.id}.performance.v${PERFORMANCE_EXPORT_VERSION}.csv`, content: rows.map((row) => row.map(safeCell).join(',')).join('\r\n'),
  }
}
