// ==================== ГЛАВНЫЙ ФАЙЛ ====================
// Отвечает за: инициализацию приложения, последовательную загрузку модулей

window.__appLoadingFlags = {
    boot: true,
    auth: true,
    lobby: false
};

window.updateAppLoadingOverlay = function() {
    const overlay = document.getElementById('app-loading-overlay');
    if (!overlay) return;

    const isLoading = Object.values(window.__appLoadingFlags).some(Boolean);
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

    const toggleBtn = document.getElementById('board-settings-toggle');
    const menu = document.getElementById('board-settings-menu');
    const themeSelect = document.getElementById('theme-select');
    const uiThemeSelect =
        document.getElementById('ui-theme-select') ||
        document.getElementById('user-ui-theme-select');
    const pieceSetSelect = document.getElementById('piece-set-select');

    if (toggleBtn && menu) {
        toggleBtn.addEventListener('click', () => {
            const willOpen = menu.classList.contains('hidden');
            if (willOpen) {
                window.closeUserMenu?.();
            }
            menu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            const insideMenu = menu.contains(e.target);
            const insideButton = toggleBtn.contains(e.target);

            if (!insideMenu && !insideButton) {
                menu.classList.add('hidden');
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

    // Инициализируем авторизацию
    window.setupAuth();

    // Инициализируем кнопки тем
    window.initThemeButtons();

    // Инициализируем UI настроек доски (один раз)
    window.initBoardSettingsControls();

    // Ждем авторизации для инициализации кнопки очистки
    const checkUser = setInterval(() => {
        if (window.currentUser) {
            clearInterval(checkUser);
            window.initClearFinishedButton(window.currentUser.uid);
        }
    }, 500);

    // Проверяем, есть ли комната в URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
        window.setAppLoadingFlag('lobby', true);
        window.initGame(roomId);
    } else {
        window.initLobby();
    }

    window.setAppLoadingFlag('boot', false);
});

// Обработка изменения размера окна (адаптивность доски)
window.addEventListener('resize', () => {
    window.scheduleBoardResizeSync?.();
});
