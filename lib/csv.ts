// A CSV file Excel opens with Hebrew intact (story 4.4): UTF-8 with a BOM,
// comma separator, CRLF line ends, every field quoted and `"` doubled. A
// cell that a spreadsheet would read as a formula (first character `=`, `+`,
// `-`, `@`, tab or CR) gets a leading `'`, so it shows as text (OWASP CSV
// injection guidance). The header row is always written, also with no rows.

const BOM = "\uFEFF"
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: string | null | undefined): string {
  const text = value ?? ""
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/** The whole file as text: BOM, the header row, then one line per row. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>
): string {
  const lines = [headers, ...rows].map((line) => line.map(cell).join(","))
  return `${BOM}${lines.join("\r\n")}\r\n`
}
