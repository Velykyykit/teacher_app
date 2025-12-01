// ==========================================
// МОДУЛЬ ГРУП ТА СТУДЕНТІВ (ОПТИМІЗОВАНО)
// Працює з:
// 1. db_group (Реєстр груп)
// 2. db_students (Єдина база студентів)
// ==========================================

/**
 * Отримуємо список груп з реєстру.
 */
function apiGetGroups() {
  var CFG = getSystemConfig();
  if (!CFG['db_group']) throw new Error("Config error: немає db_group");

  var ss = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheet = ss.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  // Оптимізація: беремо map імен вчителів один раз (для кураторів)
  var nameMap = _getNameMap(CFG);

  var groups = [];
  // Структура db_group: 
  // A=id, B=course, C=gz, D=opp, E=spec, F=name, ..., J=curator, ..., N=id_base
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    var curatorId = row[9];

    groups.push({
      id:             row[0],
      course:         row[1] || "",
      gz:             row[2] || "",
      opp_id:         row[3] || "",
      specialty:      row[4] || "",
      name:           row[5] || "",
      education_form: row[6] || "",
      study_language: row[7] || "",
      year_start:     row[8] || "",
      curator_id:     curatorId || "",
      curator_name:   curatorId ? (nameMap[curatorId] || "") : "",
      status:         row[10] || "",
      id_base:        row[13] || "" // Залишаємо для історії, але не використовуємо
    });
  }
  return groups;
}

/**
 * Створює нову групу.
 * Більше НЕ створює файл! Просто пише рядок у db_group.
 */
function apiCreateGroup(groupName) {
  if (!groupName) return { success: false, msg: "Вкажіть назву групи" };

  var CFG = getSystemConfig();
  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];

  // Генеруємо ID (шукаємо макс ID)
  var lastRow = sheetDb.getLastRow();
  var newId = 1;
  
  if (lastRow >= 2) {
    var idValues = sheetDb.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var maxId = 0;
    for (var k = 0; k < idValues.length; k++) {
      var num = Number(idValues[k]);
      if (num > maxId) maxId = num;
    }
    newId = maxId + 1;
  }

  // Формуємо рядок (14 колонок, як у вашій таблиці)
  var rowData = new Array(14).fill("");
  rowData[0] = newId;               // A: id
  rowData[5] = groupName;           // F: name
  rowData[8] = (new Date()).getFullYear(); // I: year
  rowData[10] = "active";           // K: status
  // rowData[13] (id_base) - залишаємо пустим!

  sheetDb.appendRow(rowData);

  return {
    success: true,
    msg: "Групу створено",
    id: newId
  };
}

/**
 * Додає студента в ЄДИНУ БАЗУ (Global_Students_DB).
 * Заповнює розширену структуру (дати, накази).
 */
function apiCreateStudent(studentName, groupId) {
  if (!studentName || !groupId) return { success: false, msg: "Дані неповні" };

  var CFG = getSystemConfig();
  if (!CFG['db_students']) {
    return { success: false, msg: "Помилка: не налаштовано db_students у base_id" };
  }

  var ss = SpreadsheetApp.openById(CFG['db_students'].id);
  var sheet = ss.getSheetByName(CFG['db_students'].sheetName || 'Students') || ss.getSheets()[0];

  // Генеруємо ID студента
  var lastRow = sheet.getLastRow();
  var newId = 1;
  if (lastRow >= 2) {
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var maxId = 0;
    for (var k = 0; k < idValues.length; k++) {
      var num = Number(idValues[k]);
      if (num > maxId) maxId = num;
    }
    newId = maxId + 1;
  }

  var now = new Date();
  var dateString = Utilities.formatDate(now, "Europe/Kyiv", "dd.MM.yyyy");

  // Рядок для вставки (12 колонок, як ми планували)
  // A=id, B=name, C=groupId, D=status, E=finance, F=enroll_date, 
  // G=enroll_order, H=dismiss_date, I=dismiss_order, J=phone, K=parents, L=pass
  var row = [
    newId,           // A
    studentName,     // B
    groupId,         // C
    "active",        // D
    "",              // E (finance_type)
    dateString,      // F (enrollment_date)
    "",              // G
    "",              // H
    "",              // I
    "",              // J
    "",              // K
    ""               // L
  ];

  sheet.appendRow(row);

  return { success: true, msg: "Студента додано", id: newId };
}

/**
 * Отримує студентів, фільтруючи із ЗАГАЛЬНОЇ бази.
 * Це працює миттєво.
 */
function apiGetStudents(groupId) {
  if (!groupId) return { success: false, msg: "Не вказано ID групи" };

  var CFG = getSystemConfig();
  // Якщо ще не налаштували базу, повертаємо пустий список, щоб не ламався фронт
  if (!CFG['db_students']) return { success: true, students: [] };

  var ss = SpreadsheetApp.openById(CFG['db_students'].id);
  var sheet = ss.getSheetByName(CFG['db_students'].sheetName || 'Students') || ss.getSheets()[0];
  
  // Читаємо ВСЮ базу (це швидко)
  var data = sheet.getDataRange().getValues();
  
  var result = [];
  // i=1 пропускаємо шапку
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // row[2] це group_id (Column C)
    if (String(row[2]) === String(groupId) && row[3] !== 'deleted') { 
      result.push({
        id: row[0],
        full_name: row[1],
        group_id: row[2],
        status: row[3],
        // Можна віддавати на фронт більше даних, якщо треба
        enrollment_date: row[5]
      });
    }
  }

  return { success: true, students: result };
}

// ------------------------------------------
// Допоміжні функції (без змін, але потрібні для роботи)
// ------------------------------------------

function apiAssignCurator(groupId, teacherId) {
  if (!groupId || !teacherId) return { success: false, msg: "Дані неповні" };
  var CFG = getSystemConfig();
  var ss = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheet = ss.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == groupId) {
      sheet.getRange(i + 1, 10).setValue(teacherId); // J column
      return { success: true, msg: "Куратора оновлено" };
    }
  }
  return { success: false, msg: "Групу не знайдено" };
}

function apiGetTeachersShort() {
  // Кешуємо список вчителів для швидкості
  var cache = CacheService.getScriptCache();
  var cached = cache.get("TEACHERS_SHORT");
  if (cached) return JSON.parse(cached);

  var CFG = getSystemConfig();
  if (!CFG['teachers_db']) return [];

  var ss = SpreadsheetApp.openById(CFG['teachers_db'].id);
  var sheet = ss.getSheetByName(CFG['teachers_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push({ id: data[i][0], name: data[i][1] || "" });
  }

  cache.put("TEACHERS_SHORT", JSON.stringify(list), 3600);
  return list;
}