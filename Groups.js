// ==========================================
// МОДУЛЬ ГРУП ТА СТУДЕНТІВ (REFACTORED)
// Архітектура: Єдина база даних (Single Source of Truth)
// Працює з таблицями: db_group, db_students, teachers_db
// ==========================================

/**
 * Повертає список груп з таблиці db_group.
 * Використовується у фронтенді (groupsPanel).
 */
function apiGetGroups() {
  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    throw new Error("Config error: немає db_group у base_id");
  }

  var ss = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheet = ss.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  // Мапа викладачів для відображення імен кураторів
  var nameMap = _getNameMap(CFG);

  var groups = [];
  // Структура db_group (згідно з вашим CSV):
  // 0:id, 1:course, 2:gz, 3:opp, 4:specialty, 5:name,
  // 6:education_form, 7:study_language, 8:year_start,
  // 9:curator_id, 10:status, 11:order_create_id, 12:order_close_id, 13:id_base
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // пропускаємо порожні рядки

    var gid = row[0];
    var curatorId = row[9];

    groups.push({
      id: gid,
      course: row[1] || "",
      gz: row[2] || "",
      opp_id: row[3] || "",
      specialty: row[4] || "",
      name: row[5] || "",
      education_form: row[6] || "",
      study_language: row[7] || "",
      year_start: row[8] || "",
      curator_id: curatorId || "",
      curator_name: curatorId ? (nameMap[curatorId] || "") : "",
      status: row[10] || "active"
    });
  }

  return groups;
}


/**
 * Створює нову групу.
 * Оновлена логіка: тільки додає запис у db_group.
 * Файли більше не створюються.
 *
 * @param {string} groupName – Назва групи (наприклад, "ХТ-21")
 */
function apiCreateGroup(groupName) {
  if (!groupName) {
    return { success: false, msg: "Вкажіть назву групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    return { success: false, msg: "Config error: немає db_group у base_id" };
  }

  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];

  // ---------- 1. Генеруємо ID групи ----------
  var lastRow = sheetDb.getLastRow();
  var newId = 1;

  if (lastRow >= 2) {
    // Читаємо колонку A (id)
    var idValues = sheetDb.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var numeric = idValues
      .map(function (v) { return Number(v) || 0; })
      .filter(function (v) { return v > 0; });

    if (numeric.length > 0) {
      newId = Math.max.apply(null, numeric) + 1;
    }
  }

  // ---------- 2. Додаємо рядок у db_group ----------
  try {
    var rowData = new Array(14).fill(""); // 14 колонок у структурі CSV

    rowData[0] = newId;                        // id
    rowData[5] = groupName;                    // name
    rowData[8] = (new Date()).getFullYear();   // year_start
    rowData[10] = "active";                    // status
    // rowData[13] (id_base) залишаємо пустим, бо ми перейшли на єдину базу

    sheetDb.appendRow(rowData);

    return {
      success: true,
      msg: "Групу '" + groupName + "' успішно створено (ID: " + newId + ")",
      id: newId
    };

  } catch (e) {
    return {
      success: false,
      msg: "Помилка запису в БД: " + e.message
    };
  }
}


/**
 * Додає студента в єдину базу db_students.
 * Враховує 15 колонок структури CSV.
 *
 * @param {string} studentName – ПІБ студента
 * @param {number|string} groupId – ID групи
 */
function apiCreateStudent(studentName, groupId) {
  if (!studentName || !groupId) {
    return { success: false, msg: "Вкажіть ПІБ студента та ID групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_students']) {
    return { success: false, msg: "Config error: не знайдено db_students у base_id. Додайте ID таблиці студентів у реєстр." };
  }

  var ss = SpreadsheetApp.openById(CFG['db_students'].id);
  var sheet = ss.getSheetByName(CFG['db_students'].sheetName || 'Students') || ss.getSheets()[0];

  // ---------- 1. Генеруємо ID студента ----------
  var lastRow = sheet.getLastRow();
  var newStudentId = 1;

  if (lastRow >= 2) {
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var numeric = idValues
      .map(function (v) { return Number(v) || 0; })
      .filter(function (v) { return v > 0; });

    if (numeric.length > 0) {
      newStudentId = Math.max.apply(null, numeric) + 1;
    }
  }

  // ---------- 2. Підготовка даних ----------
  var now = new Date();
  var dateString = Utilities.formatDate(now, "Europe/Kyiv", "dd.MM.yyyy");

  // Структура db_students (15 колонок):
  // 0:id, 1:full_name, 2:group_id, 3:status, 4:phone, 5:parents_phone, 
  // 6:email, 7:finance_type, 8:enrollment_date, 9:dismissal_date, 
  // 10:enrollment_order, 11:dismissal_order, 12:Pass_Hash, 13:Auth_Token, 14:Token_Expire

  var row = new Array(15).fill("");
  
  row[0] = newStudentId;
  row[1] = studentName;
  row[2] = groupId;
  row[3] = "active";
  // row[4] phone - пусте
  // row[5] parents_phone - пусте
  // row[6] email - пусте
  // row[7] finance_type - пусте
  row[8] = dateString; // enrollment_date
  
  try {
    sheet.appendRow(row);
    return {
      success: true,
      msg: "Студента додано до бази",
      id: newStudentId
    };
  } catch (e) {
    return { success: false, msg: "Помилка запису студента: " + e.message };
  }
}


/**
 * Отримує список студентів конкретної групи з єдиної бази db_students.
 *
 * @param {number|string} groupId
 */
function apiGetStudents(groupId) {
  if (!groupId) {
    return { success: false, msg: "Не вказано ID групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_students']) {
    // Щоб не ламати інтерфейс, якщо база ще не підключена
    console.warn("db_students not configured");
    return { success: true, students: [] };
  }

  var ss = SpreadsheetApp.openById(CFG['db_students'].id);
  var sheet = ss.getSheetByName(CFG['db_students'].sheetName || 'Students') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var students = [];
  
  // Проходимо по всіх студентах і фільтруємо за group_id (Column C, index 2)
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Порівнюємо як рядки, щоб уникнути помилок типів
    if (String(row[2]) === String(groupId) && row[3] !== 'deleted') {
      students.push({
        id: row[0],
        full_name: row[1],
        group_id: row[2],
        status: row[3],
        phone: row[4] || "",
        email: row[6] || "",
        finance_type: row[7] || ""
      });
    }
  }

  return { success: true, students: students };
}


/**
 * Призначає/змінює куратора групи.
 *
 * @param {number|string} groupId
 * @param {number|string} teacherId
 */
function apiAssignCurator(groupId, teacherId) {
  if (!groupId || !teacherId) {
    return { success: false, msg: "Потрібні groupId та teacherId" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    return { success: false, msg: "Config error: немає db_group у base_id" };
  }

  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];
  var data = sheetDb.getDataRange().getValues();

  var targetRow = -1;
  // Шукаємо рядок групи
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == groupId) {
      targetRow = i + 1; // +1 бо індекси масиву з 0, а рядки в Sheets з 1
      break;
    }
  }

  if (targetRow === -1) {
    return { success: false, msg: "Групу з ID " + groupId + " не знайдено" };
  }

  // Колонка J = curator_id (10-та колонка)
  sheetDb.getRange(targetRow, 10).setValue(teacherId);

  return { success: true, msg: "Куратора успішно оновлено" };
}


/**
 * Допоміжна функція: список викладачів для випадаючих списків.
 * Використовує кешування для швидкодії.
 */
function apiGetTeachersShort() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("TEACHERS_SHORT_LIST");
  if (cached) {
    return JSON.parse(cached);
  }

  var CFG = getSystemConfig();
  if (!CFG['teachers_db']) {
    return [];
  }

  var ss = SpreadsheetApp.openById(CFG['teachers_db'].id);
  var sheet = ss.getSheetByName(CFG['teachers_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var list = [];
  // A=id, B=PIP
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push({
      id: data[i][0],
      name: data[i][1] || "Unknown"
    });
  }

  // Кешуємо на 1 годину
  cache.put("TEACHERS_SHORT_LIST", JSON.stringify(list), 3600);
  return list;
}