/**
 * A generic admin table editor for data sets that moved off Google Sheets (plans/sheets-cutover.md
 * 3.1 step 5: whatever people edited in the sheet gets an editor before the sheet is frozen).
 *
 * The page sends the whole list back. Rows are matched by the data set's natural key: new keys are
 * created, changed rows updated, and rows that disappeared are marked inactive (never deleted), so
 * an edit can always be undone.
 */

export type CellValue = string | number | boolean | null

export interface EditorColumn {
  key: string
  label: string
  kind: 'text' | 'int' | 'bool'
  maxLength?: number
  required?: boolean
  /** Shown, not edited (e.g. a derived id). */
  readOnly?: boolean
  /** Not shown at all (still carried back, e.g. a row id). */
  hidden?: boolean
  placeholder?: string
}

export type EditorRow = Record<string, CellValue>

export interface SaveCounts {
  created: number
  updated: number
  deactivated: number
  unchanged: number
}

export interface EditorSpec {
  dataset: string
  label: string
  help: string
  columns: EditorColumn[]
  maxRows: number
  list(): Promise<EditorRow[]>
  /** Extra checks on one cleaned row; return a message to reject it. */
  validate?(row: EditorRow): string | null
  /** The natural key of a cleaned row (duplicates are rejected). */
  keyOf(row: EditorRow, index: number): string
  save(rows: EditorRow[], actor: string): Promise<SaveCounts>
}

export class EditorError extends Error {}

/** Clean and validate the rows a page sent. Throws EditorError with a message that names the row. */
export function cleanRows(spec: EditorSpec, input: unknown): EditorRow[] {
  if (!Array.isArray(input)) throw new EditorError('rows must be a list')
  if (input.length > spec.maxRows) throw new EditorError(`At most ${spec.maxRows} rows`)
  const out: EditorRow[] = []
  const keys = new Set<string>()
  input.forEach((raw, i) => {
    const n = i + 1
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EditorError(`Row ${n}: not a row`)
    const row: EditorRow = {}
    for (const col of spec.columns) {
      if (col.readOnly) {
        // Carried back unchanged (e.g. a row id the server matches on); never trusted beyond that.
        const v = (raw as Record<string, unknown>)[col.key]
        if (typeof v === 'string' && v.trim() && v.length <= 64) row[col.key] = v.trim()
        continue
      }
      const v = (raw as Record<string, unknown>)[col.key]
      if (col.kind === 'bool') {
        row[col.key] = v === true || v === 'true'
        continue
      }
      if (col.kind === 'int') {
        if (v === null || v === undefined || v === '') {
          if (col.required) throw new EditorError(`Row ${n}: ${col.label} is required`)
          row[col.key] = null
          continue
        }
        const num = typeof v === 'number' ? v : Number(String(v).trim())
        if (!Number.isInteger(num) || Math.abs(num) > 1e9) throw new EditorError(`Row ${n}: ${col.label} must be a whole number`)
        row[col.key] = num
        continue
      }
      const text = v === null || v === undefined ? '' : String(v).trim()
      if (col.required && !text) throw new EditorError(`Row ${n}: ${col.label} is required`)
      if (col.maxLength && text.length > col.maxLength) throw new EditorError(`Row ${n}: ${col.label} is too long (max ${col.maxLength})`)
      row[col.key] = text
    }
    const problem = spec.validate?.(row)
    if (problem) throw new EditorError(`Row ${n}: ${problem}`)
    const key = spec.keyOf(row, i)
    if (keys.has(key)) throw new EditorError(`Row ${n}: duplicate of an earlier row`)
    keys.add(key)
    out.push(row)
  })
  return out
}

/** https URL or empty. */
export function isHttpUrlOrEmpty(v: CellValue): boolean {
  if (v === null || v === '') return true
  try {
    const u = new URL(String(v))
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
