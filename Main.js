// ==========================================
// MAIN WEB ENTRY
// ==========================================

/**
 * Стартова точка веб-додатку.
 * Рендерить index.html і підʼєднує всі модулі через include().
 */
function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  // Передаємо список модулів у шаблон (якщо захочеш використати)
  template.modules = APP_MODULES;

  return template
    .evaluate()
    .setTitle('Teacher System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // щоб можна було вбудовувати в інші сайти
}

/**
 * Допоміжна функція для вставки HTML-файлів у index.html
 * Викликається як:  <?!= include('dashboard'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
