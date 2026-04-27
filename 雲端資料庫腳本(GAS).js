const SHEET_NAME = "看板資料庫";

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ["id", "name", "status", "priority", "progress", "createdAt", "members", "note", "isCollapsed", "completedAt"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
  }
  return sheet;
}

function doGet(e) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
  }
  
  const headers = data[0];
  const result = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    let isEmpty = true;
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      if (val !== "") isEmpty = false;
      if (headers[j] === "members") {
        obj[headers[j]] = val ? val.toString().split(",") : [];
      } else if (headers[j] === "isCollapsed") {
        obj[headers[j]] = val === true || val === "TRUE" || val === "true";
      } else if (headers[j] === "progress" || headers[j] === "createdAt" || headers[j] === "completedAt") {
        obj[headers[j]] = val ? Number(val) : 0;
      } else {
        obj[headers[j]] = val;
      }
    }
    if (!isEmpty) result.push(obj);
  }
  
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const sheet = getSheet();
    const payload = JSON.parse(e.postData.contents);
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
    
    if (!Array.isArray(payload) || payload.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
    }
    
    const rows = [];
    for (let i = 0; i < payload.length; i++) {
      const obj = payload[i];
      const row = [];
      for (let j = 0; j < headers.length; j++) {
        let val = obj[headers[j]];
        if (headers[j] === "members") {
          row.push(Array.isArray(val) ? val.join(",") : "");
        } else {
          row.push(val !== undefined && val !== null ? val : "");
        }
      }
      rows.push(row);
    }
    
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({error: error.message})).setMimeType(ContentService.MimeType.JSON);
  }
}
