# Google Sheets Hyperlink Extraction Plan

## Current State Analysis

### Where Hyperlinks ARE Properly Extracted:
| Data | Column | Method | Used In |
|------|--------|--------|---------|
| Crew sheets | Task | `getTaskLinks()` | `/api/crew/[crewId]`, `/api/my-tasks/[memberId]`, `crew-mappings.ts` |
| Crew sheets | Agenda Step | `getAgendaStepLinks()` | `/api/crew/[crewId]` |
| Crew Mappings | Call Time | `getColumnHyperlinks()` | `crew-mappings.ts` → `/crews` page |
| Manuals | Manual | `getManualLinks()` | `/api/manuals` |

### Where Hyperlinks Are LOST:

| Data Source | Columns That May Have Links | Current Method | Issue |
|-------------|----------------------------|----------------|-------|
| **NFT Contracts** | Name, Details | GViz only | Rich text / HYPERLINK() formulas lost |
| **Jobs** | Description/Prompt | CSV export | All links converted to plain text |
| **Member Database** | Org, possibly others | GViz only | Rich text links lost |
| **Crew Mappings** | Channel, Event, Role | GViz only | Only Call Time links extracted |

---

## The Core Problem

**GViz API** (used for public sheet reads) returns links in the `l` property **only** for simple Ctrl+K links. It does NOT return:
- Rich text formatting links (partial cell text linked)
- `=HYPERLINK()` formula links

**Google Sheets API** (requires service account) can extract all three types via:
1. `cell.hyperlink` - Ctrl+K links
2. `cell.textFormatRuns[].format.link.uri` - Rich text links
3. `cell.userEnteredValue.formulaValue` - HYPERLINK() formulas

---

## Proposed Solution

### Phase 1: Create Enhanced Utility Function
Add `getAllSheetLinks(sheetId, tabName, columns[])` that returns `{ columnName: { rowKey: url } }` for multiple columns in a single API call.

### Phase 2: Apply to Each Data Source

| Data Source | Columns to Extract | Changes Needed |
|-------------|-------------------|----------------|
| **Crew Mappings** | Channel, Event, Role, Sheet | Update `crew-mappings.ts` |
| **NFT Contracts** | Name, Details (if exists) | Update `nft-config.ts` or API route |
| **Jobs** | Description/Prompt | Switch from CSV to GViz + Sheets API |
| **Member Database** | Org (and any others identified) | Update member repository |

### Phase 3: Update UI Components
Ensure all components that display this data render links when present.

---

## Implementation Notes

### Existing Utility Functions (in `app/api/lib/google-sheets.ts`)

- `getTaskLinks(sheetId)` - Extracts hyperlinks from "Task" column
- `getAgendaStepLinks(sheetId)` - Extracts hyperlinks from "Step" column in Agenda
- `getManualLinks(sheetId)` - Extracts hyperlinks from "Manual" column
- `getColumnHyperlinks(sheetId, tabName, keyColumn, linkColumn)` - Generic column hyperlink extraction

### Link Extraction Priority Order (in each function)
1. Direct `hyperlink` property (Ctrl+K links)
2. Rich text links via `textFormatRuns[].format.link.uri`
3. HYPERLINK formula extraction from `userEnteredValue.formulaValue`
