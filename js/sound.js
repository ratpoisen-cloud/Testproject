// ==================== SOUND MANAGER ====================
// Единый глобальный модуль звуков приложения.
// Активные события: piece_select, button_rollover, button_click, button_click_release, modal_open, move, capture_default, capture_ranged, promotion, check, checkmate, win_white, win_black, defeat, draw, rook_first_move_voice, queen_first_move_voice.
// Зарезервированные события: castle, game_start, game_end, enemy_move, your_turn.

(function initSoundManager(global) {
    if (global.SoundManager) {
        return;
    }

    const SOUND_DEFINITIONS = {
        piece_select: {
            src: 'assets/sounds/select.mp3',
            volume: 1,
            category: 'ui',
            cooldown: 90
        },
        button_rollover: {
            src: 'assets/sounds/buttonrollover.wav',
            volume: 0.42,
            category: 'ui',
            cooldown: 140
        },
        button_click: {
            src: 'assets/sounds/buttonclick.wav',
            volume: 0.5,
            category: 'ui',
            cooldown: 70
        },
        button_click_release: {
            src: 'assets/sounds/buttonclickrelease.wav',
            volume: 0.5,
            category: 'ui',
            cooldown: 70
        },
        modal_open: {
            src: 'assets/sounds/modal.mp3',
            volume: 0.42,
            category: 'alert',
            cooldown: 1200
        },
        move: {
            src: [
                'assets/sounds/move-1.mp3',
                'assets/sounds/move-2.mp3',
                'assets/sounds/move-3.mp3',
                'assets/sounds/move-4.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        capture_default: {
            src: [
                'assets/sounds/capture-default-1.mp3',
                'assets/sounds/capture-default-2.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        capture_ranged: {
            src: [
                'assets/sounds/capture-ranged-1.mp3',
                'assets/sounds/capture-ranged-2.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },

        // Зарезервировано для будущего расширения
        castle: {
            src: null,
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        check: {
            src: [
                'assets/sounds/check-1.mp3',
                'assets/sounds/check-2.mp3',
                'assets/sounds/check-3.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        promotion: {
            src: [
                'assets/sounds/promotion-1.mp3',
                'assets/sounds/promotion-2.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        checkmate: {
            src: [
                'assets/sounds/checkmate-1.mp3',
                'assets/sounds/checkmate-2.mp3'
            ],
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        win_white: {
            src: 'assets/sounds/win-white-1.mp3',
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        win_black: {
            src: 'assets/sounds/win-black-1.mp3',
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        defeat: {
            src: 'assets/sounds/defeat-1.mp3',
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        draw: {
            src: 'assets/sounds/draw-1.mp3',
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        rook_first_move_voice: {
            src: [
                'assets/sounds/rook-first-move-1.mp3',
                'assets/sounds/rook-first-move-2.mp3'
            ],
            volume: 1,
            category: 'voice',
            cooldown: 0
        },
        queen_first_move_voice: {
            src: [
                'assets/sounds/queen-first-move-1.mp3',
                'assets/sounds/queen-first-move-2.mp3'
            ],
            volume: 1,
            category: 'voice',
            cooldown: 0
        },
        game_start: {
            src: null,
            volume: 1,
            category: 'system',
            cooldown: 0
        },
        game_end: {
            src: null,
            volume: 1,
            category: 'system',
            cooldown: 0
        },
        enemy_move: {
            src: null,
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        your_turn: {
            src: null,
            volume: 1,
            category: 'system',
            cooldown: 0
        }
    };

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
                volume: 1,
                category: 'default',
                cooldown: 0
            };
        }

        if (!configValue || typeof configValue !== 'object') {
            return {
                sources: [],
                volume: 1,
                category: 'default',
                cooldown: 0
            };
        }

        return {
            sources: normalizeSources(configValue.src),
            volume: Number.isFinite(Number(configValue.volume)) ? Number(configValue.volume) : 1,
            category: typeof configValue.category === 'string' ? configValue.category : 'default',
            cooldown: Number.isFinite(Number(configValue.cooldown))
                ? Math.max(0, Number(configValue.cooldown))
                : 0
        };
    }

    const manager = {
        enabled: true,
        masterVolume: 0.55,
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

            Object.entries(SOUND_DEFINITIONS).forEach(([eventName, rawConfig]) => {
                const config = normalizeSoundConfig(rawConfig);
                this.soundMeta[eventName] = config;

                if (!Array.isArray(config.sources) || config.sources.length === 0) {
                    return;
                }

                const variants = config.sources.map((src) => {
                    const audio = new Audio(src);
                    audio.preload = 'auto';
                    audio.volume = this.masterVolume * config.volume;

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
        },

        setMasterVolume(value) {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                return;
            }

            this.masterVolume = Math.max(0, Math.min(1, parsed));
            Object.entries(this.sounds).forEach(([eventName, audio]) => {
                const config = this.soundMeta[eventName] || { volume: 1 };
                const variants = Array.isArray(audio) ? audio : [];
                variants.forEach((variant) => {
                    if (variant?.audio) {
                        variant.audio.volume = this.masterVolume * config.volume;
                    }
                });
            });

            this.activeAudioNodes.forEach((audioNode) => {
                if (!audioNode || typeof audioNode.dataset?.eventName !== 'string') {
                    return;
                }

                const config = this.soundMeta[audioNode.dataset.eventName] || { volume: 1 };
                audioNode.volume = this.masterVolume * config.volume;
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

            const soundConfig = this.soundMeta[eventName] || { volume: 1 };
            const runtimeVolume = Number.isFinite(Number(options.volume))
                ? Number(options.volume)
                : 1;

            const effectiveVolume = Math.max(0, Math.min(1, this.masterVolume * soundConfig.volume * runtimeVolume));

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
})(window);
