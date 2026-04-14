// ==================== SOUND MANAGER ====================
// Единый глобальный модуль звуков приложения.
// Текущие события: piece_select, move, capture.
// Подготовленные события: castle, check, promotion, checkmate, game_start, game_end.

(function initSoundManager(global) {
    if (global.SoundManager) {
        return;
    }

    const SOUND_DEFINITIONS = {
        piece_select: 'assets/sounds/select.mp3',
        move: 'assets/sounds/move.mp3',
        capture: 'assets/sounds/capture.mp3',

        // Подготовлено для будущего расширения
        castle: null,
        check: null,
        promotion: null,
        checkmate: null,
        game_start: null,
        game_end: null
    };

    const DEFAULT_COOLDOWNS_MS = {
        piece_select: 90
    };

    const manager = {
        enabled: true,
        masterVolume: 0.55,
        initialized: false,
        sounds: {},
        lastPlayedAt: {},

        init() {
            if (this.initialized) {
                return;
            }

            Object.entries(SOUND_DEFINITIONS).forEach(([eventName, path]) => {
                if (!path) {
                    return;
                }

                const audio = new Audio(path);
                audio.preload = 'auto';
                audio.volume = this.masterVolume;
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
            Object.values(this.sounds).forEach((audio) => {
                if (audio) {
                    audio.volume = this.masterVolume;
                }
            });
        },

        isOnCooldown(eventName) {
            const cooldownMs = DEFAULT_COOLDOWNS_MS[eventName] || 0;
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

            const volume = Number.isFinite(Number(options.volume))
                ? Number(options.volume)
                : 1;
            const effectiveVolume = Math.max(0, Math.min(1, this.masterVolume * volume));

            try {
                const audioToPlay = baseAudio.cloneNode(true);
                audioToPlay.volume = effectiveVolume;
                this.lastPlayedAt[eventName] = Date.now();
                const playPromise = audioToPlay.play();

                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((error) => {
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
