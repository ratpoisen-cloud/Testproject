// ==================== SOUND MANAGER ====================
// Единый глобальный модуль звуков приложения.
// Активные события: piece_select, move, capture.
// Зарезервированные события: castle, check, promotion, checkmate, game_start, game_end, enemy_move, your_turn.

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
        move: {
            src: 'assets/sounds/move.mp3',
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        capture: {
            src: 'assets/sounds/capture.mp3',
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
            src: null,
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        promotion: {
            src: null,
            volume: 1,
            category: 'gameplay',
            cooldown: 0
        },
        checkmate: {
            src: null,
            volume: 1,
            category: 'gameplay',
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
        if (typeof configValue === 'string') {
            // Обратная совместимость со старым форматом: event: 'path/to/file.mp3'
            return {
                src: configValue,
                volume: 1,
                category: 'default',
                cooldown: 0
            };
        }

        if (!configValue || typeof configValue !== 'object') {
            return {
                src: null,
                volume: 1,
                category: 'default',
                cooldown: 0
            };
        }

        return {
            src: configValue.src || null,
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
        lastPlayedAt: {},
        activeAudioNodes: new Set(),

        init() {
            if (this.initialized) {
                return;
            }

            Object.entries(SOUND_DEFINITIONS).forEach(([eventName, rawConfig]) => {
                const config = normalizeSoundConfig(rawConfig);
                this.soundMeta[eventName] = config;

                if (!config.src) {
                    return;
                }

                const audio = new Audio(config.src);
                audio.preload = 'auto';
                audio.volume = this.masterVolume * config.volume;
                this.sounds[eventName] = audio;
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
                if (audio) {
                    audio.volume = this.masterVolume * config.volume;
                }
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

        play(eventName, options = {}) {
            if (!this.initialized) {
                this.init();
            }

            if (!this.enabled || !eventName || this.isOnCooldown(eventName)) {
                return;
            }

            const baseAudio = this.sounds[eventName];
            if (!baseAudio) {
                return;
            }

            const soundConfig = this.soundMeta[eventName] || { volume: 1 };
            const runtimeVolume = Number.isFinite(Number(options.volume))
                ? Number(options.volume)
                : 1;

            const effectiveVolume = Math.max(0, Math.min(1, this.masterVolume * soundConfig.volume * runtimeVolume));

            try {
                const audioToPlay = baseAudio.cloneNode(true);
                audioToPlay.volume = effectiveVolume;
                audioToPlay.dataset.eventName = eventName;
                this.lastPlayedAt[eventName] = Date.now();
                this.activeAudioNodes.add(audioToPlay);

                const clearFromActive = () => {
                    this.activeAudioNodes.delete(audioToPlay);
                };

                audioToPlay.addEventListener('ended', clearFromActive, { once: true });
                audioToPlay.addEventListener('pause', () => {
                    if (audioToPlay.ended || audioToPlay.currentTime === 0) {
                        clearFromActive();
                    }
                });

                const playPromise = audioToPlay.play();

                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((error) => {
                        this.activeAudioNodes.delete(audioToPlay);
                        console.warn(`[SoundManager] Не удалось воспроизвести "${eventName}"`, error);
                    });
                }
            } catch (error) {
                console.warn(`[SoundManager] Ошибка при воспроизведении "${eventName}"`, error);
            }
        }
    };

    manager.init();
    global.SoundManager = manager;
})(window);
