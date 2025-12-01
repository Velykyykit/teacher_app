// ==========================================
// РОЗКЛАД (ОПТИМІЗОВАНО + ВИПРАВЛЕНО ЧАС)
// ==========================================

/**
 * Повертає список дзвінків з таблиці bells_db
 * Формат елемента: { pair_no, start_time, end_time, break_minutes }
 */
function apiGetBells() {
  var cache = CacheService.getScriptCache();
  // ЗМІНА ТУТ: додали _V2, щоб забути старий кеш
  var cached = cache.get("BELLS_SCHEDULE_V2"); 
  if (cached) return JSON.parse(cached);

  var CFG = getSystemConfig();
  if (!CFG['bells_db']) return [];

  var ss = SpreadsheetApp.openById(CFG['bells_db'].id);
  var sheet = ss.getSheetByName(CFG['bells_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  
  // Беремо "як бачимо" (текст), а не дату
  var data = sheet.getDataRange().getDisplayValues();

  var res = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    res.push({
      pair_no: r[0],
      start_time: r[1] || '', 
      end_time: r[2] || '',   
      break_minutes: r[3] || 0
    });
  }

  // ЗМІНА ТУТ: записуємо в нову комірку пам'яті
  cache.put("BELLS_SCHEDULE_V2", JSON.stringify(res), 21600);
  return res;
}

/**
 * Розклад для П поточного викладача
 */
function apiGetTeacherSchedule(token, year, semester) {
  if (!token) return { success: false, msg: "Немає токена" };

  var me = apiMe(token);
  if (!me.success) return { success: false, msg: me.msg || "Не авторизовано" };

  var teacherId = me.user.id;
  var role = me.user.role || '';

  var CFG = getSystemConfig();
  if (!CFG['schedule_db']) {
    return { success: false, msg: "Config error: немає schedule_db у base_id" };
  }

  var ss = SpreadsheetApp.openById(CFG['schedule_db'].id);
  var sheet = ss.getSheetByName(CFG['schedule_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  // Дзвінки беремо вже виправлені
  var bellsArr = apiGetBells();
  var bellsMap = {};
  bellsArr.forEach(function (b) {
    if (!b) return;
    bellsMap[String(b.pair_no)] = b;
  });

  var groupMap = _getGroupMap(CFG);
  var discMap = _getDisciplineMap(CFG);

  var res = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;

    var rowYear = r[1];
    var rowSem = r[2];
    var weekday = r[3];
    var pairNo = r[4];
    var groupId = r[5];
    var discId = r[6];
    var tId = r[7];
    var room = r[8];
    var note = r[9];

    if (String(tId) !== String(teacherId)) continue;
    if (year && String(rowYear) !== String(year)) continue;
    if (semester && String(rowSem) !== String(semester)) continue;

    var bell = bellsMap[String(pairNo)] || {};

    res.push({
      id: r[0],
      year: rowYear,
      semester: rowSem,
      weekday: weekday,
      weekday_name: _weekdayName(weekday),
      pair_no: pairNo,
      time_start: bell.start_time || '',
      time_end: bell.end_time || '',
      break_minutes: bell.break_minutes || '',
      group_id: groupId,
      group_name: groupMap[groupId] || '',
      discipline_id: discId,
      discipline_name: discMap[discId] || '',
      room: room || '',
      note: note || ''
    });
  }

  res.sort(function (a, b) {
    var d = Number(a.weekday || 0) - Number(b.weekday || 0);
    if (d !== 0) return d;
    return Number(a.pair_no || 0) - Number(b.pair_no || 0);
  });

  return {
    success: true,
    items: res,
    bells: bellsArr,
    role: role
  };
}

/**
 * Збереження розкладу дзвінків (лише admin).
 */
function apiSaveBells(token, bells) {
  var me = apiMe(token);
  if (!me.success) return { success: false, msg: "Не авторизовано" };

  var role = (me.user.role || '').toLowerCase();
  if (role !== 'admin') {
    return { success: false, msg: "Лише адміністратор може змінювати розклад дзвінків" };
  }

  var CFG = getSystemConfig();
  var ss = SpreadsheetApp.openById(CFG['bells_db'].id);
  var sheet = ss.getSheetByName(CFG['bells_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }

  var rows = [];
  for (var i = 0; i < bells.length; i++) {
    var b = bells[i];
    if (!b) continue;
    rows.push([
      b.pair_no,
      b.start_time,
      b.end_time,
      b.break_minutes || 0
    ]);
  }

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }
  
  // Очищаємо кеш, щоб усі побачили зміни
  CacheService.getScriptCache().remove("BELLS_SCHEDULE");

  return { success: true, msg: "Розклад дзвінків збережено" };
}

// === HELPERS ===

function _getGroupMap(config) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("MAP_GROUPS");
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.openById(config['db_group'].id);
  var sheet = ss.getSheetByName(config['db_group'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[0]) map[r[0]] = r[5] || r[3] || '';
  }
  cache.put("MAP_GROUPS", JSON.stringify(map), 1800);
  return map;
}

function _getDisciplineMap(config) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("MAP_DISCIPLINES");
  if (cached) return JSON.parse(cached);

  if (!config['db_disciplines']) return {};
  var ss = SpreadsheetApp.openById(config['db_disciplines'].id);
  var sheet = ss.getSheetByName(config['db_disciplines'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[0]) map[r[0]] = r[1] || '';
  }
  cache.put("MAP_DISCIPLINES", JSON.stringify(map), 3600);
  return map;
}

function _weekdayName(w) {
  var n = Number(w);
  var names = ['','Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];
  return names[n] || '';
}