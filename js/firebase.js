// ==================== DATA LAYER (SUPABASE ADAPTER) ====================
// Отвечает за: операции чтения/записи и realtime-подписки.
//
// Stage 1 поддержки (безопасная чистка legacy-путаницы):
// - Это НЕ Firebase SDK.
// - Это compat-слой поверх Supabase.
// - Публичные глобальные имена (ref/get/set/update/onValue/...) оставлены
//   Firebase-style ТОЛЬКО ради совместимости со старым фронтом.
// - Любые новые изменения в data-layer нужно делать через Supabase-логику
//   внутри этого файла, а не через добавление "настоящего Firebase".
//
// Короткая карта соответствий:
// - "games/{roomId}" (compat path) -> таблица public.games (Supabase).
// - camelCase поля в UI -> snake_case поля в БД (через toDb*/fromDb*).

(function initDataAdapter() {
    const supabase = window.supabaseClient;

    if (!supabase) {
        console.error('Supabase client не инициализирован. Проверьте подключение js/supabase-config.js');
        return;
    }

    if (typeof window.watchFirebaseCleanup === 'function') {
        try {
            window.watchFirebaseCleanup();
        } catch (e) {
            console.warn('Failed to cleanup previous realtime subscriptions during re-init:', e);
        }
    }

    const gameChannels = new Map();
    const gamesChannels = new Set();
    const gameSubscribers = new Map();
    const gamesSubscribers = new Set();

    const safeUnsubscribe = (channel) => {
        if (!channel) return;
        try {
            channel.unsubscribe();
        } catch (e) {
            console.warn('Supabase channel unsubscribe failed:', e);
        }
        if (typeof supabase.removeChannel === 'function') {
            supabase.removeChannel(channel).catch((e) => {
                console.warn('Supabase removeChannel failed:', e);
            });
        }
    };

    const toDbGame = (roomId, game) => {
        if (!game) return null;
        return {
            room_id: roomId,
            players: game.players || null,
            pgn: game.pgn || '',
            fen: game.fen || 'start',
            game_state: game.gameState || 'active',
            message: game.message || null,
            last_move_time: game.lastMoveTime || game.createdAt || Date.now(),
            created_at: game.createdAt || Date.now(),
            takeback_request: game.takebackRequest || null,
            draw_request: game.drawRequest || null,
            turn: game.turn || null,
            last_move: game.lastMove || null,
            resign: game.resign || null,
            reactions: game.reactions || [],
            quick_phrase: game.quickPhrase || null,
            rematch_request: game.rematchRequest || null
        };
    };

    const fromDbGame = (row) => {
        if (!row) return null;
        return {
            players: row.players || null,
            pgn: row.pgn || '',
            fen: row.fen || 'start',
            version: row.version ?? 0,
            gameState: row.game_state || 'active',
            message: row.message || null,
            lastMoveTime: row.last_move_time || row.created_at || null,
            createdAt: row.created_at || null,
            takebackRequest: row.takeback_request || null,
            drawRequest: row.draw_request || null,
            turn: row.turn || null,
            lastMove: row.last_move || null,
            resign: row.resign || null,
            reactions: row.reactions || [],
            quickPhrase: row.quick_phrase || null,
            rematchRequest: row.rematch_request || null
        };
    };

    // Частичный маппер для realtime UPDATE payload:
    // переносит только реально присутствующие в payload поля (без default-ов),
    // чтобы не затирать cache, если payload пришёл неполным.
    const fromDbGamePartial = (row) => {
        if (!row) return null;
        const patch = {};
        if (Object.prototype.hasOwnProperty.call(row, 'players')) patch.players = row.players ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'pgn')) patch.pgn = row.pgn ?? '';
        if (Object.prototype.hasOwnProperty.call(row, 'fen')) patch.fen = row.fen ?? 'start';
        if (Object.prototype.hasOwnProperty.call(row, 'version')) patch.version = row.version ?? 0;
        if (Object.prototype.hasOwnProperty.call(row, 'game_state')) patch.gameState = row.game_state ?? 'active';
        if (Object.prototype.hasOwnProperty.call(row, 'message')) patch.message = row.message ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'last_move_time')) patch.lastMoveTime = row.last_move_time ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'created_at')) patch.createdAt = row.created_at ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'takeback_request')) patch.takebackRequest = row.takeback_request ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'draw_request')) patch.drawRequest = row.draw_request ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'turn')) patch.turn = row.turn ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'last_move')) patch.lastMove = row.last_move ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'resign')) patch.resign = row.resign ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'reactions')) patch.reactions = row.reactions ?? [];
        if (Object.prototype.hasOwnProperty.call(row, 'quick_phrase')) patch.quickPhrase = row.quick_phrase ?? null;
        if (Object.prototype.hasOwnProperty.call(row, 'rematch_request')) patch.rematchRequest = row.rematch_request ?? null;
        return patch;
    };

    const toDbPatch = (data) => {
        const patch = {};
        if (Object.prototype.hasOwnProperty.call(data, 'players')) patch.players = data.players;
        if (Object.prototype.hasOwnProperty.call(data, 'pgn')) patch.pgn = data.pgn;
        if (Object.prototype.hasOwnProperty.call(data, 'fen')) patch.fen = data.fen;
        if (Object.prototype.hasOwnProperty.call(data, 'gameState')) patch.game_state = data.gameState;
        if (Object.prototype.hasOwnProperty.call(data, 'message')) patch.message = data.message;
        if (Object.prototype.hasOwnProperty.call(data, 'lastMoveTime')) patch.last_move_time = data.lastMoveTime;
        if (Object.prototype.hasOwnProperty.call(data, 'createdAt')) patch.created_at = data.createdAt;
        if (Object.prototype.hasOwnProperty.call(data, 'takebackRequest')) patch.takeback_request = data.takebackRequest;
        if (Object.prototype.hasOwnProperty.call(data, 'drawRequest')) patch.draw_request = data.drawRequest;
        if (Object.prototype.hasOwnProperty.call(data, 'turn')) patch.turn = data.turn;
        if (Object.prototype.hasOwnProperty.call(data, 'lastMove')) patch.last_move = data.lastMove;
        if (Object.prototype.hasOwnProperty.call(data, 'resign')) patch.resign = data.resign;
        if (Object.prototype.hasOwnProperty.call(data, 'reactions')) patch.reactions = data.reactions;
        if (Object.prototype.hasOwnProperty.call(data, 'quickPhrase')) patch.quick_phrase = data.quickPhrase;
        if (Object.prototype.hasOwnProperty.call(data, 'rematchRequest')) patch.rematch_request = data.rematchRequest;
        return patch;
    };

    // Минимальный безопасный набор полей для лобби-кеша (watchGames):
    // - players: участники, имена, аватары, direct invite metadata
    // - game_state: active/finished для секций и правил
    // - last_move_time/created_at: сортировка и timeAgo
    // - turn/pgn: "Ваш ход" + определение старта партии + fallback для legacy
    // - message/resign: подписи результата завершённых партий
    //
    // ВАЖНО: это влияет только на initial hydrate лобби-кеша.
    // get(game)/watchGame по конкретной комнате продолжают читать select('*').
    const LOBBY_GAMES_SELECT_FIELDS_LEGACY = [
        'room_id',
        'players',
        'game_state',
        'last_move_time',
        'created_at',
        'turn',
        'pgn',
        'message',
        'resign'
    ].join(',');

    const LOBBY_GAMES_SELECT_FIELDS_EXTENDED = [
        LOBBY_GAMES_SELECT_FIELDS_LEGACY,
        'rematch_request'
    ].join(',');

    const makeSnapshot = (value) => ({
        val: () => value,
        exists: () => value !== null && value !== undefined
    });

    const isGameRoot = (path) => /^games\/[^/]+$/.test(path);
    const isGamesRoot = (path) => path === 'games';

    // Firebase-style ref(db, path): параметр db намеренно игнорируется.
    // Он сохраняется в сигнатуре только для обратной совместимости вызовов.
    window.ref = function ref(_db, path) {
        return { path, type: 'path' };
    };

    window.getGameRef = function getGameRef(roomId) {
        return { path: `games/${roomId}`, roomId, type: 'game' };
    };

    window.getPlayersRef = function getPlayersRef(roomId) {
        return { path: `games/${roomId}/players`, roomId, field: 'players', type: 'field' };
    };

    window.getTakebackRef = function getTakebackRef(roomId) {
        return { path: `games/${roomId}/takebackRequest`, roomId, field: 'takebackRequest', type: 'field' };
    };

    window.getDrawRef = function getDrawRef(roomId) {
        return { path: `games/${roomId}/drawRequest`, roomId, field: 'drawRequest', type: 'field' };
    };

    window.getRematchRef = function getRematchRef(roomId) {
        return { path: `games/${roomId}/rematchRequest`, roomId, field: 'rematchRequest', type: 'field' };
    };

    // Firebase-like get(): снаружи возвращает snapshot-объект в старом стиле,
    // внутри читает данные из Supabase.
    window.get = async function get(refObj) {
        if (!refObj?.path) return makeSnapshot(null);

        if (isGamesRoot(refObj.path)) {
            const { data, error } = await supabase.from('games').select('*');
            if (error) {
                console.error('get(games) error:', error);
                return makeSnapshot(null);
            }
            const mapped = {};
            (data || []).forEach((row) => { mapped[row.room_id] = fromDbGame(row); });
            return makeSnapshot(Object.keys(mapped).length ? mapped : null);
        }

        if (isGameRoot(refObj.path)) {
            const roomId = refObj.roomId || refObj.path.split('/')[1];
            const { data, error } = await supabase.from('games').select('*').eq('room_id', roomId).maybeSingle();
            if (error) {
                console.error('get(game) error:', error);
                return makeSnapshot(null);
            }
            return makeSnapshot(fromDbGame(data));
        }

        if (refObj.type === 'field') {
            const gameSnap = await window.get(window.getGameRef(refObj.roomId));
            const game = gameSnap.val();
            return makeSnapshot(game ? game[refObj.field] ?? null : null);
        }

        return makeSnapshot(null);
    };

    // Firebase-like set(): полный upsert/delete игры в таблице games.
    window.set = async function set(refObj, value) {
        if (!refObj?.path) return;

        if (isGameRoot(refObj.path)) {
            const roomId = refObj.roomId || refObj.path.split('/')[1];
            if (value === null) {
                const { error } = await supabase.from('games').delete().eq('room_id', roomId);
                if (error) throw error;
                return;
            }
            const row = toDbGame(roomId, value);
            const { error } = await supabase.from('games').upsert(row, { onConflict: 'room_id' });
            if (error) throw error;
            return;
        }

        if (refObj.type === 'field') {
            const patch = {};
            patch[refObj.field] = value;
            return window.update(window.getGameRef(refObj.roomId), patch);
        }
    };

    // Firebase-like update(): частичное обновление игры (patch в БД).
    window.update = async function update(refObj, data) {
        if (!refObj?.roomId) return;
        const patch = toDbPatch(data || {});
        const { error } = await supabase.from('games').update(patch).eq('room_id', refObj.roomId);
        if (error) throw error;
    };

    // Legacy path: сохраняется для обратной совместимости.
    // После перехода на RPC не использовать для критичных мутаций хода.
    window.updateGame = function updateGame(gameRef, data) {
        return window.update(gameRef, data);
    };


    window.resignGameAtomic = async function resignGameAtomic(roomId, payload) {
        if (!roomId) {
            throw new Error('resignGameAtomic: roomId is required');
        }
        if (!payload || typeof payload !== 'object') {
            throw new Error('resignGameAtomic: payload is required');
        }

        const { data, error } = await supabase.rpc('resign_game_atomic', {
            p_room_id: roomId,
            p_uid: payload.uid,
            p_player_color: payload.playerColor
        });

        if (error) {
            console.error('[resignGameAtomic] RPC error:', error);
            throw error;
        }

        return data ? fromDbGame(data) : null;
    };
    window.applyMoveAtomic = async function applyMoveAtomic(roomId, payload) {
        if (!roomId) throw new Error('applyMoveAtomic: roomId is required');
        if (!payload) throw new Error('applyMoveAtomic: payload is required');

        const { data, error } = await supabase.rpc('apply_move_atomic', {
            p_room_id: roomId,
            p_uid: payload.uid,
            p_expected_version: payload.expectedVersion,
            p_next_pgn: payload.pgn,
            p_next_fen: payload.fen,
            p_next_turn: payload.turn,
            p_last_move: payload.lastMove,
            p_game_over: Boolean(payload.gameOver),
            p_message: payload.message || null
        });

        if (error) {
            console.error('[applyMoveAtomic] RPC error:', error);
            throw error;
        }

        if (data) return fromDbGame(data);
        return null;
    };

    // LEGACY-COMPAT helper (Firebase-like API shape).
    // ВАЖНО: это НЕ настоящая БД-транзакция, а read-modify-write цикл.
    // Он не обеспечивает серверную атомарность и может терять обновления
    // при конкурентных запросах.
    //
    // Разрешён только для low-contention/legacy сценариев, где гонки
    // не критичны.
    // НЕ использовать для join-room и любых high-concurrency операций:
    // для них обязателен RPC/серверная атомарность (см. addPlayerToGame ->
    // join_game_player_with_color).
    window.runTransaction = async function runTransaction(playersRef, updater) {
        const snap = await window.get(playersRef);
        const current = snap.val();
        const next = updater(current);
        if (next === undefined) return { committed: false, snapshot: makeSnapshot(current) };
        await window.update(window.getGameRef(playersRef.roomId), { players: next });
        return { committed: true, snapshot: makeSnapshot(next) };
    };

    const joinPlayerAtomically = async (roomId, uid, uName, preferredColor = null) => {
        const { data, error } = await supabase.rpc('join_game_player_with_color', {
            p_room_id: roomId,
            p_uid: uid,
            p_name: uName,
            p_preferred_color: preferredColor
        });

        if (error) throw error;
        return data || null;
    };

    // Предпочтительный и безопасный путь для присоединения игрока к партии:
    // атомарный серверный RPC (а НЕ runTransaction/read-modify-write).
    window.addPlayerToGame = async function addPlayerToGame(playersRef, uid, uName, preferredColor = null) {
        try {
            return await joinPlayerAtomically(playersRef.roomId, uid, uName, preferredColor);
        } catch (err) {
            console.error('Atomic addPlayerToGame error:', err);
            throw err;
        }
    };

    window.createGame = async function createGame(roomId, pgn, fen) {
        const now = Date.now();
        return window.set(window.getGameRef(roomId), {
            pgn,
            fen,
            gameState: 'active',
            createdAt: now,
            lastMoveTime: now
        });
    };

    // watchGames/watchGame/onValue имитируют Firebase realtime API,
    // но технически работают через Supabase Realtime channels.
    // In-memory cache лобби:
    // - первичная гидратация делается один раз при первом watchGames;
    // - далее обновляется инкрементально из realtime INSERT/UPDATE/DELETE.
    const lobbyGamesCache = new Map();
    let isLobbyGamesCacheHydrated = false;
    let lobbyGamesCacheHydrationPromise = null;
    const pendingLobbyRealtimeEvents = [];

    const getLobbyGameSignature = (game) => {
        if (!game) return '';
        return JSON.stringify([
            game.players || null,
            game.gameState || null,
            game.lastMoveTime || null,
            game.createdAt || null,
            game.turn || null,
            game.pgn || null,
            game.message || null,
            game.resign || null,
            game.rematchRequest || null
        ]);
    };

    const makeGamesSnapshotFromCache = () => {
        if (lobbyGamesCache.size === 0) return makeSnapshot(null);
        const games = {};
        for (const [roomId, game] of lobbyGamesCache.entries()) {
            games[roomId] = game;
        }
        return makeSnapshot(games);
    };

    const emitGamesToSubscribers = () => {
        const snap = makeGamesSnapshotFromCache();
        for (const cb of gamesSubscribers) cb(snap);
    };

    const hydrateLobbyGamesCache = async () => {
        if (isLobbyGamesCacheHydrated) return;
        if (lobbyGamesCacheHydrationPromise) {
            await lobbyGamesCacheHydrationPromise;
            return;
        }

        lobbyGamesCacheHydrationPromise = (async () => {
            let data = null;
            let error = null;

            ({ data, error } = await supabase.from('games').select(LOBBY_GAMES_SELECT_FIELDS_EXTENDED));

            if (error) {
                const message = String(error?.message || '');
                const details = String(error?.details || '');
                const hint = String(error?.hint || '');
                const isMissingRematchColumn = /rematch_request/i.test(`${message} ${details} ${hint}`);

                if (!isMissingRematchColumn) {
                    console.error('watchGames initial cache hydrate error:', error);
                    throw error;
                }

                console.warn('watchGames: rematch_request column is unavailable, fallback to legacy lobby fields');
                ({ data, error } = await supabase.from('games').select(LOBBY_GAMES_SELECT_FIELDS_LEGACY));
                if (error) {
                    console.error('watchGames legacy fallback hydrate error:', error);
                    throw error;
                }
            }

            lobbyGamesCache.clear();
            (data || []).forEach((row) => {
                if (!row?.room_id) return;
                lobbyGamesCache.set(row.room_id, fromDbGame(row));
            });
            isLobbyGamesCacheHydrated = true;
            // Важно для гонки "realtime раньше hydration":
            // события, пришедшие до завершения initial hydrate-select,
            // применяем строго после полной гидратации cache.
            while (pendingLobbyRealtimeEvents.length > 0) {
                const event = pendingLobbyRealtimeEvents.shift();
                applyLobbyGamesRealtimePayload(event, { allowBuffering: false });
            }
        })();

        try {
            await lobbyGamesCacheHydrationPromise;
        } finally {
            lobbyGamesCacheHydrationPromise = null;
        }
    };

    const applyLobbyGamesRealtimePayload = (payload, options = {}) => {
        const allowBuffering = options.allowBuffering !== false;
        if (!payload) return;

        // Пока не завершена initial hydration, не мутируем cache:
        // буферизуем событие и применим его после hydrate.
        if (!isLobbyGamesCacheHydrated && allowBuffering) {
            pendingLobbyRealtimeEvents.push(payload);
            return;
        }

        const eventType = payload.eventType;
        const newRow = payload.new || null;
        const oldRow = payload.old || null;
        const roomId = newRow?.room_id || oldRow?.room_id;
        if (!roomId) {
            console.warn('watchGames realtime payload without room_id:', payload);
            return;
        }

        if (eventType === 'DELETE') {
            lobbyGamesCache.delete(roomId);
            emitGamesToSubscribers();
            return;
        }

        if (eventType === 'INSERT') {
            if (!newRow) {
                console.warn('watchGames INSERT payload without new row:', payload);
                return;
            }
            const mapped = fromDbGame(newRow);
            if (!mapped) return;
            const previous = lobbyGamesCache.get(roomId) || null;
            if (getLobbyGameSignature(previous) === getLobbyGameSignature(mapped)) return;
            lobbyGamesCache.set(roomId, mapped);
            emitGamesToSubscribers();
            return;
        }

        if (eventType === 'UPDATE') {
            if (!newRow) {
                console.warn('watchGames UPDATE payload without new row:', payload);
                return;
            }
            const cached = lobbyGamesCache.get(roomId) || {};
            const patch = fromDbGamePartial(newRow) || {};
            const next = { ...cached, ...patch };
            if (getLobbyGameSignature(cached) === getLobbyGameSignature(next)) return;
            lobbyGamesCache.set(roomId, next);
            emitGamesToSubscribers();
        }
    };

    const ensureGamesChannel = () => {
        if (gamesChannels.size > 0) return;
        const channel = supabase
            .channel(`games-lobby-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, applyLobbyGamesRealtimePayload)
            .subscribe();
        gamesChannels.add(channel);
    };

    const emitGameToSubscribers = async (roomId) => {
        const callbacks = gameSubscribers.get(roomId);
        if (!callbacks || callbacks.size === 0) return;
        const snap = await window.get(window.getGameRef(roomId));
        for (const cb of callbacks) cb(snap);
    };

    const ensureGameChannel = (roomId) => {
        if (gameChannels.has(roomId)) return;
        const channel = supabase
            .channel(`game-${roomId}-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'games',
                filter: `room_id=eq.${roomId}`
            }, () => emitGameToSubscribers(roomId))
            .subscribe();
        gameChannels.set(roomId, channel);
    };

    window.watchGames = function watchGames(callback) {
        gamesSubscribers.add(callback);
        ensureGamesChannel();
        // Первый запуск: один запрос на полный список игр.
        // Далее отправляем подписчикам только слепки из локального cache,
        // который инкрементально поддерживается realtime-событиями.
        hydrateLobbyGamesCache()
            .then(() => {
                ensureGamesChannel();
                callback(makeGamesSnapshotFromCache());
            })
            .catch((e) => {
                console.error('watchGames initial snapshot error:', e);
                // Если hydration не удалась, кеш остаётся негидратированным.
                // Это предотвращает частичное состояние; при следующем
                // вызове watchGames будет повторная попытка hydrate.
                lobbyGamesCache.clear();
                pendingLobbyRealtimeEvents.length = 0;
                isLobbyGamesCacheHydrated = false;
                callback(makeSnapshot(null));
            });

        return () => {
            gamesSubscribers.delete(callback);
            if (gamesSubscribers.size === 0) {
                for (const channel of gamesChannels) safeUnsubscribe(channel);
                gamesChannels.clear();
                lobbyGamesCache.clear();
                pendingLobbyRealtimeEvents.length = 0;
                isLobbyGamesCacheHydrated = false;
                lobbyGamesCacheHydrationPromise = null;
            }
        };
    };

    window.watchGame = function watchGame(gameRef, callback) {
        const roomId = gameRef.roomId;

        if (!roomId) return () => {};
        if (!gameSubscribers.has(roomId)) gameSubscribers.set(roomId, new Set());
        gameSubscribers.get(roomId).add(callback);
        ensureGameChannel(roomId);
        window.get(window.getGameRef(roomId)).then(callback);

        return () => {
            const callbacks = gameSubscribers.get(roomId);
            if (!callbacks) return;
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                gameSubscribers.delete(roomId);
                const channel = gameChannels.get(roomId);
                safeUnsubscribe(channel);
                gameChannels.delete(roomId);
            }
        };
    };

    window.onValue = function onValue(refObj, callback) {
        if (refObj.type === 'game' || isGameRoot(refObj.path || '')) {
            return window.watchGame(refObj, callback);
        }

        if (refObj.type === 'field') {
            const emitField = async () => {
                const snap = await window.get(refObj);
                callback(snap);
            };
            emitField();

            return window.watchGame(window.getGameRef(refObj.roomId), async () => {
                const snap = await window.get(refObj);
                callback(snap);
            });
        }

        if (isGamesRoot(refObj.path || '')) {
            return window.watchGames(callback);
        }

        return () => {};
    };

    // Legacy имя сохранено намеренно (не переименовывать на этом этапе).
    // Функция чистит именно Supabase realtime-подписки.
    window.watchFirebaseCleanup = function watchFirebaseCleanup() {
        for (const channel of gamesChannels) safeUnsubscribe(channel);
        for (const channel of gameChannels.values()) safeUnsubscribe(channel);
        gamesChannels.clear();
        gameChannels.clear();
        gamesSubscribers.clear();
        gameSubscribers.clear();
    };

    if (!window.__supabaseRealtimeCleanupBound) {
        const cleanupRealtimeOnLeave = () => window.watchFirebaseCleanup();
        window.addEventListener('pagehide', cleanupRealtimeOnLeave);
        window.addEventListener('beforeunload', cleanupRealtimeOnLeave);
        window.__supabaseRealtimeCleanupBound = true;
    }

    // Legacy no-op: ранее ожидали Firebase init, теперь источник истины —
    // инициализированный Supabase client из js/supabase-config.js.
    window.waitForFirebase = function waitForFirebase() {
        return Promise.resolve();
    };
})();
