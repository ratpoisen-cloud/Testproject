// ==================== ГЛАВНЫЙ ФАЙЛ ====================
// Отвечает за: инициализацию приложения, последовательную загрузку модулей

window.initBoardSettingsControls = function() {
    if (window.__boardSettingsControlsInitialized) return;

    const toggleBtn = document.getElementById('board-settings-toggle');
    const menu = document.getElementById('board-settings-menu');
    const themeSelect = document.getElementById('theme-select');
    const pieceSetSelect = document.getElementById('piece-set-select');

    if (toggleBtn && menu) {
        toggleBtn.addEventListener('click', () => {
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
    window.verifyDataAdapterLoaded();

    // Инициализируем авторизацию
    window.setupAuth();

    // Загружаем тему
    window.loadTheme();

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
        window.initGame(roomId);
    } else {
        window.initLobby();
    }
});

// Обработка изменения размера окна (адаптивность доски)
window.addEventListener('resize', () => {
    if (window.board) {
        requestAnimationFrame(() => window.board.resize());
    }
});
