Мой проект шахмат онлайн

## Supabase RPC для takeback

В проекте используется серверная атомарная логика отката хода через RPC:
- SQL функция: `public.resolve_takeback_atomic(...)` (файл `supabase-schema.sql`)
- Клиентский вызов: `window.resolveTakebackAtomic(roomId, payload)` (файл `js/firebase.js`)
- UI-интеграция кнопок takeback: `js/controls.js`

### Поддерживаемые действия
- `request` — отправить запрос на откат
- `accept` — принять откат (с передачей `fenAfterUndo` и `pgnAfterUndo`)
- `reject` — отклонить запрос

### Типовые ошибки RPC
- `No takeback request`
- `Game already finished`
- `Auth uid mismatch`
