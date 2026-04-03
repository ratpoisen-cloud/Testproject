# MIGRATION TO SUPABASE

## Что сделано

Миграция выполнена через **адаптерный слой**, чтобы не переписывать UI и игровую логику:

- Firebase-скрипт в `index.html` заменён на Supabase SDK + `js/supabase-config.js`.
- В `js/firebase.js` оставлены старые имена функций (`getGameRef`, `watchGame`, `createGame`, `updateGame` и т.д.), но внутри они теперь работают через Supabase.
- `auth.js`, `game-core.js`, `controls.js` в основном остаются прежними и используют тот же API, что минимизирует риск поломки UX.
- Добавлена проверка авторизации перед созданием/входом в игру (с учётом RLS только для authenticated).

## Изменённые файлы

- `index.html`
- `js/firebase.js`
- `js/game-core.js`

## Новые файлы

- `js/supabase-config.js`
- `supabase-schema.sql`
- `MIGRATION_TO_SUPABASE.md`

## Что нужно создать в Supabase

1. Откройте **Supabase SQL Editor**.
2. Выполните файл `supabase-schema.sql` целиком.
3. Убедитесь, что таблица `public.games` создана.
4. Убедитесь, что таблица добавлена в publication `supabase_realtime`.

## Настройки Auth

В Supabase Dashboard:

1. Откройте **Authentication → Providers**.
2. Включите `Email` provider.
3. Включите `Google` provider и заполните client id / secret от Google Cloud.
4. В **Authentication → URL Configuration** укажите:
   - **Site URL**: базовый URL приложения (например, `https://your-domain.com`).
   - **Redirect URLs** (обязательно):
     - `http://localhost:...` (ваш локальный URL)
     - `https://ваш-домен/...` (production URL)
     - если используете разные пути (например `/?room=...`), достаточно того же origin/path, так как query-параметры (`room`) передаются текущим redirect flow.

> Google OAuth в проекте работает через `signInWithOAuth` (redirect flow). После авторизации Supabase возвращает пользователя обратно на URL приложения.

### Email confirmation и текущий UX

- Текущий UX рассчитан на быстрый вход после регистрации.
- Если в Supabase включён `Confirm email`, после `signUp` сессия может отсутствовать до подтверждения почты.
- В коде это обработано сообщением пользователю: *«Аккаунт создан. Подтвердите email, затем выполните вход.»*.
- Для максимально близкого к старому UX MVP рекомендуется **выключить Confirm email**: `Authentication → Providers → Email`.

## Настройка фронтенда

Откройте `js/supabase-config.js` и вставьте:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Пример:

```js
const SUPABASE_URL = 'https://abcxyzcompany.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

## Проверка после миграции

1. Запустите проект.
2. Проверьте Email регистрацию и Email логин.
3. Проверьте Google вход (должен увести на OAuth и вернуть в приложение).
4. Создайте комнату и откройте её во второй вкладке/браузере.
5. Проверьте:
   - синхронизацию ходов почти в реальном времени;
   - лобби-обновления;
   - draw/takeback сценарии;
   - завершение партии/реванш;
   - удаление завершённых партий.

## Важные замечания по текущему MVP

- В `js/firebase.js` транзакция добавления игрока реализована как read-modify-write (не full DB transaction).
- Для высокой конкурентности можно улучшить это через SQL RPC с блокировкой строки.
- RLS сделан безопасным для MVP (доступ только участникам игры), но остаётся пространство для ужесточения через RPC-процедуры.
