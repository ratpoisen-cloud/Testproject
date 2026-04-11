// ==================== ТЕМЫ ДОСКИ ====================
// Отвечает за: управление цветовыми темами доски

// Список доступных тем
window.THEMES = [
    'theme-classic',
    'theme-forest', 
    'theme-ocean',
    'theme-dark',
    'theme-marble',
    'theme-chesscom',
    'theme-lime',
    'theme-middle-earth'
];

// Установка темы
window.setTheme = function(themeName) {
    if (!themeName || !window.THEMES.includes(themeName)) {
        themeName = 'theme-classic';
    }
    
    // Удаляем все существующие темы
    window.THEMES.forEach(theme => {
        document.body.classList.remove(theme);
    });
    
    // Добавляем новую тему
    document.body.classList.add(themeName);
    
    // Сохраняем в localStorage
    localStorage.setItem('chess-theme', themeName);
    
    // Обновляем активную кнопку
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.dataset.theme === themeName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Обновляем доску
    if (window.board && window.game) {
        window.board.position(window.game.fen(), true);
    }
};

// Загрузка сохраненной темы
window.loadTheme = function() {
    const savedTheme = localStorage.getItem('chess-theme');
    if (savedTheme && window.THEMES.includes(savedTheme)) {
        window.setTheme(savedTheme);
    } else {
        window.setTheme('theme-classic');
    }
};

// Инициализация кнопок тем
window.initThemeButtons = function() {
    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            if (theme) {
                window.setTheme(theme);
            }
        });
    });
};

// ==================== UI ТЕМЫ АККАУНТА ====================
// Отвечает за: глобальную тему интерфейса (вне шахматной доски)

window.UI_THEMES = ['default', 'pixel'];

window.updateGuestWordmark = function(themeName) {
    const guestWordmarkImg = document.getElementById('guest-wordmark-img');
    if (!guestWordmarkImg) return;

    const useLightWordmark = themeName === 'pixel';
    const nextSrc = useLightWordmark
        ? 'assets/logo/gochess_wordmark_light.svg'
        : 'assets/logo/gochess_wordmark_dark.svg';

    if (guestWordmarkImg.getAttribute('src') !== nextSrc) {
        guestWordmarkImg.setAttribute('src', nextSrc);
    }
};

window.setUITheme = function(themeName) {
    if (!themeName || !window.UI_THEMES.includes(themeName)) {
        themeName = 'default';
    }

    document.body.setAttribute('data-ui-theme', themeName);
    window.updateGuestWordmark(themeName);
    localStorage.setItem('chess-ui-theme', themeName);

    const uiThemeSelect =
        document.getElementById('ui-theme-select') ||
        document.getElementById('user-ui-theme-select');
    if (uiThemeSelect && uiThemeSelect.value !== themeName) {
        uiThemeSelect.value = themeName;
    }
};

window.loadUITheme = function() {
    const savedTheme = localStorage.getItem('chess-ui-theme');
    if (savedTheme && window.UI_THEMES.includes(savedTheme)) {
        window.setUITheme(savedTheme);
    } else {
        window.setUITheme('default');
    }
};
