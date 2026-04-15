// ==================== SOUND MANAGER ====================
// Единый глобальный модуль звуков приложения.
// Активные события: piece_select, move, capture_default, capture_ranged.
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

        play(eventName, options = {}) {
            if (!this.initialized) {
                this.init();
            }

            if (!this.enabled || !eventName || this.isOnCooldown(eventName)) {
                return;
            }

            const soundVariants = this.sounds[eventName];
            if (!Array.isArray(soundVariants) || soundVariants.length === 0) {
                return;
            }

            const soundConfig = this.soundMeta[eventName] || { volume: 1 };
            const runtimeVolume = Number.isFinite(Number(options.volume))
                ? Number(options.volume)
                : 1;

            const effectiveVolume = Math.max(0, Math.min(1, this.masterVolume * soundConfig.volume * runtimeVolume));

            try {
                const availableVariants = soundVariants.filter((variant) => variant?.audio);
                if (availableVariants.length === 0) {
                    return;
                }

                const lastVariantIndex = this.lastPlayedVariantIndex[eventName];
                const candidateVariants = availableVariants.length > 1
                    ? availableVariants.filter((variant) => variant !== soundVariants[lastVariantIndex])
                    : availableVariants;
                const finalPool = candidateVariants.length > 0 ? candidateVariants : availableVariants;
                const pickedVariant = finalPool[Math.floor(Math.random() * finalPool.length)];
                const pickedVariantIndex = soundVariants.indexOf(pickedVariant);
                const baseAudio = pickedVariant?.audio;
                if (!baseAudio) {
                    return;
                }

                const audioToPlay = baseAudio.cloneNode(true);
                audioToPlay.volume = effectiveVolume;
                audioToPlay.dataset.eventName = eventName;
                audioToPlay.dataset.src = pickedVariant.src;
                this.lastPlayedAt[eventName] = Date.now();
                this.lastPlayedVariantIndex[eventName] = pickedVariantIndex;
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
