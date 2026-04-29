# GoChess — онлайн-шахматы

Небольшой веб-проект для игры в шахматы онлайн с лобби, партиями в реальном времени и режимом против бота.

## Стек

- Frontend: HTML/CSS/JavaScript
- Realtime/data layer: Supabase (через compat-слой в `js/firebase.js`)
- Шахматная логика: `Chess.js` + UI в `js/game-core.js`

## Ключевые файлы

- `index.html` — точка входа.
- `js/game-core.js` — основная игровая логика, управление ходами и состояниями партии.
- `js/controls.js` — обработчики UI-кнопок и игровых действий.
- `js/firebase.js` — адаптер data-layer (Firebase-style API поверх Supabase).
- `supabase-schema.sql` — SQL-схема и серверные функции.

## Ничья (draw flow)

Логика ничьей переведена на атомарный серверный RPC:

- клиент вызывает `window.resolveDrawAtomic(roomId, payload)` (см. `js/firebase.js`);
- RPC `resolve_draw_atomic` обрабатывает действия:
  - `request` — предложить ничью,
  - `accept` — принять ничью,
  - `reject` — отклонить ничью;
- публичные клиентские функции сохранены без изменения сигнатур:
  - `window.sendDrawRequest(gameRef, roomId)`,
  - `window.acceptDraw(gameRef, roomId)`,
  - `window.rejectDraw(gameRef, roomId)`.

Это позволяет избежать гонок при одновременных действиях игроков и держать бизнес-логику в одном месте — на сервере.

## Локальный запуск

1. Поднять/настроить Supabase проект и схему из `supabase-schema.sql`.
2. Проверить конфиг клиента Supabase в `js/supabase-config.js`.
3. Открыть проект через локальный веб-сервер (например, `npx serve` или аналог).
