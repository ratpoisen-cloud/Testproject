// ==================== ГЛАВНЫЙ ФАЙЛ ====================
// Отвечает за: инициализацию приложения, последовательную загрузку модулей

window.__appLoadingFlags = {
    boot: true,
    auth: true,
    lobby: false
};

window.__appLoadingOverlayState = {
    firstOverlayShownAt: Date.now(),
    minimumFirstOverlayMs: 1800,
    firstOverlayGateActive: true,
    gateTimerId: null
};

window.updateAppLoadingOverlay = function() {
    const overlay = document.getElementById('app-loading-overlay');
    if (!overlay) return;

    const overlayState = window.__appLoadingOverlayState;
    const isLoadingByFlags = Object.values(window.__appLoadingFlags).some(Boolean);
    const firstOverlayElapsed = Date.now() - overlayState.firstOverlayShownAt;
    const hasReachedMinimumFirstOverlay = firstOverlayElapsed >= overlayState.minimumFirstOverlayMs;
    const firstOverlayGateOpen = !overlayState.firstOverlayGateActive || hasReachedMinimumFirstOverlay;
    const isLoading = isLoadingByFlags || !firstOverlayGateOpen;

    if (hasReachedMinimumFirstOverlay) {
        overlayState.firstOverlayGateActive = false;
        if (overlayState.gateTimerId) {
            clearTimeout(overlayState.gateTimerId);
            overlayState.gateTimerId = null;
        }
    } else if (!overlayState.gateTimerId) {
        const remainingMs = overlayState.minimumFirstOverlayMs - firstOverlayElapsed;
        overlayState.gateTimerId = setTimeout(() => {
            overlayState.gateTimerId = null;
            window.updateAppLoadingOverlay();
        }, remainingMs);
    }

    overlay.classList.toggle('hidden', !isLoading);
    document.body.classList.toggle('app-loading', isLoading);
};

window.setAppLoadingFlag = function(flagName, value) {
    if (!Object.prototype.hasOwnProperty.call(window.__appLoadingFlags, flagName)) {
        return;
    }
    window.__appLoadingFlags[flagName] = Boolean(value);
    window.updateAppLoadingOverlay();
};

window.markLobbyReady = function() {
    window.setAppLoadingFlag('lobby', false);
};

window.markGameReady = function() {
    window.setAppLoadingFlag('lobby', false);
};

window.initBoardSettingsControls = function() {
    if (window.__boardSettingsControlsInitialized) return;

    const themeSelect = document.getElementById('theme-select');
    const uiThemeSelect =
        document.getElementById('ui-theme-select') ||
        document.getElementById('user-ui-theme-select');
    const pieceSetSelect = document.getElementById('piece-set-select');
    const soundEnabledToggle = document.getElementById('sound-enabled-toggle');
    const soundMasterVolume = document.getElementById('sound-master-volume');
    const quickPhrasesToggle = document.getElementById('quick-phrases-toggle');
    const quickPhrasesMenu = document.getElementById('quick-phrases-menu');

    if (quickPhrasesToggle && quickPhrasesMenu) {
        quickPhrasesToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            quickPhrasesMenu.classList.toggle('hidden');
        });

        quickPhrasesMenu.querySelectorAll('.quick-phrase-item').forEach((item) => {
            item.addEventListener('click', async (event) => {
                event.stopPropagation();
                const text = item.textContent || '';
                const emoji = item.dataset.emoji || '⚡';
                quickPhrasesMenu.classList.add('hidden');

                if (window.isLocalGameMode?.()) {
                    window.notify('Быстрые фразы доступны только в онлайн-партии', 'info', 2200);
                    return;
                }

                if (!window.currentRoomId || (window.playerColor !== 'w' && window.playerColor !== 'b')) {
                    window.notify('Быстрые фразы доступны только активным игрокам', 'info', 2200);
                    return;
                }

                await window.pushQuickPhrase?.({ text, emoji });
            });
        });

        document.addEventListener('click', (e) => {
            const insideMenu = quickPhrasesMenu.contains(e.target);
            const insideButton = quickPhrasesToggle.contains(e.target);

            if (!insideMenu && !insideButton) {
                quickPhrasesMenu.classList.add('hidden');
            }
        });
    }

    if (themeSelect) {
        const savedTheme = localStorage.getItem('chess-theme') || 'theme-classic';
        themeSelect.value = savedTheme;

        themeSelect.addEventListener('change', (e) => {
            if (window.setTheme) {
                window.setTheme(e.target.value);
            }
        });
    }

    if (uiThemeSelect) {
        const savedUITheme = localStorage.getItem('chess-ui-theme');
        const allowedTheme = window.UI_THEMES?.includes(savedUITheme) ? savedUITheme : 'default';
        if (savedUITheme !== allowedTheme) {
            localStorage.setItem('chess-ui-theme', allowedTheme);
        }
        uiThemeSelect.value = allowedTheme;

        uiThemeSelect.addEventListener('change', (e) => {
            if (window.setUITheme) {
                window.setUITheme(e.target.value);
            }
        });
    }

    if (pieceSetSelect && window.initPieceSetControls) {
        window.initPieceSetControls(pieceSetSelect);
    }

    if (soundEnabledToggle || soundMasterVolume) {
        const audioBlock = document.querySelector('.user-menu-setting-audio');

        const syncSoundControls = () => {
            const settings = window.SoundManager?.getSettings?.() || window.soundSettings || {};
            const enabled = settings.enabled !== false;
            const master = Number.isFinite(Number(settings.master)) ? Number(settings.master) : 0.8;

            if (soundEnabledToggle) {
                soundEnabledToggle.checked = enabled;
            }
            if (soundMasterVolume) {
                soundMasterVolume.value = String(Math.max(0, Math.min(1, master)));
                soundMasterVolume.disabled = !enabled;
            }
            if (audioBlock) {
                audioBlock.classList.toggle('is-muted', !enabled);
            }
        };

        syncSoundControls();

        if (soundEnabledToggle) {
            soundEnabledToggle.addEventListener('change', (e) => {
                const isEnabled = Boolean(e.target?.checked);
                window.SoundManager?.setEnabled?.(isEnabled);
                if (soundMasterVolume) {
                    soundMasterVolume.disabled = !isEnabled;
                }
                if (audioBlock) {
                    audioBlock.classList.toggle('is-muted', !isEnabled);
                }
                if (isEnabled) {
                    window.SoundManager?.play?.('button_click', { volume: 0.55 });
                }
            });
        }

        if (soundMasterVolume) {
            let lastPreviewAt = 0;
            let lastPreviewValue = Number(soundMasterVolume.value) || 0.8;
            soundMasterVolume.addEventListener('input', (e) => {
                const value = Number(e.target?.value);
                window.SoundManager?.setMasterVolume?.(value);
                if (!window.SoundManager?.enabled) {
                    return;
                }
                const now = Date.now();
                const delta = Math.abs(value - lastPreviewValue);
                if (delta > 0.02 && now - lastPreviewAt > 180) {
                    lastPreviewAt = now;
                    lastPreviewValue = value;
                    window.SoundManager?.play?.('button_rollover', { volume: 0.45 });
                }
            });

            soundMasterVolume.addEventListener('change', () => {
                if (window.SoundManager?.enabled) {
                    window.SoundManager?.play?.('button_click_release', { volume: 0.8 });
                }
            });
        }
    }

    window.initPresenceStatusControls?.();

    window.__boardSettingsControlsInitialized = true;
};

window.verifyDataAdapterLoaded = function() {
    setTimeout(() => {
        if (typeof ref === 'undefined') {
            console.error('Data adapter not loaded! Expected compat API from js/firebase.js (Supabase-backed).');
        }
    }, 1000);
};

// Инициализация приложения
window.addEventListener('DOMContentLoaded', () => {
    window.updateAppLoadingOverlay();
    window.verifyDataAdapterLoaded();

    // Загружаем тему
    window.loadTheme();
    window.loadUITheme();

    // Инициализируем кнопки тем
    window.initThemeButtons();

    // Инициализируем UI настроек доски (один раз)
    window.initBoardSettingsControls();
    window.bindTopBrandHomeAction?.();

    // Ждем авторизации для инициализации кнопки очистки
    let checkAttempts = 0;
    const maxCheckAttempts = 120; // 60 секунд при интервале 500ms
    const checkUser = setInterval(() => {
        checkAttempts += 1;
        if (window.currentUser) {
            clearInterval(checkUser);
            window.initClearFinishedButton(window.currentUser.uid);
            return;
        }

        if (checkAttempts >= maxCheckAttempts) {
            clearInterval(checkUser);
        }
    }, 500);

    // Проверяем параметры режима игры в URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const isBotMode = urlParams.get('bot') === '1';
    const isTrainingMode = urlParams.get('training') === '1';
    const trainingModeType = urlParams.get('mode');
    const isLocalMode = urlParams.get('local') === '1';
    const localModeType = urlParams.get('mode');
    const localVariant = urlParams.get('variant');
    const isPassAndPlayMode = !isLocalMode && localModeType === 'pass';

    if (roomId) {
        window.setAppLoadingFlag('lobby', true);
        window.initGame(roomId);
    } else if (isPassAndPlayMode) {
        // Legacy URL-путь для pass-and-play без local=1.
        // Оставляем ради обратной совместимости старых ссылок.
        window.setAppLoadingFlag('lobby', true);
        window.initLobby();
        window.initPassAndPlayGame({
            variant: localVariant || 'standard'
        });
    } else if (isBotMode) {
        window.setAppLoadingFlag('lobby', true);
        window.initLobby();
        window.initBotGame({
            color: urlParams.get('color') || 'random',
            level: urlParams.get('level') || 'medium'
        });
    } else if (isTrainingMode && trainingModeType === 'self') {
        window.setAppLoadingFlag('lobby', true);
        window.initLobby();
        window.initTrainingGame({ mode: 'self' });
    } else if (isLocalMode && localModeType === 'pass') {
        window.setAppLoadingFlag('lobby', true);
        window.initLobby();
        const hasResumed = window.resumePassAndPlayGame?.();
        if (!hasResumed) {
            window.initPassAndPlayGame({ variant: localVariant || 'standard' });
        }
    } else {
        window.initLobby();
    }

    // Инициализируем авторизацию после первичного роутинга,
    // чтобы не было гонки с локальным bot mode при гостевом состоянии.
    window.setupAuth();

    window.setAppLoadingFlag('boot', false);
});

// Обработка изменения размера окна (адаптивность доски)
window.addEventListener('resize', () => {
    window.scheduleBoardResizeSync?.();
});
