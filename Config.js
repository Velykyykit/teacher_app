// ==========================================
// CONFIG & REGISTRY
// ==========================================

// ID таблиці base_id зберігається в Script Properties
//  base_id  -> Spreadsheet з KEY / VALUE / SHEET_NAME / DESCRIPTION
var REGISTRY_ID = PropertiesService.getScriptProperties().getProperty('base_id');

// Сіль для хешування паролів
//  global_sol -> будь-який випадковий рядок
var GLOBAL_SALT = PropertiesService.getScriptProperties().getProperty('global_sol');

// ID таблиці ролей (файл Roles)
var ROLE_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Roles');

// ID таблиці заявок на реєстрацію (файл reg) – опційно
var REG_SHEET_ID  = PropertiesService.getScriptProperties().getProperty('reg');

// Час життя токена авторизації (години)
var AUTH_TTL_HOURS = 24 * 7; // 7 днів

// Оголошення модулів інтерфейсу
// id — для перевірки доступу, file — ім'я html-файлу
var APP_MODULES = [
  { id: 'dashboard', file: 'dashboard', icon: 'home',    title: 'Головна',     desc: 'Панель' },
  { id: 'groups',    file: 'groups',    icon: 'school',  title: 'Групи',       desc: 'Керування групами' },
  { id: 'students',  file: 'students',  icon: 'group',   title: 'Студенти',    desc: 'База студентів' },
  { id: 'load',      file: 'load',      icon: 'pie_chart', title: 'Навантаження', desc: 'Години викладачів' },
  { id: 'schedule',  file: 'schedule',  icon: 'calendar_today', title: 'Розклад', desc: 'Розклад занять' },
  { id: 'grading',   file: 'grading',   icon: 'edit_note', title: 'Журнал',   desc: 'Оцінювання' }
  // Адмін-панель додамо пізніше, коли зʼявиться повний бекенд
];

/**
 * Зчитує таблицю base_id і повертає конфіг обʼєктом.
 * ОПТИМІЗОВАНО: Використовує CacheService, щоб не читати таблицю щоразу.
 */
function getSystemConfig() {
  // 1. Спробуємо дістати з кешу (швидка пам'ять)
  var cache = CacheService.getScriptCache();
  var cachedJson = cache.get("SYSTEM_CONFIG");

  if (cachedJson) {
    try {
      return JSON.parse(cachedJson);
    } catch (e) {
      console.warn("Помилка парсингу кешу конфігу, читаємо з таблиці заново.");
    }
  }

  // 2. Якщо в кеші немає — читаємо з таблиці (повільно)
  if (!REGISTRY_ID) {
    throw new Error("❌ Не задано Script Property 'base_id' (ID таблиці base_id)");
  }

  var ss = SpreadsheetApp.openById(REGISTRY_ID);
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var config = {};
  // Очікуємо структуру: A=KEY, B=VALUE(ID), C=SHEET_NAME
  for (var i = 1; i < data.length; i++) {
    var key       = data[i][0];
    var valueId   = data[i][1];
    var sheetName = data[i][2];

    if (key && valueId) {
      config[key.toString().trim()] = {
        id: valueId.toString().trim(),
        sheetName: sheetName ? sheetName.toString().trim() : null
      };
    }
  }

  // 3. Зберігаємо в кеш на 6 годин (21600 секунд)
  try {
    cache.put("SYSTEM_CONFIG", JSON.stringify(config), 21600);
  } catch (e) {
    console.warn("Кеш переповнено або помилка запису", e);
  }

  return config;
}

/**
 * Повертає список модулів для фронтенду (щоб можна було намалювати меню).
 */
function apiGetModuleConfig() {
  return APP_MODULES;
}
