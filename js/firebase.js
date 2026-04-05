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
            reactions: game.reactions || []
        };
    };

    const fromDbGame = (row) => {
        if (!row) return null;
        return {
            players: row.players || null,
            pgn: row.pgn || '',
            fen: row.fen || 'start',
            gameState: row.game_state || 'active',
            message: row.message || null,
            lastMoveTime: row.last_move_time || row.created_at || null,
            createdAt: row.created_at || null,
            takebackRequest: row.takeback_request || null,
            drawRequest: row.draw_request || null,
            turn: row.turn || null,
            lastMove: row.last_move || null,
            resign: row.resign || null,
            reactions: row.reactions || []
        };
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
        return patch;
    };

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

    window.updateGame = function updateGame(gameRef, data) {
        return window.update(gameRef, data);
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
    window.watchGames = function watchGames(callback) {
        const emitGames = async () => {
            const snap = await window.get(window.ref(null, 'games'));
            callback(snap);
        };

        emitGames();

        const channel = supabase
            .channel(`games-lobby-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, emitGames)
            .subscribe();

        gamesChannels.add(channel);

        return () => {
            safeUnsubscribe(channel);
            gamesChannels.delete(channel);
        };
    };

    window.watchGame = function watchGame(gameRef, callback) {
        const roomId = gameRef.roomId;

        const emitGame = async () => {
            const snap = await window.get(window.getGameRef(roomId));
            callback(snap);
        };

        emitGame();

        const channel = supabase
            .channel(`game-${roomId}-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'games',
                filter: `room_id=eq.${roomId}`
            }, emitGame)
            .subscribe();

        if (!gameChannels.has(roomId)) gameChannels.set(roomId, []);
        gameChannels.get(roomId).push(channel);

        return () => {
            safeUnsubscribe(channel);
            const arr = gameChannels.get(roomId) || [];
            const next = arr.filter((c) => c !== channel);
            if (next.length) {
                gameChannels.set(roomId, next);
            } else {
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
        for (const roomChannels of gameChannels.values()) {
            roomChannels.forEach((channel) => safeUnsubscribe(channel));
        }
        gamesChannels.clear();
        gameChannels.clear();
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
