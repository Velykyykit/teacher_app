// ==========================================
// МОДУЛЬ ГРУП ТА СТУДЕНТІВ
// db_group  – реєстр груп
// groups_folder – папка, куди кладемо файли груп
// ==========================================

/**
 * Повертає список груп з таблиці db_group.
 * Формат елементу:
 * { id, name, course, opp_id, specialty, curator_id, curator_name, id_base, status, year_start }
 *
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

  // Мапа викладачів для імен кураторів
  var nameMap = _getNameMap(CFG);

  var groups = [];
  // db_group:
  // A id, B course, C gz, D opp, E specialty, F name,
  // G education_form, H study_language, I year_start,
  // J curator_id, K status, L order_create_id, M order_close_id, N id_base
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // пропускаємо порожні

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
      status: row[10] || "",
      id_base: row[13] || ""
    });
  }

  return groups;
}


/**
 * Створює нову групу:
 *  - рядок у db_group
 *  - окремий файл-таблицю зі студентами у папці groups_folder
 *
 * groupName – назва групи (наприклад, "ХТ-21")
 * (наразі інші поля заповнюються мінімально, їх можна буде редагувати вручну)
 */
function apiCreateGroup(groupName) {
  if (!groupName) {
    return { success: false, msg: "Вкажіть назву групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    return { success: false, msg: "Config error: немає db_group у base_id" };
  }
  if (!CFG['groups_folder']) {
    return { success: false, msg: "Config error: немає groups_folder у base_id" };
  }

  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];

  // ---------- 1. Генеруємо ID групи ----------
  var lastRow = sheetDb.getLastRow();
  var newId = 1;

  if (lastRow >= 2) {
    var idValues = sheetDb.getRange(2, 1, lastRow - 1, 1).getValues().flat(); // кол. A
    var numeric = idValues
      .map(function (v) { return Number(v) || 0; })
      .filter(function (v) { return v > 0; });

    if (numeric.length > 0) {
      newId = Math.max.apply(null, numeric) + 1;
    }
  }

  try {
    // ---------- 2. Створюємо нову таблицю для студентів ----------
    var newSS = SpreadsheetApp.create("Група " + groupName);
    var newSsId = newSS.getId();

    // Переміщуємо в папку groups_folder
    var folderId = CFG['groups_folder'].id;
    var file = DriveApp.getFileById(newSsId);
    var folder = DriveApp.getFolderById(folderId);
    folder.addFile(file);
    // забираємо з кореня, щоб не смітити
    DriveApp.getRootFolder().removeFile(file);

    // Налаштовуємо лист StudentData
    var sheet = newSS.getSheets()[0];
    sheet.setName('StudentData');

    var headers = [
      "id",
      "full_name",
      "birth_date",
      "gender",
      "group_id",
      "education_form",
      "status",
      "admission_order",
      "dismiss_order",
      "benefits"
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#cfe2f3");

    // ---------- 3. Додаємо рядок у db_group ----------
    // Структура: A id, B course, C gz, D opp, E specialty, F name,
    // G education_form, H study_language, I year_start,
    // J curator_id, K status, L order_create_id, M order_close_id, N id_base

    var rowData = new Array(14).fill("");

    rowData[0] = newId;               // id
    rowData[5] = groupName;           // name
    rowData[8] = (new Date()).getFullYear(); // year_start
    rowData[10] = "active";           // status
    rowData[13] = newSsId;            // id_base (файл студентів)

    sheetDb.appendRow(rowData);

    return {
      success: true,
      msg: "Групу '" + groupName + "' створено",
      id: newId,
      spreadsheetId: newSsId
    };

  } catch (e) {
    return {
      success: false,
      msg: "Помилка створення групи: " + e.message
    };
  }
}


/**
 * Додає студента у файл конкретної групи (StudentData).
 *
 * studentName – ПІБ студента
 * groupId     – ID групи з db_group (колонка A)
 */
function apiCreateStudent(studentName, groupId) {
  if (!studentName || !groupId) {
    return { success: false, msg: "Вкажіть ПІБ студента та ID групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    return { success: false, msg: "Config error: немає db_group у base_id" };
  }

  // ---------- 1. Знаходимо файл групи через db_group ----------
  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];
  var data = sheetDb.getDataRange().getValues();

  var groupSpreadsheetId = null;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] == groupId) {      // A=id
      groupSpreadsheetId = row[13]; // N=id_base
      break;
    }
  }

  if (!groupSpreadsheetId) {
    return { success: false, msg: "Не знайдено файл таблиці для групи ID " + groupId };
  }

  try {
    // ---------- 2. Відкриваємо файл групи та лист StudentData ----------
    var ssGroup = SpreadsheetApp.openById(groupSpreadsheetId);
    var sheetStudents = ssGroup.getSheetByName('StudentData') || ssGroup.getSheets()[0];

    var lastRow = sheetStudents.getLastRow();
    var newStudentId = 1;

    if (lastRow >= 2) {
      var ids = sheetStudents.getRange(2, 1, lastRow - 1, 1).getValues().flat(); // кол. A (id)
      var numeric = ids
        .map(function (v) { return Number(v) || 0; })
        .filter(function (v) { return v > 0; });

      if (numeric.length > 0) {
        newStudentId = Math.max.apply(null, numeric) + 1;
      }
    }

    // ---------- 3. Додаємо рядок студента ----------
    // Структура StudentData:
    // 0 id, 1 full_name, 2 birth_date, 3 gender,
    // 4 group_id, 5 education_form, 6 status,
    // 7 admission_order, 8 dismiss_order, 9 benefits

    sheetStudents.appendRow([
      newStudentId,
      studentName,
      "",
      "",
      groupId,
      "",
      "active",
      "",
      "",
      ""
    ]);

    return {
      success: true,
      msg: "Студента додано в групу",
      id: newStudentId
    };

  } catch (e) {
    return { success: false, msg: "Помилка доступу до файлу групи: " + e.message };
  }
}


/**
 * Повертає список студентів конкретної групи.
 * Формат:
 * { success:true, students:[ {id, full_name, status, group_id}, ... ] }
 */
function apiGetStudents(groupId) {
  if (!groupId) {
    return { success: false, msg: "Не вказано ID групи" };
  }

  var CFG = getSystemConfig();
  if (!CFG['db_group']) {
    return { success: false, msg: "Config error: немає db_group у base_id" };
  }

  var ssDb = SpreadsheetApp.openById(CFG['db_group'].id);
  var sheetDb = ssDb.getSheetByName(CFG['db_group'].sheetName || 'Аркуш1') || ssDb.getSheets()[0];
  var data = sheetDb.getDataRange().getValues();

  var groupSpreadsheetId = null;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] == groupId) {
      groupSpreadsheetId = row[13]; // id_base
      break;
    }
  }

  if (!groupSpreadsheetId) {
    return { success: false, msg: "Не знайдено файл таблиці для групи ID " + groupId };
  }

  try {
    var ssGroup = SpreadsheetApp.openById(groupSpreadsheetId);
    var sheetStudents = ssGroup.getSheetByName('StudentData') || ssGroup.getSheets()[0];
    var dataSt = sheetStudents.getDataRange().getValues();

    var students = [];
    for (var j = 1; j < dataSt.length; j++) {
      var r = dataSt[j];
      if (!r[0]) continue;
      students.push({
        id: r[0],
        full_name: r[1] || "",
        birth_date: r[2] || "",
        gender: r[3] || "",
        group_id: r[4] || "",
        status: r[6] || ""
      });
    }

    return { success: true, students: students };

  } catch (e) {
    return { success: false, msg: "Помилка читання студентів: " + e.message };
  }
}


/**
 * Призначає/змінює куратора групи.
 * groupId    – ID групи (db_group.A)
 * teacherId  – ID викладача (teachers_db.A)
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
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == groupId) {
      targetRow = i + 1; // для setValue
      break;
    }
  }

  if (targetRow === -1) {
    return { success: false, msg: "Групу з ID " + groupId + " не знайдено" };
  }

  // Колонка J = curator_id (10-та, але індекс 10, бо A=1)
  sheetDb.getRange(targetRow, 10).setValue(teacherId);

  return { success: true, msg: "Куратора оновлено" };
}


/**
 * Список викладачів для випадаючих списків:
 * [ {id, name}, ... ]
 */
function apiGetTeachersShort() {
  var CFG = getSystemConfig();
  if (!CFG['teachers_db']) {
    return [];
  }

  var ss = SpreadsheetApp.openById(CFG['teachers_db'].id);
  var sheet = ss.getSheetByName(CFG['teachers_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push({
      id: data[i][0],
      name: data[i][1] || ""
    });
  }
  return list;
}
