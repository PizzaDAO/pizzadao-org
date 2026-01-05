// Google Apps Script (Web App) — V9 (Append + Auto-Sort)
// This version appends to the bottom and sorts the whole table by ID.

const ONBOARDING_LOG_SHEET = "Onboarding";
const DEFAULT_STATUS_ON_INSERT = "Active";

// ✅ THE EXTERNAL CREW SPREADSHEET ID
const CREW_SPREADSHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SHARED_SECRET") || "";
}

function normHeader_(h) {
  return String(h || "").trim().toLowerCase().replace(/[#\s\-_]+/g, "");
}

function buildHeaderMap_(headerRowValues) {
  const map = {};
  for (let i = 0; i < headerRowValues.length; i++) {
    const key = normHeader_(headerRowValues[i]);
    if (key) map[key] = i + 1;
  }
  return map;
}

function getCol_(headerMap, headerName) {
  const primary = normHeader_(headerName);
  if (headerMap[primary]) return headerMap[primary];
  const aliases = {
    "status": ["frequency", "freq"],
    "slug": ["memberid", "id", "slug"],
    "id": ["crewid", "memberid", "id", "idnum"],
    "orgs": ["affiliation", "affil", "organization", "org"],
    "skills": ["specialties", "specialty", "skill"],
    "discordid": ["discord", "discorduser"],
    "turtles": ["turtle", "turtles"]
  };
  for (const a of (aliases[primary] || [])) {
    if (headerMap[a]) return headerMap[a];
  }
  return null;
}

function findCrewTable_(ss) {
  const sheets = ss.getSheets();
  const crewSheet = sheets.find(s => {
    const n = s.getName().trim().toLowerCase();
    return n === "crew" || n === "crews";
  });
  const list = crewSheet ? [crewSheet, ...sheets.filter(s => s.getName() !== crewSheet.getName())] : sheets;

  for (const sh of list) {
    const sName = sh.getName();
    const lastR = Math.min(sh.getLastRow(), 200);
    if (lastR < 1) continue;
    const values = sh.getRange(1, 1, lastR, Math.max(sh.getLastColumn(), 15)).getValues();
    
    for (let r = 0; r < values.length; r++) {
      const cellA = String(values[r][0] || "").trim().toLowerCase();
      if (cellA === "crew") {
        if (r + 1 < values.length) {
          const possibleHeaders = values[r+1];
          const rowVals = possibleHeaders.map(normHeader_);
          if (rowVals.includes("name") || rowVals.includes("id")) {
             return { sheet: sh, headerRow: r + 2, headerValues: possibleHeaders };
          }
        }
      }
      const rowVals = values[r].map(normHeader_);
      if (rowVals.includes("name") && (rowVals.includes("status") || rowVals.includes("frequency") || rowVals.includes("city"))) {
         return { sheet: sh, headerRow: r + 1, headerValues: values[r] };
      }
    }
  }
  return { error: `Table not found in ${ss.getName()}. Tabs: ${sheets.map(s => s.getName()).join(", ")}` };
}

function upsertToCrew_(ss, raw, nowIso) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const crewInfo = findCrewTable_(ss);
    if (crewInfo.error) return { ok: false, error: crewInfo.error };

    const crewSheet = crewInfo.sheet;
    const headerRow = crewInfo.headerRow;
    const headerMap = buildHeaderMap_(crewInfo.headerValues);

    const colID = getCol_(headerMap, "ID");
    if (!colID) return { ok: false, error: "ID column missing." };

    const memberId = String(raw.memberId ?? "").trim();
    const discordId = String(raw.discordId ?? "").trim();
    if (!memberId && !discordId) return { ok: true, skipped: true, reason: "No memberId or discordId" };

    const dataStartRow = headerRow + 1;
    let targetRow = null;
    let action = "updated";

    // ✅ Robust ID Matching Logic (V10)
    const lastR = crewSheet.getLastRow();
    const rangeHeight = Math.max(0, lastR - dataStartRow + 1);
    
    if (rangeHeight > 0) {
      const colDiscord = getCol_(headerMap, "DiscordId");
      // Get IDs and Discord IDs for matching
      const idValues = crewSheet.getRange(dataStartRow, colID, rangeHeight, 1).getValues().map(r => String(r[0] || "").trim());
      const discordValues = colDiscord ? crewSheet.getRange(dataStartRow, colDiscord, rangeHeight, 1).getValues().map(r => String(r[0] || "").trim()) : [];

      // 1) Primary Search: Member ID
      if (memberId) {
        for (let i = 0; i < idValues.length; i++) {
          if (idValues[i].toLowerCase() === memberId.toLowerCase()) {
            targetRow = dataStartRow + i;
            break;
          }
        }
      }

      // 2) Secondary Search: Discord ID (Fallback to prevent duplicates)
      if (!targetRow && discordId) {
        for (let i = 0; i < discordValues.length; i++) {
          if (discordValues[i] === discordId) {
            targetRow = dataStartRow + i;
            action = "updated_by_discord";
            break;
          }
        }
      }
    }

    // If still not found, append to bottom
    if (!targetRow) {
      targetRow = lastR + 1;
      if (targetRow < dataStartRow) targetRow = dataStartRow;
      action = "inserted";
    }

    const mapping = {
      Status: getCol_(headerMap, "Status"),
      Name: getCol_(headerMap, "Name"),
      City: getCol_(headerMap, "City"),
      Crews: getCol_(headerMap, "Crews"),
      Turtles: getCol_(headerMap, "Turtles"),
      DiscordId: getCol_(headerMap, "DiscordId"),
      DiscordJoined: getCol_(headerMap, "DiscordJoined"),
      Notes: getCol_(headerMap, "Notes")
    };

    const name = String(raw.mafiaName ?? raw.name ?? "").trim();
    crewSheet.getRange(targetRow, colID).setValue(memberId);
    // Only write Name if explicitly provided
    if (mapping.Name && (raw.mafiaName !== undefined || raw.name !== undefined)) {
      const nameCell = crewSheet.getRange(targetRow, mapping.Name);
      const existingRichText = nameCell.getRichTextValue();
      const existingUrl = existingRichText ? existingRichText.getLinkUrl() : null;
      
      if (existingUrl) {
         // Preserve the existing link with the new text
         const newRichText = SpreadsheetApp.newRichTextValue()
           .setText(name)
           .setLinkUrl(existingUrl)
           .build();
         nameCell.setRichTextValue(newRichText);
      } else {
         nameCell.setValue(name);
      }
    }
    if (mapping.Status) {
       const cur = String(crewSheet.getRange(targetRow, mapping.Status).getValue()).trim();
       if (!cur || action === "inserted") crewSheet.getRange(targetRow, mapping.Status).setValue(DEFAULT_STATUS_ON_INSERT);
    }
    // Only write City if explicitly provided
    if (mapping.City && raw.city !== undefined) {
      crewSheet.getRange(targetRow, mapping.City).setValue(String(raw.city ?? ""));
    }
    // Only write Crews if explicitly provided
    if (mapping.Crews && raw.crews !== undefined) {
      crewSheet.getRange(targetRow, mapping.Crews).setValue(Array.isArray(raw.crews) ? raw.crews.join(", ") : String(raw.crews || ""));
    }
    // Only write Turtles if explicitly provided
    if (mapping.Turtles && (raw.turtles !== undefined || raw.turtle !== undefined)) {
      crewSheet.getRange(targetRow, mapping.Turtles).setValue(Array.isArray(raw.turtles) ? raw.turtles.join(", ") : String(raw.turtle || ""));
    }
    // Always write DiscordId and DiscordJoined if provided
    if (mapping.DiscordId && raw.discordId !== undefined) {
      crewSheet.getRange(targetRow, mapping.DiscordId).setValue(String(raw.discordId || ""));
    }
    if (mapping.DiscordJoined && raw.discordJoined !== undefined) {
      crewSheet.getRange(targetRow, mapping.DiscordJoined).setValue(raw.discordJoined ? "TRUE" : "FALSE");
    }

    if (mapping.Notes) {
      const curNotes = String(crewSheet.getRange(targetRow, mapping.Notes).getValue()).trim();
      const line = `[${nowIso}] Onboarded: ${name} (ID: ${memberId})`;
      crewSheet.getRange(targetRow, mapping.Notes).setValue(curNotes ? curNotes + "\n" + line : line);
    }

    // ✅ AUTO-SORT BY ID (Ascending)
    try {
      const finalLastRow = crewSheet.getLastRow();
      if (finalLastRow >= dataStartRow) {
        const sortRange = crewSheet.getRange(dataStartRow, 1, finalLastRow - dataStartRow + 1, crewSheet.getLastColumn());
        sortRange.sort({ column: colID, ascending: true });
      }
    } catch (e) {
      // sorting error shouldn't block the upsert response
    }

    return { ok: true, action, sheet: crewSheet.getName(), row: targetRow, id: memberId };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  try {
    const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};
    if (body.secret !== getSecret_()) return json_({ ok: false, error: "Unauthorized" });
    const nowIso = new Date().toISOString();
    const raw = body.raw || body;
    const crewSS = SpreadsheetApp.openById(CREW_SPREADSHEET_ID);
    const crewRes = upsertToCrew_(crewSS, raw, nowIso);
    try {
      const logSS = SpreadsheetApp.getActiveSpreadsheet();
      if (logSS) {
        const logSheet = logSS.getSheetByName(ONBOARDING_LOG_SHEET) || logSS.insertSheet(ONBOARDING_LOG_SHEET);
        logSheet.appendRow([nowIso, raw.source, raw.sessionId, raw.mafiaName, raw.topping, raw.mafiaMovieTitle, raw.resolvedMovieTitle, raw.tmdbMovieId, raw.releaseDate, raw.city, String(raw.turtle || ""), String(raw.crews || ""), raw.discordId, raw.discordJoined ? "TRUE" : "FALSE", JSON.stringify(raw), JSON.stringify(crewRes)]);
      }
    } catch (e) {}
    return json_({ ok: true, crewSync: crewRes });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
