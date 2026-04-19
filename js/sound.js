// ==================== SOUND MANAGER ====================
// Единый глобальный модуль звуков приложения.
// Активные события: piece_select, button_rollover, button_click, button_click_release, modal_open, move, capture_default, capture_ranged, promotion, check, checkmate, win_white, win_black, defeat, draw, rook_first_move_voice, queen_first_move_voice.
// Зарезервированные события: castle, game_start, game_end, enemy_move, your_turn.

(function initSoundManager(global) {
    if (global.SoundManager) {
        return;
    }

    const SOUND_STORAGE_KEY = 'gochess-sound-settings-v1';

    const DEFAULT_SOUND_SETTINGS = {
        enabled: true,
        master: 0.8,
        categories: {
            moves: 0.7,
            captures: 0.85,
            system: 0.95,
            ui: 0.7,
            voice: 0.9
        },
        gains: {
            move: 0.5,
            capture: 0.6,
            captureMajor: 0.72,
            queen: 0.45,
            castle: 0.58,
            check: 0.85,
            mate: 0.95,
            promote: 0.65,
            click: 0.45
        }
    };

    const SOUND_DEFINITIONS = {
        piece_select: {
            src: 'assets/sounds/select.mp3',
            gain: 1,
            type: 'click',
            category: 'ui',
            cooldown: 90
        },
        button_rollover: {
            src: 'assets/sounds/buttonrollover.wav',
            gain: 1,
            type: 'click',
            category: 'ui',
            cooldown: 140
        },
        button_click: {
            src: 'assets/sounds/buttonclick.wav',
            gain: 1,
            type: 'click',
            category: 'ui',
            cooldown: 70
        },
        button_click_release: {
            src: 'assets/sounds/buttonclickrelease.wav',
            gain: 1,
            type: 'click',
            category: 'ui',
            cooldown: 70
        },
        modal_open: {
            src: 'assets/sounds/modal.mp3',
            gain: 1,
            type: 'click',
            category: 'system',
            cooldown: 1200
        },
        move: {
            src: [
                'assets/sounds/move-1.mp3',
                'assets/sounds/move-2.mp3',
                'assets/sounds/move-3.mp3',
                'assets/sounds/move-4.mp3'
            ],
            gain: 1,
            type: 'move',
            category: 'moves',
            cooldown: 0
        },
        capture_default: {
            src: [
                'assets/sounds/capture-default-1.mp3',
                'assets/sounds/capture-default-2.mp3'
            ],
            gain: 1,
            type: 'capture',
            category: 'captures',
            cooldown: 0
        },
        capture_ranged: {
            src: [
                'assets/sounds/capture-ranged-1.mp3',
                'assets/sounds/capture-ranged-2.mp3'
            ],
            gain: 1,
            type: 'captureMajor',
            category: 'captures',
            cooldown: 0
        },

        // Зарезервировано для будущего расширения
        castle: {
            src: null,
            gain: 1,
            type: 'castle',
            category: 'moves',
            cooldown: 0
        },
        check: {
            src: [
                'assets/sounds/check-1.mp3',
                'assets/sounds/check-2.mp3',
                'assets/sounds/check-3.mp3'
            ],
            gain: 1,
            type: 'check',
            category: 'system',
            cooldown: 0
        },
        promotion: {
            src: [
                'assets/sounds/promotion-1.mp3',
                'assets/sounds/promotion-2.mp3'
            ],
            gain: 1,
            type: 'promote',
            category: 'system',
            cooldown: 0
        },
        checkmate: {
            src: [
                'assets/sounds/checkmate-1.mp3',
                'assets/sounds/checkmate-2.mp3'
            ],
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        win_white: {
            src: 'assets/sounds/win-white-1.mp3',
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        win_black: {
            src: 'assets/sounds/win-black-1.mp3',
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        defeat: {
            src: 'assets/sounds/defeat-1.mp3',
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        draw: {
            src: 'assets/sounds/draw-1.mp3',
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        rook_first_move_voice: {
            src: [
                'assets/sounds/rook-first-move-1.mp3',
                'assets/sounds/rook-first-move-2.mp3'
            ],
            gain: 1,
            type: 'castle',
            category: 'voice',
            cooldown: 0
        },
        queen_first_move_voice: {
            src: [
                'assets/sounds/queen-first-move-1.mp3',
                'assets/sounds/queen-first-move-2.mp3'
            ],
            gain: 1,
            type: 'queen',
            category: 'voice',
            cooldown: 0
        },
        game_start: {
            src: null,
            gain: 1,
            type: 'check',
            category: 'system',
            cooldown: 0
        },
        game_end: {
            src: null,
            gain: 1,
            type: 'mate',
            category: 'system',
            cooldown: 0
        },
        enemy_move: {
            src: null,
            gain: 1,
            type: 'move',
            category: 'moves',
            cooldown: 0
        },
        your_turn: {
            src: null,
            gain: 1,
            type: 'check',
            category: 'system',
            cooldown: 0
        }
    };

    function clamp01(value, fallback = 1) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.max(0, Math.min(1, parsed));
    }

    function normalizeSoundSettings(rawSettings) {
        const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
        const normalized = {
            enabled: settings.enabled !== false,
            master: clamp01(settings.master, DEFAULT_SOUND_SETTINGS.master),
            categories: { ...DEFAULT_SOUND_SETTINGS.categories },
            gains: { ...DEFAULT_SOUND_SETTINGS.gains }
        };

        Object.keys(normalized.categories).forEach((category) => {
            normalized.categories[category] = clamp01(
                settings.categories?.[category],
                DEFAULT_SOUND_SETTINGS.categories[category]
            );
        });

        Object.keys(normalized.gains).forEach((gainKey) => {
            normalized.gains[gainKey] = clamp01(
                settings.gains?.[gainKey],
                DEFAULT_SOUND_SETTINGS.gains[gainKey]
            );
        });

        return normalized;
    }

    function normalizeSoundConfig(configValue) {
        const normalizeSources = (srcValue) => {
            if (Array.isArray(srcValue)) {
                return srcValue
                    .map((item) => (typeof item === 'string' ? item.trim() : ''))
                    .filter(Boolean);
            }

            if (typeof srcValue === 'string' && srcValue.trim()) {
                return [srcValue.trim()];
            }

            return [];
        };

        if (typeof configValue === 'string') {
            // Обратная совместимость со старым форматом: event: 'path/to/file.mp3'
            return {
                sources: normalizeSources(configValue),
                gain: 1,
                type: 'move',
                category: 'default',
                cooldown: 0
            };
        }

        if (!configValue || typeof configValue !== 'object') {
            return {
                sources: [],
                gain: 1,
                type: 'move',
                category: 'default',
                cooldown: 0
            };
        }

        return {
            sources: normalizeSources(configValue.src),
            gain: Number.isFinite(Number(configValue.gain))
                ? Number(configValue.gain)
                : (Number.isFinite(Number(configValue.volume)) ? Number(configValue.volume) : 1),
            type: typeof configValue.type === 'string' && configValue.type.trim()
                ? configValue.type.trim()
                : 'move',
            category: typeof configValue.category === 'string' && configValue.category.trim()
                ? configValue.category.trim()
                : 'system',
            cooldown: Number.isFinite(Number(configValue.cooldown))
                ? Math.max(0, Number(configValue.cooldown))
                : 0
        };
    }

    const manager = {
        enabled: true,
        masterVolume: DEFAULT_SOUND_SETTINGS.master,
        settings: normalizeSoundSettings(DEFAULT_SOUND_SETTINGS),
        initialized: false,
        sounds: {},
        soundMeta: {},
        lastPlayedVariantIndex: {},
        lastPlayedAt: {},
        activeAudioNodes: new Set(),
        sequenceQueue: Promise.resolve(),
        uiButtonSoundsBound: false,

        init() {
            if (this.initialized) {
                return;
            }
            this.loadSettings();

            Object.entries(SOUND_DEFINITIONS).forEach(([eventName, rawConfig]) => {
                const config = normalizeSoundConfig(rawConfig);
                this.soundMeta[eventName] = config;

                if (!Array.isArray(config.sources) || config.sources.length === 0) {
                    return;
                }

                const variants = config.sources.map((src) => {
                    const audio = new Audio(src);
                    audio.preload = 'auto';
                    audio.volume = this.computeFinalVolume(eventName, 1);

                    return {
                        src,
                        audio
                    };
                });

                this.sounds[eventName] = variants;
            });

            this.initialized = true;
        },

        setEnabled(value) {
            this.enabled = Boolean(value);
            this.settings.enabled = this.enabled;
            this.saveSettings();
            this.applyAllVolumes();
            if (!this.enabled) {
                this.stopAll();
            }
        },

        setMasterVolume(value) {
            this.masterVolume = clamp01(value, this.masterVolume);
            this.settings.master = this.masterVolume;
            this.saveSettings();
            this.applyAllVolumes();
        },

        setCategoryVolume(category, value) {
            if (!category || !Object.prototype.hasOwnProperty.call(this.settings.categories, category)) {
                return;
            }
            this.settings.categories[category] = clamp01(value, this.settings.categories[category]);
            this.saveSettings();
            this.applyAllVolumes();
        },

        setSoundGain(gainName, value) {
            if (!gainName || !Object.prototype.hasOwnProperty.call(this.settings.gains, gainName)) {
                return;
            }
            this.settings.gains[gainName] = clamp01(value, this.settings.gains[gainName]);
            this.saveSettings();
            this.applyAllVolumes();
        },

        updateSettings(nextSettings = {}) {
            this.settings = normalizeSoundSettings({
                ...this.settings,
                ...nextSettings,
                categories: {
                    ...this.settings.categories,
                    ...(nextSettings.categories || {})
                },
                gains: {
                    ...this.settings.gains,
                    ...(nextSettings.gains || {})
                }
            });
            this.enabled = this.settings.enabled;
            this.masterVolume = this.settings.master;
            this.saveSettings();
            this.applyAllVolumes();
        },

        getSettings() {
            return {
                enabled: this.settings.enabled,
                master: this.settings.master,
                categories: { ...this.settings.categories },
                gains: { ...this.settings.gains }
            };
        },

        loadSettings() {
            let parsedSettings = null;
            try {
                const raw = global.localStorage?.getItem(SOUND_STORAGE_KEY);
                parsedSettings = raw ? JSON.parse(raw) : null;
            } catch (error) {
                console.warn('[SoundManager] Не удалось загрузить настройки звука', error);
            }
            this.settings = normalizeSoundSettings(parsedSettings || DEFAULT_SOUND_SETTINGS);
            this.enabled = this.settings.enabled;
            this.masterVolume = this.settings.master;
            global.soundSettings = this.getSettings();
        },

        saveSettings() {
            global.soundSettings = this.getSettings();
            try {
                global.localStorage?.setItem(SOUND_STORAGE_KEY, JSON.stringify(this.settings));
            } catch (error) {
                console.warn('[SoundManager] Не удалось сохранить настройки звука', error);
            }
        },

        computeFinalVolume(eventName, runtimeVolume = 1) {
            const meta = this.soundMeta[eventName] || {};
            const categoryKey = meta.category && this.settings.categories[meta.category] !== undefined
                ? meta.category
                : 'system';
            const soundType = meta.type && this.settings.gains[meta.type] !== undefined
                ? meta.type
                : 'move';
            const categoryVolume = this.settings.categories[categoryKey] ?? 1;
            const soundGain = (this.settings.gains[soundType] ?? 1) * clamp01(meta.gain, 1);
            const baseVolume = this.enabled ? this.masterVolume * categoryVolume * soundGain : 0;
            return Math.max(0, Math.min(1, baseVolume * clamp01(runtimeVolume, 1)));
        },

        applyAllVolumes() {
            Object.entries(this.sounds).forEach(([eventName, audio]) => {
                const variants = Array.isArray(audio) ? audio : [];
                variants.forEach((variant) => {
                    if (variant?.audio) {
                        variant.audio.volume = this.computeFinalVolume(eventName, 1);
                    }
                });
            });

            this.activeAudioNodes.forEach((audioNode) => {
                if (!audioNode || typeof audioNode.dataset?.eventName !== 'string') {
                    return;
                }
                audioNode.volume = this.computeFinalVolume(audioNode.dataset.eventName, 1);
            });
        },

        stopAll() {
            this.activeAudioNodes.forEach((audioNode) => {
                if (!audioNode) {
                    return;
                }

                try {
                    audioNode.pause();
                    audioNode.currentTime = 0;
                } catch (error) {
                    console.warn('[SoundManager] Ошибка при остановке звука', error);
                }
            });

            this.activeAudioNodes.clear();
        },

        isOnCooldown(eventName) {
            const soundConfig = this.soundMeta[eventName];
            const cooldownMs = soundConfig ? soundConfig.cooldown : 0;
            if (!cooldownMs) {
                return false;
            }

            const lastPlayed = this.lastPlayedAt[eventName] || 0;
            return Date.now() - lastPlayed < cooldownMs;
        },

        resolveSoundVariant(eventName) {
            const soundVariants = this.sounds[eventName];
            if (!Array.isArray(soundVariants) || soundVariants.length === 0) {
                return null;
            }

            const availableVariants = soundVariants.filter((variant) => variant?.audio);
            if (availableVariants.length === 0) {
                return null;
            }

            const lastVariantIndex = this.lastPlayedVariantIndex[eventName];
            const candidateVariants = availableVariants.length > 1
                ? availableVariants.filter((variant) => variant !== soundVariants[lastVariantIndex])
                : availableVariants;
            const finalPool = candidateVariants.length > 0 ? candidateVariants : availableVariants;
            const pickedVariant = finalPool[Math.floor(Math.random() * finalPool.length)];
            const pickedVariantIndex = soundVariants.indexOf(pickedVariant);

            return {
                pickedVariant,
                pickedVariantIndex
            };
        },

        playInternal(eventName, options = {}, { waitForEnd = false } = {}) {
            if (!this.initialized) {
                this.init();
            }

            if (!this.enabled || !eventName || this.isOnCooldown(eventName)) {
                return Promise.resolve(false);
            }

            const resolvedVariant = this.resolveSoundVariant(eventName);
            if (!resolvedVariant?.pickedVariant?.audio) {
                if (this.soundMeta[eventName]?.sources?.length) {
                    console.warn(`[SoundManager] Нет доступных вариантов для "${eventName}"`);
                }
                return Promise.resolve(false);
            }

            const runtimeVolume = Number.isFinite(Number(options.volume))
                ? Number(options.volume)
                : 1;
            const effectiveVolume = this.computeFinalVolume(eventName, runtimeVolume);

            return new Promise((resolve) => {
                try {
                    const { pickedVariant, pickedVariantIndex } = resolvedVariant;
                    const baseAudio = pickedVariant.audio;
                    const audioToPlay = baseAudio.cloneNode(true);
                    audioToPlay.volume = effectiveVolume;
                    audioToPlay.dataset.eventName = eventName;
                    audioToPlay.dataset.src = pickedVariant.src;
                    this.lastPlayedAt[eventName] = Date.now();
                    this.lastPlayedVariantIndex[eventName] = pickedVariantIndex;
                    this.activeAudioNodes.add(audioToPlay);

                    let settled = false;
                    let failSafeTimer = null;
                    const settle = (result = true) => {
                        if (settled) return;
                        settled = true;
                        if (failSafeTimer) {
                            clearTimeout(failSafeTimer);
                            failSafeTimer = null;
                        }
                        this.activeAudioNodes.delete(audioToPlay);
                        resolve(result);
                    };

                    audioToPlay.addEventListener('ended', () => settle(true), { once: true });
                    audioToPlay.addEventListener('error', () => {
                        console.warn(`[SoundManager] Ошибка загрузки звука "${eventName}" (${pickedVariant.src})`);
                        settle(false);
                    }, { once: true });
                    audioToPlay.addEventListener('abort', () => settle(false), { once: true });
                    audioToPlay.addEventListener('pause', () => {
                        if (audioToPlay.ended || audioToPlay.currentTime === 0) {
                            settle(false);
                        }
                    });

                    if (waitForEnd) {
                        const durationSeconds = Number(audioToPlay.duration);
                        const hasKnownDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
                        const fallbackTimeoutMs = hasKnownDuration
                            ? Math.min(15000, Math.max(1500, Math.ceil(durationSeconds * 1000) + 1200))
                            : 7000;

                        failSafeTimer = setTimeout(() => {
                            console.warn(
                                `[SoundManager] Fail-safe: "${eventName}" превысил ожидание ${fallbackTimeoutMs}ms, переходим к следующему событию`
                            );
                            settle(false);
                        }, fallbackTimeoutMs);
                    }

                    const playPromise = audioToPlay.play();

                    if (playPromise && typeof playPromise.then === 'function') {
                        playPromise
                            .then(() => {
                                if (!waitForEnd) {
                                    settle(true);
                                }
                            })
                            .catch((error) => {
                                console.warn(`[SoundManager] Не удалось воспроизвести "${eventName}"`, error);
                                settle(false);
                            });
                    } else if (!waitForEnd) {
                        settle(true);
                    }
                } catch (error) {
                    console.warn(`[SoundManager] Ошибка при воспроизведении "${eventName}"`, error);
                    resolve(false);
                }
            });
        },

        play(eventName, options = {}) {
            return this.playInternal(eventName, options, { waitForEnd: false });
        },

        playSequence(events = [], options = {}) {
            if (!this.initialized) {
                this.init();
            }

            const queue = Array.isArray(events)
                ? events.filter((eventName) => typeof eventName === 'string' && eventName.trim())
                : [];

            if (!this.enabled || queue.length === 0) {
                return Promise.resolve();
            }

            const runSequence = async () => {
                for (const eventName of queue) {
                    await this.playInternal(eventName, options, { waitForEnd: true });
                }
            };

            this.sequenceQueue = this.sequenceQueue
                .then(runSequence)
                .catch((error) => {
                    console.warn('[SoundManager] Ошибка очереди последовательного воспроизведения', error);
                });

            return this.sequenceQueue;
        },

        bindUIButtonSounds(options = {}) {
            if (this.uiButtonSoundsBound) {
                return;
            }

            const interactiveSelector = options.selector || [
                'button',
                '[role="button"]',
                '.btn',
                '.hub-tile',
                '.review-control-btn',
                '.board-settings-icon-btn',
                '.top-lobby-brand-btn'
            ].join(', ');

            const excludedSelector = options.excludedSelector || [
                '#myBoard',
                '#myBoard *',
                '.chessboard-63f37',
                '.chessboard-63f37 *',
                '.square-55d63',
                '.square-55d63 *',
                '.piece-417db',
                '.piece-417db *'
            ].join(', ');
            const canHover = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? false;
            const activePressTargets = new Map();
            let lastRolloverElement = null;
            let lastRolloverAt = 0;

            const resolveInteractiveTarget = (eventTarget) => {
                if (!(eventTarget instanceof Element)) {
                    return null;
                }
                const candidate = eventTarget.closest(interactiveSelector);
                if (!candidate) {
                    return null;
                }

                if (excludedSelector && candidate.matches(excludedSelector)) {
                    return null;
                }

                if (excludedSelector && candidate.closest(excludedSelector)) {
                    return null;
                }

                return candidate;
            };

            const isDisabled = (node) => {
                if (!node) return true;
                if (node.closest('[aria-disabled="true"], [disabled], .disabled, .is-disabled')) {
                    return true;
                }
                if ('disabled' in node && node.disabled) {
                    return true;
                }
                return false;
            };

            const isVisible = (node) => {
                if (!node || !node.isConnected) {
                    return false;
                }
                if (node.closest('.hidden, [hidden], [aria-hidden="true"]')) {
                    return false;
                }
                const style = window.getComputedStyle(node);
                if (!style || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
                    return false;
                }
                return node.getClientRects().length > 0;
            };

            const canPlayForNode = (node) => Boolean(node && !isDisabled(node) && isVisible(node));

            const handlePointerDown = (event) => {
                if (typeof event.button === 'number' && event.button !== 0) {
                    return;
                }
                const target = resolveInteractiveTarget(event.target);
                if (!canPlayForNode(target)) {
                    return;
                }

                const pointerKey = typeof event.pointerId === 'number' ? `pointer:${event.pointerId}` : 'pointer:mouse';
                activePressTargets.set(pointerKey, target);
                this.play('button_click');
            };

            const handlePointerUp = (event) => {
                if (typeof event.button === 'number' && event.button !== 0) {
                    return;
                }

                const pointerKey = typeof event.pointerId === 'number' ? `pointer:${event.pointerId}` : 'pointer:mouse';
                const pressedTarget = activePressTargets.get(pointerKey);
                const releaseTarget = resolveInteractiveTarget(event.target);
                activePressTargets.delete(pointerKey);

                if (!canPlayForNode(releaseTarget)) {
                    return;
                }
                if (pressedTarget && pressedTarget !== releaseTarget) {
                    return;
                }
                this.play('button_click_release');
            };

            const handleMouseOver = (event) => {
                if (!canHover) {
                    return;
                }

                const target = resolveInteractiveTarget(event.target);
                if (!canPlayForNode(target)) {
                    return;
                }

                const previousTarget = resolveInteractiveTarget(event.relatedTarget);
                if (previousTarget === target) {
                    return;
                }

                const now = Date.now();
                if (lastRolloverElement === target && now - lastRolloverAt < 200) {
                    return;
                }

                lastRolloverElement = target;
                lastRolloverAt = now;
                this.play('button_rollover');
            };

            if (window.PointerEvent) {
                document.addEventListener('pointerdown', handlePointerDown, true);
                document.addEventListener('pointerup', handlePointerUp, true);
                document.addEventListener('pointercancel', (event) => {
                    const pointerKey = typeof event.pointerId === 'number' ? `pointer:${event.pointerId}` : 'pointer:mouse';
                    activePressTargets.delete(pointerKey);
                }, true);
            } else {
                document.addEventListener('mousedown', (event) => {
                    handlePointerDown({
                        target: event.target,
                        pointerId: 'mouse',
                        button: event.button
                    });
                }, true);
                document.addEventListener('mouseup', (event) => {
                    handlePointerUp({
                        target: event.target,
                        pointerId: 'mouse',
                        button: event.button
                    });
                }, true);
                document.addEventListener('touchstart', (event) => {
                    const touch = event.changedTouches?.[0];
                    handlePointerDown({
                        target: event.target,
                        pointerId: touch?.identifier ?? 'touch',
                        button: 0
                    });
                }, { capture: true, passive: true });
                document.addEventListener('touchend', (event) => {
                    const touch = event.changedTouches?.[0];
                    handlePointerUp({
                        target: event.target,
                        pointerId: touch?.identifier ?? 'touch',
                        button: 0
                    });
                }, { capture: true, passive: true });
                document.addEventListener('touchcancel', (event) => {
                    const touch = event.changedTouches?.[0];
                    activePressTargets.delete(`pointer:${touch?.identifier ?? 'touch'}`);
                }, { capture: true, passive: true });
            }

            document.addEventListener('mouseover', handleMouseOver, true);
            this.uiButtonSoundsBound = true;
        }
    };

    manager.init();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => manager.bindUIButtonSounds(), { once: true });
    } else {
        manager.bindUIButtonSounds();
    }
    global.SoundManager = manager;
    global.soundSettings = manager.getSettings();
    global.playSound = function playSound(eventName, options) {
        return manager.play(eventName, options);
    };
})(window);
