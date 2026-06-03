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
  // ====== 增量擴充：AI 工具發布設定 ======
  if (e && e.parameter && e.parameter.type === "aitools") {
    return getAiToolsData();
  }
  // ====== 以下為原本看板 doGet 邏輯，完全不動 ======

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
    // ====== 增量擴充：AI 工具 POST 分流 ======
    if (e && e.parameter && e.parameter.type === "aitools") {
      // 單筆描述更新
      if (e.parameter.action === "updateDesc") {
        return updateAiToolDesc(e);
      }
      // 新增工具
      if (e.parameter.action === "addTool") {
        return addAiTool(e);
      }
      // 更新工具（全欄位）
      if (e.parameter.action === "updateTool") {
        return updateAiTool(e);
      }
      // 刪除工具
      if (e.parameter.action === "deleteTool") {
        return deleteAiTool(e);
      }
      // 批量掃描同步
      return postAiToolsData(e);
    }
    // ====== 以下為原本看板 doPost 邏輯，完全不動 ======

    const sheet = getSheet();
    const payload = JSON.parse(e.postData.contents);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
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
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====================================================================
// 增量擴充區域：AI 工具發布設定（獨立分頁）
// 欄位：id, toolName, version, pathOutline, description, updateTime
// ====================================================================

var AI_TOOLS_SHEET_NAME = "AI工具發布設定";
var AI_TOOLS_HEADERS = ["id", "toolName", "version", "pathOutline", "description", "updateTime"];

function getAiToolsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AI_TOOLS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AI_TOOLS_SHEET_NAME);
    sheet.appendRow(AI_TOOLS_HEADERS);
    sheet.getRange(1, 1, 1, AI_TOOLS_HEADERS.length).setFontWeight("bold").setBackground("#c9daf8");
  }
  return sheet;
}

// ====== GET：讀取 AI 工具資料回傳 JSON ======
function getAiToolsData() {
  try {
    var sheet = getAiToolsSheet();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    // 若只有標頭或完全空白，回傳空陣列
    if (lastRow <= 1 || lastCol <= 0) {
      return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var result = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var obj = {};

      for (var j = 0; j < headers.length; j++) {
        var key = headers[j] ? headers[j].toString().trim() : "";
        var val = row[j];
        obj[key] = (val !== undefined && val !== null && val !== "") ? val.toString() : "";
      }

      // 只要 toolName 非空就算有效資料
      if (obj["toolName"] && obj["toolName"].length > 0) {
        result.push(obj);
      }
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====== POST 批量：server.js 掃描同步（智慧合併，不覆蓋既有描述） ======
function postAiToolsData(e) {
  try {
    var sheet = getAiToolsSheet();
    var payload = JSON.parse(e.postData.contents);

    if (!Array.isArray(payload) || payload.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: true, count: 0 })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var descColIdx = -1;
    var nameColIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (headers[h] === "description") descColIdx = h;
      if (headers[h] === "toolName") nameColIdx = h;
    }

    // 讀取既有資料，建立 toolName → description 對照表
    var existingDescMap = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1 && descColIdx >= 0 && nameColIdx >= 0) {
      var oldData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var i = 0; i < oldData.length; i++) {
        var tn = oldData[i][nameColIdx] ? oldData[i][nameColIdx].toString().trim() : "";
        var desc = oldData[i][descColIdx] ? oldData[i][descColIdx].toString().trim() : "";
        if (tn && desc) {
          existingDescMap[tn] = desc;
        }
      }
    }

    // 清除舊資料（保留表頭）
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    }

    // 組裝新資料
    var rows = [];
    for (var i = 0; i < payload.length; i++) {
      var obj = payload[i];
      var row = [];
      for (var j = 0; j < headers.length; j++) {
        var colName = headers[j] ? headers[j].toString().trim() : "";
        var val = obj[colName];

        if (colName === "description") {
          var incoming = (val !== undefined && val !== null) ? val.toString().trim() : "";
          // 智慧合併：傳入為空但既有有手動描述 → 保留舊的
          if (!incoming && obj["toolName"] && existingDescMap[obj["toolName"]]) {
            row.push(existingDescMap[obj["toolName"]]);
          } else {
            row.push(incoming);
          }
        } else {
          row.push((val !== undefined && val !== null) ? val.toString() : "");
        }
      }
      rows.push(row);
    }

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, count: rows.length })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====== POST 單筆：前端 inline-edit 描述儲存 ======
function updateAiToolDesc(e) {
  try {
    var sheet = getAiToolsSheet();
    var payload = JSON.parse(e.postData.contents);
    var targetId = payload.id ? payload.id.toString().trim() : "";
    var newDesc = (payload.description !== undefined && payload.description !== null) ? payload.description.toString() : "";

    if (!targetId) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "missing id" })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var idIdx = -1;
    var descIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (headers[h] === "id") idIdx = h;
      if (headers[h] === "description") descIdx = h;
    }

    if (idIdx < 0 || descIdx < 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "column not found" })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "no data" })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][idIdx].toString().trim() === targetId) {
        sheet.getRange(i + 2, descIdx + 1).setValue(newDesc);
        return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "id not found" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====== POST：前端新增單筆 AI 工具 ======
function addAiTool(e) {
  try {
    var sheet = getAiToolsSheet();
    var payload = JSON.parse(e.postData.contents);

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // 自動產生新 ID = 目前最大 ID + 1
    var lastRow = sheet.getLastRow();
    var newId = "1";
    if (lastRow > 1) {
      var idColIdx = -1;
      for (var h = 0; h < headers.length; h++) {
        if (headers[h] === "id") { idColIdx = h; break; }
      }
      if (idColIdx >= 0) {
        var ids = sheet.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues();
        var maxId = 0;
        for (var i = 0; i < ids.length; i++) {
          var n = parseInt(ids[i][0]);
          if (!isNaN(n) && n > maxId) maxId = n;
        }
        newId = String(maxId + 1);
      }
    }

    // 組裝新行
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      var colName = headers[j] ? headers[j].toString().trim() : "";
      if (colName === "id") {
        row.push(newId);
      } else if (colName === "updateTime") {
        row.push(new Date().toISOString());
      } else {
        var val = payload[colName];
        row.push((val !== undefined && val !== null) ? val.toString() : "");
      }
    }

    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ success: true, id: newId })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====== POST：前端更新單筆 AI 工具（全欄位） ======
function updateAiTool(e) {
  try {
    var sheet = getAiToolsSheet();
    var payload = JSON.parse(e.postData.contents);
    var targetId = payload.id ? payload.id.toString().trim() : "";

    if (!targetId) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "missing id" })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    var idIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (headers[h] === "id") { idIdx = h; break; }
    }
    if (idIdx < 0 || lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "no data" })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][idIdx].toString().trim() === targetId) {
        // 逐欄更新（跳過 id）
        for (var j = 0; j < headers.length; j++) {
          var colName = headers[j] ? headers[j].toString().trim() : "";
          if (colName === "id") continue;
          if (colName === "updateTime") {
            sheet.getRange(i + 2, j + 1).setValue(new Date().toISOString());
          } else if (payload.hasOwnProperty(colName)) {
            sheet.getRange(i + 2, j + 1).setValue(payload[colName] !== undefined && payload[colName] !== null ? payload[colName].toString() : "");
          }
        }
        return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "id not found" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ====== POST：前端刪除單筆 AI 工具 ======
function deleteAiTool(e) {
  try {
    var sheet = getAiToolsSheet();
    var payload = JSON.parse(e.postData.contents);
    var targetId = payload.id ? payload.id.toString().trim() : "";

    if (!targetId) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "missing id" })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    var idIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (headers[h] === "id") { idIdx = h; break; }
    }
    if (idIdx < 0 || lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "no data" })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][idIdx].toString().trim() === targetId) {
        sheet.deleteRow(i + 2);
        return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "id not found" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
