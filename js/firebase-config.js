// LEGACY COMPAT STUB (Firebase -> Supabase migration)
// ------------------------------------------------------------------
// Этот файл намеренно оставлен пустым по функционалу.
// Раньше здесь инициализировался Firebase, но после миграции
// единственный источник конфигурации — js/supabase-config.js.
//
// Зачем оставлять файл:
// 1) безопасно для старых ссылок/закладок на путь js/firebase-config.js;
// 2) даёт явный сигнал в консоли, если файл кто-то всё ещё подключает.
(function legacyFirebaseConfigStub() {
    if (window.__legacyFirebaseConfigWarned) return;
    window.__legacyFirebaseConfigWarned = true;
    console.info('[legacy] js/firebase-config.js is deprecated. Use js/supabase-config.js');
})();
