// ==================== PRESENCE / STATUS LAYER ====================
// Отвечает за: онлайн-статус пользователя и ручные быстрые статусы.
// Отдельный пользовательский слой. Не связан с логикой ходов/партии.

(function initPresenceLayer() {
    const supabase = window.supabaseClient;
    const ONLINE_HEARTBEAT_MS = 70 * 1000;
    const RECENTLY_SEEN_MS = 5 * 60 * 1000;
    const HEARTBEAT_INTERVAL_MS = 30 * 1000;
    const ACTIVITY_THROTTLE_MS = 15 * 1000;

    const MANUAL_STATUS_PRESETS = {
        away_5: { key: 'away_5', text: 'Отошёл на 5 минут', ttlMs: 5 * 60 * 1000 },
        back_10: { key: 'back_10', text: 'Вернусь через 10 минут', ttlMs: 10 * 60 * 1000 },
        working: { key: 'working', text: 'Работаю', ttlMs: null },
        dnd: { key: 'dnd', text: 'Не беспокоить', ttlMs: null }
    };

    const cache = new Map();
    const listeners = new Set();
    const pendingUidLoads = new Set();
    let realtimeChannel = null;
    let heartbeatTimer = null;
    let expiryTimer = null;
    let lastActivitySentAt = 0;
    let activeUserId = null;
    let isStarted = false;

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
        cache.set(row.uid, {
            uid: row.uid,
            isOnline: Boolean(row.is_online),
            lastSeenAt: Number(row.last_seen_at || 0),
            manualStatus: row.manual_status || null,
            manualStatusText: row.manual_status_text || null,
            manualStatusExpiresAt: Number(row.manual_status_expires_at || 0) || null,
            updatedAt: Number(row.updated_at_ms || row.last_seen_at || 0)
        });
    };

    const getCached = (uid) => cache.get(uid) || null;

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
        }
    };

    const sendHeartbeat = async ({ force = false, markOnline = true } = {}) => {
        if (!activeUserId) return;
        const ts = now();
        if (!force && ts - lastActivitySentAt < ACTIVITY_THROTTLE_MS) return;
        lastActivitySentAt = ts;

        await upsertPresence({
            is_online: Boolean(markOnline),
            last_seen_at: ts
        });
    };

    const bindPresenceLifecycle = () => {
        if (window.__presenceLifecycleBound) return;
        window.__presenceLifecycleBound = true;

        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                sendHeartbeat({ force: true, markOnline: true });
            } else {
                upsertPresence({ is_online: false, last_seen_at: now() });
            }
        };

        const throttledActivity = () => {
            if (document.visibilityState !== 'visible') return;
            sendHeartbeat({ force: false, markOnline: true });
        };

        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', () => sendHeartbeat({ force: true, markOnline: true }));
        window.addEventListener('blur', () => upsertPresence({ is_online: false, last_seen_at: now() }));
        window.addEventListener('beforeunload', () => {
            if (!activeUserId) return;
            upsertPresence({ is_online: false, last_seen_at: now() });
        });

        ['pointerdown', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
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
                setCache(row);
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

        (data || []).forEach(setCache);
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
        activeUserId = user.uid;
        ensureRealtimeSubscription();
        bindPresenceLifecycle();

        await upsertPresence({
            is_online: true,
            last_seen_at: now()
        });
        await window.ensurePresenceForUsers([activeUserId]);

        if (!heartbeatTimer) {
            heartbeatTimer = setInterval(() => {
                if (document.visibilityState !== 'visible') return;
                sendHeartbeat({ force: true, markOnline: true });
            }, HEARTBEAT_INTERVAL_MS);
        }

        scheduleExpiryCheck();
        sanitizeManualStatus();
        isStarted = true;
    };

    window.stopPresenceLayer = async function stopPresenceLayer() {
        if (!activeUserId) return;

        await upsertPresence({
            is_online: false,
            last_seen_at: now()
        });

        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (expiryTimer) {
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }

        activeUserId = null;
        isStarted = false;
        emit();
    };

    window.getCurrentPresenceStatusText = function getCurrentPresenceStatusText() {
        if (!activeUserId) return 'не в сети';
        return window.getPresenceText(activeUserId);
    };

    window.refreshPresenceUI = function refreshPresenceUI() {
        const trigger = document.getElementById('presence-status-trigger');
        const summaryIndicator = document.getElementById('user-presence-indicator');
        const summaryText = document.getElementById('user-presence-text');
        if (trigger) {
            const isAvailable = Boolean(window.currentUser && !window.isBotMode);
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
        }

        if (window.lastGameUiSnapshot) {
            window.updateOpponentHeader?.(window.lastGameUiSnapshot);
        }

        window.refreshLobbyPresenceLabels?.();
    };

    window.initPresenceStatusControls = function initPresenceStatusControls() {
        if (window.__presenceControlsBound) return;

        const trigger = document.getElementById('presence-status-trigger');
        const menu = document.getElementById('presence-status-menu');
        const quickPhrasesMenu = document.getElementById('quick-phrases-menu');
        const quickPhrasesToggle = document.getElementById('quick-phrases-toggle');

        if (!trigger || !menu) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            quickPhrasesMenu?.classList.add('hidden');
            menu.classList.toggle('hidden');
        });

        menu.querySelectorAll('.presence-status-item').forEach((item) => {
            item.addEventListener('click', async (event) => {
                event.stopPropagation();
                const status = item.dataset.presenceStatus;
                await window.setManualPresenceStatus(status);
                menu.classList.add('hidden');
            });
        });

        quickPhrasesToggle?.addEventListener('click', () => {
            menu.classList.add('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!menu.contains(event.target) && !trigger.contains(event.target)) {
                menu.classList.add('hidden');
            }
        });

        window.watchPresenceLayer(() => window.refreshPresenceUI());

        window.__presenceControlsBound = true;
        if (isStarted) {
            window.refreshPresenceUI();
        }
    };
})();
