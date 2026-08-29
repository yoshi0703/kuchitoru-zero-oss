const FORMULA_PREFIX = /^[ \u00a0]*[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

export function sanitizeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)

  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`
  }

  if (NEEDS_QUOTES.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

export function createCsv(rows: readonly (readonly unknown[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(sanitizeCsvCell).join(',')).join('\r\n')}\r\n`
}
