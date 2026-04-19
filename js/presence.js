// ==================== PRESENCE / STATUS LAYER ====================
// Отвечает за: онлайн-статус пользователя и ручные быстрые статусы.
// Отдельный пользовательский слой. Не связан с логикой ходов/партии.

(function initPresenceLayer() {
    const supabase = window.supabaseClient;
    const ONLINE_HEARTBEAT_MS = 70 * 1000;
    const RECENTLY_SEEN_MS = 5 * 60 * 1000;
    const HEARTBEAT_INTERVAL_MS = 55 * 1000;
    const ACTIVITY_THROTTLE_MS = 45 * 1000;
    const ONLINE_STATE_MIN_WRITE_GAP_MS = 10 * 1000;
    const LAST_SEEN_MIN_WRITE_GAP_MS = 30 * 1000;

    const MANUAL_STATUS_PRESETS = {
        away_5: { key: 'away_5', text: 'Отошёл на 5 минут', ttlMs: 5 * 60 * 1000 },
        back_10: { key: 'back_10', text: 'Вернусь через 10 минут', ttlMs: 10 * 60 * 1000 },
        working: { key: 'working', text: 'Работаю', ttlMs: null },
        dnd: { key: 'dnd', text: 'Не беспокоить', ttlMs: null }
    };

    const cache = new Map();
    const listeners = new Set();
    const pendingUidLoads = new Set();
    const trackedUids = new Set();
    let realtimeChannel = null;
    let heartbeatTimer = null;
    let expiryTimer = null;
    let lastActivitySentAt = 0;
    let lastPresenceWriteKey = '';
    let activeUserId = null;
    let isStarted = false;
    let lastOnlineStateWriteAt = 0;

    const now = () => Date.now();

    const emit = (changedUid = null) => {
        listeners.forEach((cb) => {
            try {
                cb(changedUid);
            } catch (error) {
                console.warn('Presence listener error:', error);
            }
        });
    };

    const setCache = (row) => {
        if (!row?.uid) return;
        const nextValue = {
            uid: row.uid,
            isOnline: Boolean(row.is_online),
            lastSeenAt: Number(row.last_seen_at || 0),
            manualStatus: row.manual_status || null,
            manualStatusText: row.manual_status_text || null,
            manualStatusExpiresAt: Number(row.manual_status_expires_at || 0) || null,
            updatedAt: Number(row.updated_at_ms || row.last_seen_at || 0)
        };
        const prev = cache.get(row.uid);
        const isSame = prev
            && prev.isOnline === nextValue.isOnline
            && prev.lastSeenAt === nextValue.lastSeenAt
            && prev.manualStatus === nextValue.manualStatus
            && prev.manualStatusText === nextValue.manualStatusText
            && prev.manualStatusExpiresAt === nextValue.manualStatusExpiresAt
            && prev.updatedAt === nextValue.updatedAt;
        if (isSame) return false;
        cache.set(row.uid, nextValue);
        return true;
    };

    const trackUids = (uids = []) => {
        (uids || []).forEach((uid) => {
            if (typeof uid !== 'string') return;
            const cleanUid = uid.trim();
            if (!cleanUid) return;
            trackedUids.add(cleanUid);
        });
    };

    const getCached = (uid) => cache.get(uid) || null;

    const buildWriteSignature = (payload) => {
        const own = getCached(activeUserId);
        if (!own) return '';
        const normalizedOnline = payload.is_online ?? own.isOnline;
        const normalizedManualStatus = payload.manual_status !== undefined ? payload.manual_status : own.manualStatus;
        const normalizedManualText = payload.manual_status_text !== undefined ? payload.manual_status_text : own.manualStatusText;
        const normalizedManualExpires = payload.manual_status_expires_at !== undefined
            ? (payload.manual_status_expires_at || null)
            : (own.manualStatusExpiresAt || null);
        return JSON.stringify({
            isOnline: Boolean(normalizedOnline),
            manualStatus: normalizedManualStatus || null,
            manualStatusText: normalizedManualText || null,
            manualStatusExpiresAt: normalizedManualExpires
        });
    };

    window.setTrackedPresenceUids = function setTrackedPresenceUids(uids = []) {
        const nextTracked = new Set();
        (uids || []).forEach((uid) => {
            if (typeof uid !== 'string') return;
            const cleanUid = uid.trim();
            if (!cleanUid) return;
            nextTracked.add(cleanUid);
        });
        if (activeUserId) nextTracked.add(activeUserId);
        trackedUids.clear();
        nextTracked.forEach((uid) => trackedUids.add(uid));
    };

    const scheduleExpiryCheck = () => {
        if (expiryTimer) {
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }

        const own = activeUserId ? getCached(activeUserId) : null;
        if (!own?.manualStatusExpiresAt) return;

        const delay = own.manualStatusExpiresAt - now();
        if (delay <= 0) {
            window.clearManualPresenceStatus?.();
            return;
        }

        expiryTimer = setTimeout(() => {
            window.clearManualPresenceStatus?.();
        }, delay + 50);
    };

    const sanitizeManualStatus = async () => {
        if (!activeUserId || !supabase) return;
        const own = getCached(activeUserId);
        if (!own?.manualStatus || !own.manualStatusExpiresAt) return;
        if (own.manualStatusExpiresAt > now()) return;

        await window.clearManualPresenceStatus?.();
    };

    const upsertPresence = async (patch) => {
        if (!supabase || !activeUserId) return;
        const own = getCached(activeUserId);
        const explicitLastSeenAt = Number(patch?.last_seen_at || 0);
        const hasLastSeenUpdate = Number.isFinite(explicitLastSeenAt) && explicitLastSeenAt > 0;
        if (own && hasLastSeenUpdate) {
            const lastSeenGap = explicitLastSeenAt - Number(own.lastSeenAt || 0);
            if (lastSeenGap > 0
                && lastSeenGap < LAST_SEEN_MIN_WRITE_GAP_MS
                && patch.manual_status === undefined
                && patch.manual_status_text === undefined
                && patch.manual_status_expires_at === undefined
                && patch.is_online === own.isOnline) {
                return;
            }
        }

        const writeKey = buildWriteSignature(patch);
        if (writeKey && own && !hasLastSeenUpdate && writeKey === lastPresenceWriteKey) {
            return;
        }

        const ts = now();
        const payload = {
            uid: activeUserId,
            updated_at_ms: ts,
            ...patch
        };

        const { error } = await supabase
            .from('user_presence')
            .upsert(payload, { onConflict: 'uid' });
        if (error) {
            console.warn('Presence upsert error:', error);
            return;
        }
        if (writeKey) {
            lastPresenceWriteKey = writeKey;
        }
        if (setCache(payload)) {
            emit(activeUserId);
        }
    };

    const sendHeartbeat = async ({ force = false, markOnline = true } = {}) => {
        if (!activeUserId) return;
        const ts = now();
        const own = getCached(activeUserId);
        if (!force && ts - lastActivitySentAt < ACTIVITY_THROTTLE_MS) return;
        if (!force && own?.isOnline && own.lastSeenAt && ts - own.lastSeenAt < ACTIVITY_THROTTLE_MS) return;
        lastActivitySentAt = ts;

        await upsertPresence({
            is_online: Boolean(markOnline),
            last_seen_at: ts
        });
    };

    const updateOwnOnlineState = async (isOnline) => {
        if (!activeUserId) return;
        const ts = now();
        const own = getCached(activeUserId);
        const nextOnline = Boolean(isOnline);
        if (own && own.isOnline === nextOnline && ts - lastOnlineStateWriteAt < ONLINE_STATE_MIN_WRITE_GAP_MS) {
            return;
        }
        lastOnlineStateWriteAt = ts;
        await upsertPresence({ is_online: nextOnline, last_seen_at: ts });
    };

    const bindPresenceLifecycle = () => {
        if (window.__presenceLifecycleBound) return;
        window.__presenceLifecycleBound = true;

        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                sendHeartbeat({ force: true, markOnline: true });
            } else {
                updateOwnOnlineState(false);
            }
        };

        const throttledActivity = () => {
            if (document.visibilityState !== 'visible') return;
            sendHeartbeat({ force: false, markOnline: true });
        };

        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', () => sendHeartbeat({ force: true, markOnline: true }));
        window.addEventListener('blur', () => updateOwnOnlineState(false));
        window.addEventListener('beforeunload', () => {
            if (!activeUserId) return;
            updateOwnOnlineState(false);
        });

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            window.addEventListener(eventName, throttledActivity, { passive: true });
        });
    };

    const ensureRealtimeSubscription = () => {
        if (!supabase || realtimeChannel) return;
        realtimeChannel = supabase
            .channel(`presence-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'user_presence'
            }, (payload) => {
                const row = payload.new || payload.old;
                if (!row?.uid) return;
                if (row.uid !== activeUserId && trackedUids.size && !trackedUids.has(row.uid)) return;
                const wasChanged = setCache(row);
                if (!wasChanged) return;
                if (row.uid === activeUserId) {
                    scheduleExpiryCheck();
                    sanitizeManualStatus();
                }
                emit(row.uid);
            })
            .subscribe();
    };

    window.ensurePresenceForUsers = async function ensurePresenceForUsers(uids = []) {
        if (!supabase) return;
        const uniqueUids = Array.from(new Set((uids || []).filter((uid) => typeof uid === 'string' && uid.trim())));
        if (uniqueUids.length) trackUids(uniqueUids);
        const missing = uniqueUids.filter((uid) => !cache.has(uid) && !pendingUidLoads.has(uid));
        if (!missing.length) return;
        missing.forEach((uid) => pendingUidLoads.add(uid));

        const { data, error } = await supabase
            .from('user_presence')
            .select('*')
            .in('uid', missing);

        missing.forEach((uid) => pendingUidLoads.delete(uid));

        if (error) {
            console.warn('Failed to load presence for users:', error);
            return;
        }

        const changedUids = [];
        (data || []).forEach((row) => {
            if (setCache(row)) changedUids.push(row.uid);
        });
        if (!changedUids.length) return;
        if (changedUids.length === 1) {
            emit(changedUids[0]);
            return;
        }
        emit();
    };

    window.getEffectivePresence = function getEffectivePresence(uid, options = {}) {
        if (options.isBot) {
            return { text: options.botText || 'готов к игре', tone: 'neutral', source: 'bot' };
        }

        const row = uid ? getCached(uid) : null;
        if (!row) {
            return { text: 'не в сети', tone: 'offline', source: 'auto' };
        }

        const ts = now();
        const hasManual = Boolean(row.manualStatus && row.manualStatusText);
        const isManualExpired = Boolean(row.manualStatusExpiresAt && row.manualStatusExpiresAt <= ts);

        if (hasManual && !isManualExpired) {
            return { text: row.manualStatusText, tone: 'manual', source: 'manual' };
        }

        const freshness = ts - Number(row.lastSeenAt || 0);
        if (row.isOnline && freshness <= ONLINE_HEARTBEAT_MS) {
            return { text: 'в сети', tone: 'online', source: 'auto' };
        }
        if (freshness <= RECENTLY_SEEN_MS) {
            return { text: 'был недавно', tone: 'recently', source: 'auto' };
        }
        return { text: 'не в сети', tone: 'offline', source: 'auto' };
    };

    window.getPresenceText = function getPresenceText(uid, options = {}) {
        return window.getEffectivePresence(uid, options).text;
    };

    window.watchPresenceLayer = function watchPresenceLayer(callback) {
        if (typeof callback !== 'function') return () => {};
        listeners.add(callback);
        callback(null);
        return () => listeners.delete(callback);
    };

    window.setManualPresenceStatus = async function setManualPresenceStatus(statusKey) {
        if (!activeUserId) return;
        if (statusKey === 'reset') {
            await window.clearManualPresenceStatus();
            return;
        }

        const preset = MANUAL_STATUS_PRESETS[statusKey];
        if (!preset) return;

        const ts = now();
        const expiresAt = preset.ttlMs ? ts + preset.ttlMs : null;
        await upsertPresence({
            is_online: true,
            last_seen_at: ts,
            manual_status: preset.key,
            manual_status_text: preset.text,
            manual_status_expires_at: expiresAt
        });
    };

    window.clearManualPresenceStatus = async function clearManualPresenceStatus() {
        if (!activeUserId) return;
        await upsertPresence({
            manual_status: null,
            manual_status_text: null,
            manual_status_expires_at: null,
            last_seen_at: now(),
            is_online: document.visibilityState === 'visible'
        });
    };

    window.startPresenceLayer = async function startPresenceLayer(user) {
        if (!supabase || !user?.uid) return;
        if (activeUserId && activeUserId !== user.uid) {
            await window.stopPresenceLayer();
        }
        activeUserId = user.uid;
        lastPresenceWriteKey = '';
        lastActivitySentAt = 0;
        pendingUidLoads.clear();
        trackedUids.clear();
        ensureRealtimeSubscription();
        bindPresenceLifecycle();

        trackUids([activeUserId]);
        await sendHeartbeat({ force: true, markOnline: true });
        await window.ensurePresenceForUsers([activeUserId]);

        if (!heartbeatTimer) {
            heartbeatTimer = setInterval(() => {
                if (document.visibilityState !== 'visible') return;
                sendHeartbeat({ force: false, markOnline: true });
            }, HEARTBEAT_INTERVAL_MS);
        }

        scheduleExpiryCheck();
        sanitizeManualStatus();
        isStarted = true;
    };

    window.stopPresenceLayer = async function stopPresenceLayer() {
        if (!activeUserId) return;

        await updateOwnOnlineState(false);

        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (expiryTimer) {
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }

        trackedUids.clear();
        pendingUidLoads.clear();
        cache.clear();
        activeUserId = null;
        lastPresenceWriteKey = '';
        lastActivitySentAt = 0;
        lastOnlineStateWriteAt = 0;
        isStarted = false;
        emit();
    };

    window.getCurrentPresenceStatusText = function getCurrentPresenceStatusText() {
        if (!activeUserId) return 'не в сети';
        return window.getPresenceText(activeUserId);
    };

    window.refreshPresenceUI = function refreshPresenceUI(changedUid = null) {
        const trigger = document.getElementById('presence-status-trigger');
        const summary = document.getElementById('user-presence-summary');
        const summaryIndicator = document.getElementById('user-presence-indicator');
        const summaryText = document.getElementById('user-presence-text');
        const changedUidSafe = typeof changedUid === 'string' && changedUid.trim() ? changedUid : null;
        if (trigger) {
            const isAvailable = Boolean(window.currentUser && !window.isLocalGameMode?.());
            if (!changedUidSafe || changedUidSafe === activeUserId) {
                const effective = window.getEffectivePresence?.(activeUserId) || { text: 'не в сети', tone: 'offline' };
                const text = effective.text || window.getCurrentPresenceStatusText();
                const indicatorVariant = typeof window.resolvePresenceIndicatorVariant === 'function'
                    ? window.resolvePresenceIndicatorVariant(effective)
                    : 'offline';
                trigger.disabled = !isAvailable;
                trigger.title = isAvailable ? 'Изменить статус' : 'Статус недоступен';
                trigger.setAttribute('aria-label', isAvailable ? `Изменить статус. Текущий статус: ${text}` : 'Статус недоступен');
                if (typeof window.applyStatusIndicatorClass === 'function') {
                    window.applyStatusIndicatorClass(summaryIndicator, isAvailable ? indicatorVariant : 'offline');
                }
                if (summaryText) {
                    summaryText.textContent = text;
                    summaryText.title = text;
                }
                const isCompactMobileLayout = typeof window.isCompactMobilePresenceLayout === 'function'
                    ? window.isCompactMobilePresenceLayout()
                    : false;
                if (summary) {
                    summary.classList.toggle('user-presence-summary--tap-edit', isAvailable && isCompactMobileLayout);
                    if (isAvailable && isCompactMobileLayout) {
                        summary.setAttribute('role', 'button');
                        summary.setAttribute('tabindex', '0');
                        summary.setAttribute('aria-haspopup', 'menu');
                        summary.setAttribute('aria-label', `Изменить статус. Текущий статус: ${text}`);
                    } else {
                        summary.removeAttribute('role');
                        summary.removeAttribute('tabindex');
                        summary.removeAttribute('aria-haspopup');
                        summary.removeAttribute('aria-label');
                    }
                }
            }
        }

        if (window.lastGameUiSnapshot) {
            const players = window.lastGameUiSnapshot.players || {};
            const myColor = window.playerColor;
            const opponentUid = myColor === 'w'
                ? (players.black || null)
                : (myColor === 'b' ? (players.white || null) : null);
            if (!changedUidSafe || (opponentUid && opponentUid === changedUidSafe)) {
                window.updateOpponentHeader?.(window.lastGameUiSnapshot);
            }
        }

        window.refreshLobbyPresenceLabels?.(changedUidSafe);
    };

    window.initPresenceStatusControls = function initPresenceStatusControls() {
        if (window.__presenceControlsBound) return;

        const trigger = document.getElementById('presence-status-trigger');
        const summary = document.getElementById('user-presence-summary');
        const menu = document.getElementById('presence-status-menu');
        const quickPhrasesMenu = document.getElementById('quick-phrases-menu');
        const quickPhrasesToggle = document.getElementById('quick-phrases-toggle');

        if (!trigger || !menu) return;

        const compactLayoutQuery = window.matchMedia?.('(max-width: 600px) and (orientation: portrait)') || null;
        window.isCompactMobilePresenceLayout = function isCompactMobilePresenceLayout() {
            return Boolean(compactLayoutQuery?.matches);
        };

        const toggleMenu = (event) => {
            event.stopPropagation();
            quickPhrasesMenu?.classList.add('hidden');
            menu.classList.toggle('hidden');
            trigger.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true');
        };

        trigger.addEventListener('click', toggleMenu);
        summary?.addEventListener('click', (event) => {
            if (!window.isCompactMobilePresenceLayout?.() || trigger.disabled) return;
            toggleMenu(event);
        });
        summary?.addEventListener('keydown', (event) => {
            if (!window.isCompactMobilePresenceLayout?.() || trigger.disabled) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleMenu(event);
        });

        menu.querySelectorAll('.presence-status-item').forEach((item) => {
            item.addEventListener('click', async (event) => {
                event.stopPropagation();
                const status = item.dataset.presenceStatus;
                await window.setManualPresenceStatus(status);
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            });
        });

        quickPhrasesToggle?.addEventListener('click', () => {
            menu.classList.add('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!menu.contains(event.target) && !trigger.contains(event.target)) {
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        if (compactLayoutQuery?.addEventListener) {
            compactLayoutQuery.addEventListener('change', () => window.refreshPresenceUI());
        } else if (compactLayoutQuery?.addListener) {
            compactLayoutQuery.addListener(() => window.refreshPresenceUI());
        }

        window.watchPresenceLayer((changedUid) => window.refreshPresenceUI(changedUid));

        window.__presenceControlsBound = true;
        if (isStarted) {
            window.refreshPresenceUI();
        }
    };
})();
