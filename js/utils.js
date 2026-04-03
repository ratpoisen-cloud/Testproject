// ==================== УТИЛИТЫ ====================
// Отвечает за: вспомогательные функции, определение устройства, генерацию ID

// Определение мобильного устройства
window.isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   ('ontouchstart' in window && window.innerWidth < 768);

// Генерация ID комнаты
window.generateRoomId = function() {
    return Math.random().toString(36).substring(2, 8);
};

// Получение имени пользователя
window.getUserName = function(user) {
    return user ? (user.displayName || user.email.split('@')[0]) : 'Аноним';
};

// Получение ID пользователя
window.getUserId = function(user) {
    return user ? user.uid : 'anon_' + Math.random().toString(36).substring(2, 9);
};

// Сообщение о результате игры
window.getGameResultMessage = function(game) {
    if (game.in_checkmate()) return `Мат! ${game.turn() === 'w' ? 'Черные' : 'Белые'} победили`;
    if (game.in_stalemate()) return "Пат! Ничья";
    if (game.in_threefold_repetition()) return "Ничья (троекратное повторение)";
    if (game.insufficient_material()) return "Ничья (недостаточно фигур)";
    return "Игра окончена";
};

// Вычисление результата в PGN с приоритетом внешних причин (сдача/соглашение) над локальными эвристиками.
window.resolveGameResult = function(game, data) {
    const resignColor = data?.resign;
    if (resignColor === 'w') return '0-1';
    if (resignColor === 'b') return '1-0';

    const message = String(data?.message || '').toLowerCase();
    if (message.includes('ничья')) return '1/2-1/2';
    if (message.includes('сдач')) {
        if (message.includes('бел')) return '1-0';
        if (message.includes('черн')) return '0-1';
    }

    if (game?.in_checkmate?.()) return game.turn() === 'w' ? '0-1' : '1-0';
    if (game?.in_draw?.() || game?.in_stalemate?.() || game?.in_threefold_repetition?.() || game?.insufficient_material?.()) {
        return '1/2-1/2';
    }

    return '*';
};

// Единая точка формирования PGN-заголовков.
window.applyGameHeaders = function(game, data) {
    if (!game) return { result: '*', message: 'Игра окончена' };

    const players = data?.players || {};
    if (players.whiteName) game.header('White', players.whiteName);
    if (players.blackName) game.header('Black', players.blackName);

    const result = window.resolveGameResult(game, data);
    game.header('Result', result);

    if (data?.gameState === 'game_over') {
        game.header('Termination', data?.message || window.getGameResultMessage(game));
    }

    return {
        result,
        message: data?.message || window.getGameResultMessage(game)
    };
};
// Форматирование времени для отображения в лобби
window.formatTimeAgo = function(timestamp) {
    if (!timestamp) return "неизвестно";
    
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) {
        return "только что";
    } else if (minutes < 60) {
        return `${minutes} мин. назад`;
    } else if (hours < 24) {
        return `${hours} ч. назад`;
    } else if (days < 7) {
        return `${days} дн. назад`;
    } else {
        const date = new Date(timestamp);
        return `${date.getDate()}.${date.getMonth() + 1}`;
    }
};
