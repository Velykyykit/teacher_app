// ==========================================
// АВТОРИЗАЦІЯ, РЕЄСТРАЦІЯ, ПРАВА
// ==========================================

// loginInput: телефон або email
// passwordInput: звичайний текстовий пароль
function apiLogin(loginInput, passwordInput) {
  if (!loginInput || !passwordInput) {
    return { success: false, msg: "Введіть логін і пароль" };
  }

  var searchKey = _normalizeLogin(loginInput);
  if (!searchKey) {
    return { success: false, msg: "Некоректний логін" };
  }

  var CFG = getSystemConfig();
  if (!CFG['auth_db'] || !CFG['teachers_db']) {
    return { success: false, msg: "❌ Config error: немає auth_db або teachers_db" };
  }

  // --- 1. Вчителі ---
  var ssTeachers = SpreadsheetApp.openById(CFG['teachers_db'].id);
  var sheetTeachers = ssTeachers.getSheetByName(CFG['teachers_db'].sheetName || 'Аркуш1') || ssTeachers.getSheets()[0];
  var dataTeachers = sheetTeachers.getDataRange().getValues();

  var userId = null;
  var userName = null;

  for (var i = 1; i < dataTeachers.length; i++) {
    var row = dataTeachers[i];
    if (!row[0]) continue;
    var dbPhone = _normalizeLogin(row[7]); 
    var dbMail  = row[8] ? row[8].toString().trim().toLowerCase() : "";

    if (searchKey === dbPhone || searchKey === dbMail) {
      userId = row[0];
      userName = row[1];
      break;
    }
  }

  if (!userId) {
    return { success: false, msg: "Користувача не знайдено" };
  }

  // --- 2. Таблиця авторизації ---
  var ssAuth = SpreadsheetApp.openById(CFG['auth_db'].id);
  var sheetAuth = ssAuth.getSheetByName(CFG['auth_db'].sheetName || 'Аркуш1') || ssAuth.getSheets()[0];
  var dataAuth = sheetAuth.getDataRange().getValues();

  var authRowIndex = -1;
  var storedHash   = "";
  var role         = "";

  for (var j = 1; j < dataAuth.length; j++) {
    if (dataAuth[j][0] == userId) {
      authRowIndex = j + 1;
      storedHash   = dataAuth[j][1] ? dataAuth[j][1].toString() : "";
      role         = dataAuth[j][4] ? dataAuth[j][4].toString() : "";
      break;
    }
  }

  if (authRowIndex === -1) {
    return { success: false, msg: "Немає запису у auth_db для цього ID" };
  }

  // --- 3. Перевірка пароля ---
  var inputHash = _hash(passwordInput);
  if (inputHash !== storedHash) {
    return { success: false, msg: "Невірний пароль" };
  }

  // --- 4. Генерація токена ---
  var token = Utilities.getUuid();
  var expireDate = new Date();
  expireDate.setHours(expireDate.getHours() + AUTH_TTL_HOURS);

  // Запис в БД
  sheetAuth.getRange(authRowIndex, 3).setValue(token);
  sheetAuth.getRange(authRowIndex, 4).setValue(expireDate.toISOString());

  var perms = _getPermissions(userId, role);
  var userObj = {
    id: userId,
    name: userName || _getUserNameById(userId, CFG),
    role: role || "",
    permissions: perms
  };

  // !!! ОПТИМІЗАЦІЯ: Зберігаємо сесію в кеш на 6 годин !!!
  try {
    var cache = CacheService.getScriptCache();
    cache.put("SESSION_" + token, JSON.stringify(userObj), 21600);
  } catch (e) {
    console.warn("Failed to cache session", e);
  }

  return {
    success: true,
    token: token,
    user: userObj
  };
}

// ------------------------------------------
// Перевірка сесії за токеном (ОПТИМІЗОВАНО)
// ------------------------------------------
function apiMe(token) {
  if (!token) {
    return { success: false, msg: "Немає токена" };
  }

  // 1. Швидка перевірка в кеші
  var cache = CacheService.getScriptCache();
  var cachedSession = cache.get("SESSION_" + token);
  
  if (cachedSession) {
    return {
      success: true,
      user: JSON.parse(cachedSession)
    };
  }

  // 2. Якщо в кеші немає (наприклад, скрипт перезапущено), йдемо в БД
  var CFG = getSystemConfig();
  if (!CFG['auth_db']) {
    return { success: false, msg: "Config error: немає auth_db" };
  }

  var ss = SpreadsheetApp.openById(CFG['auth_db'].id);
  var sheet = ss.getSheetByName(CFG['auth_db'].sheetName || 'Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[2]) continue;

    if (row[2].toString() === token.toString()) {
      var expireStr = row[3];
      if (!expireStr) return { success: false, msg: "Сесія недійсна" };

      var now = new Date();
      var expireDate = new Date(expireStr);
      if (now > expireDate) {
        return { success: false, msg: "Сесія завершена, залогіньтесь ще раз" };
      }

      var userId = row[0];
      var role   = row[4] || "";
      var perms  = _getPermissions(userId, role);

      var userObj = {
        id:   userId,
        name: _getUserNameById(userId, CFG),
        role: role,
        permissions: perms
      };

      // Відновлюємо кеш
      cache.put("SESSION_" + token, JSON.stringify(userObj), 21600);

      return { success: true, user: userObj };
    }
  }

  return { success: false, msg: "Токен не знайдено" };
}


// ------------------------------------------
// Реєстрація заявки на доступ
// Таблиця reg: A=id, B=PIP, C=phone, D=mail, E=pass (hash)
// ------------------------------------------
function apiRegister(name, phone, email, pass) {
  if (!name || !phone || !email || !pass) {
    return { success: false, msg: "Заповніть усі поля" };
  }

  var normalizedPhone = _normalizeLogin(phone);
  var emailNorm = email.toString().trim().toLowerCase();

  if (!normalizedPhone && !emailNorm) {
    return { success: false, msg: "Некоректний телефон/пошта" };
  }

  // Де лежить таблиця reg
  var regId = REG_SHEET_ID; // з Script Properties
  if (!regId) {
    return { success: false, msg: "Реєстрація наразі недоступна (не задано REG_SHEET_ID)" };
  }

  var ss = SpreadsheetApp.openById(regId);
  var sheet = ss.getSheetByName('Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  // Перевірка, чи така заявка вже була
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var ph = row[2] ? _normalizeLogin(row[2]) : "";
    var ml = row[3] ? row[3].toString().trim().toLowerCase() : "";

    if ((ph && ph === normalizedPhone) || (ml && ml === emailNorm)) {
      return { success: false, msg: "Заявка з таким телефоном або email вже існує" };
    }
  }

  // Генеруємо новий id
  var lastRow = sheet.getLastRow();
  var newId = 1;
  if (lastRow >= 2) {
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var numeric = idValues
      .map(function(v) { return Number(v) || 0; })
      .filter(function(v) { return v > 0; });
    if (numeric.length > 0) {
      newId = Math.max.apply(null, numeric) + 1;
    }
  }

  var passHash = _hash(pass);

  sheet.appendRow([
    newId,
    name,
    normalizedPhone,
    emailNorm,
    passHash
  ]);

  return {
    success: true,
    msg: "✅ Заявку подано. Адміністратор додасть вас у систему."
  };
}


// ==========================================
// УТИЛІТИ ДЛЯ АВТОРИЗАЦІЇ
// ==========================================

/**
 * Нормалізація логіна:
 * - якщо це email -> toLowerCase
 * - якщо телефон -> тільки цифри, формат 380ХХХХХХХХХ
 */
function _normalizeLogin(input) {
  if (!input) return "";
  var str = input.toString().trim();

  // email
  if (str.indexOf('@') !== -1) {
    return str.toLowerCase();
  }

  // phone
  var cleaned = str.replace(/\D/g, ''); // тільки цифри

  if (cleaned.length === 12 && cleaned.startsWith('380')) {
    return cleaned;
  }
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return '38' + cleaned;
  }
  if (cleaned.length === 9) {
    return '380' + cleaned;
  }

  return cleaned;
}

/**
 * Хешування пароля з GLOBAL_SALT
 */
function _hash(s) {
  var payload = s.toString() + (GLOBAL_SALT || "");
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    payload
  );
  var hash = bytes
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b);
      return v.toString(16).padStart(2, '0');
    })
    .join('');
  return hash;
}

/**
 * Отримання імені користувача за ID з teachers_db
 */
function _getUserNameById(id, config) {
  config = config || getSystemConfig();
  if (!config['teachers_db']) return "Unknown";

  var ss = SpreadsheetApp.openById(config['teachers_db'].id);
  var sheet = ss.getSheetByName(config['teachers_db'].sheetName || 'Аркуш1')
              || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      return data[i][1] || "Unknown";
    }
  }
  return "Unknown";
}

/**
 * Мапа ID -> ПІП (може знадобитися далі)
 */
function _getNameMap(config) {
  config = config || getSystemConfig();
  if (!config['teachers_db']) return {};

  var ss = SpreadsheetApp.openById(config['teachers_db'].id);
  var sheet = ss.getSheetByName(config['teachers_db'].sheetName || 'Аркуш1')
              || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var map = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      map[data[i][0]] = data[i][1];
    }
  }
  return map;
}

/**
 * Права доступу за роллю.
 * Таблиця Roles:
 *  A: roleName
 *  B: "*" або JSON-масив прав, напр. ["groups","students","load"]
 */
function _getPermissions(userId, roleName) {
  if (!roleName) return [];
  var role = roleName.toString().trim().toLowerCase();

  // admin має повний доступ
  if (role === 'admin') {
    return ['*'];
  }

  if (!ROLE_SHEET_ID) {
    return [];
  }

  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  for (var i = 0; i < data.length; i++) {
    var rName = (data[i][0] || "").toString().trim().toLowerCase();
    if (!rName) continue;

    if (rName === role) {
      var raw = data[i][1] ? data[i][1].toString().trim() : "";
      if (!raw) return [];
      if (raw === '*') return ['*'];

      // пробуємо JSON
      try {
        var perms = JSON.parse(raw);
        if (Array.isArray(perms)) {
          // унікальні
          var uniq = {};
          perms.forEach(function (p) { uniq[p] = true; });
          return Object.keys(uniq);
        }
      } catch (e) {
        // Якщо не JSON — сприймаємо як список через кому
        var parts = raw.split(',').map(function (s) { return s.trim(); });
        var uniq2 = {};
        parts.forEach(function (p) { if (p) uniq2[p] = true; });
        return Object.keys(uniq2);
      }
    }
  }

  return [];
}

/**
 * Службова функція: згенерувати хеш для конкретного пароля
 * Запускається вручну з редактора, щоб заповнити auth_db.
 */
function GET_HASH_FOR_DB() {
  var myPassword = Browser.inputBox("Введіть пароль, щоб згенерувати HASH:");
  if (!myPassword) {
    Logger.log("No password entered");
    return;
  }
  var h = _hash(myPassword);
  Logger.log("HASH: " + h);
  SpreadsheetApp.getActiveSpreadsheet().toast("HASH в логах: " + h);
}
