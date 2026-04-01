// ==================== УПРАВЛЕНИЕ ДОСКОЙ ====================
// Отвечает за: инициализацию доски, подсветку клеток, drag-and-drop для десктопа, клики для мобилы

window.DEFAULT_PIECE_THEME = 'https://chessboardjs.com/img/chesspieces/alpha/{piece}.png';
window.PIECE_SET_STORAGE_KEY = 'chess-piece-set';
window.CUSTOM_PIECE_THEME_STORAGE_KEY = 'chess-piece-theme-template';

window.getCurrentPieceTheme = function() {
    const setName = localStorage.getItem(window.PIECE_SET_STORAGE_KEY) || 'default';
    const customTemplate = localStorage.getItem(window.CUSTOM_PIECE_THEME_STORAGE_KEY);

    if (setName === 'custom' && customTemplate && customTemplate.includes('{piece}')) {
        return customTemplate;
    }

    return window.DEFAULT_PIECE_THEME;
};

window.getBoardConfig = function() {
    return {
        draggable: !window.isMobile,
        onDragStart: window.handleDragStart,
        onDrop: window.handleDrop,
        onMouseoutSquare: window.handleMouseoutSquare,
        onMouseoverSquare: window.handleMouseoverSquare,
        position: 'start',
        moveSpeed: 200,  // Быстрая анимация
        pieceTheme: window.getCurrentPieceTheme()
    };
};

window.rebuildBoardWithCurrentState = function() {
    const fen = window.game ? window.game.fen() : 'start';
    const orientation = window.playerColor === 'b' ? 'black' : 'white';

    if (window.board && typeof window.board.destroy === 'function') {
        window.board.destroy();
    }

    window.board = Chessboard('myBoard', window.getBoardConfig());
    window.board.position(fen, false);
    window.board.orientation(orientation);

    if (window.isMobile && window.playerColor) {
        window.attachMobileClickHandler();
    }
};

window.applyPieceSet = function(setName) {
    if (setName === 'custom') {
        const currentValue = localStorage.getItem(window.CUSTOM_PIECE_THEME_STORAGE_KEY) || '';
        const userTemplate = prompt(
            'Вставьте URL-шаблон для фигурок (должен содержать {piece}).\nПример: https://example.com/pieces/{piece}.png',
            currentValue
        );

        if (!userTemplate) {
            return false;
        }

        const normalizedTemplate = userTemplate.trim();
        if (!normalizedTemplate.includes('{piece}')) {
            alert('Некорректный шаблон: в URL обязательно должно быть {piece}.');
            return false;
        }

        localStorage.setItem(window.CUSTOM_PIECE_THEME_STORAGE_KEY, normalizedTemplate);
        localStorage.setItem(window.PIECE_SET_STORAGE_KEY, 'custom');
    } else {
        localStorage.setItem(window.PIECE_SET_STORAGE_KEY, 'default');
    }

    if (window.board) {
        window.rebuildBoardWithCurrentState();
    }

    return true;
};

window.initPieceSetControls = function(pieceSetSelect) {
    if (!pieceSetSelect) return;

    const savedSet = localStorage.getItem(window.PIECE_SET_STORAGE_KEY) || 'default';
    pieceSetSelect.value = savedSet === 'custom' ? 'custom' : 'default';

    pieceSetSelect.addEventListener('change', (e) => {
        const previousValue = localStorage.getItem(window.PIECE_SET_STORAGE_KEY) || 'default';
        const applied = window.applyPieceSet(e.target.value);
        if (!applied) {
            pieceSetSelect.value = previousValue === 'custom' ? 'custom' : 'default';
        }
    });
};

// Инициализация доски
window.initBoard = function(playerColor) {
    window.board = Chessboard('myBoard', window.getBoardConfig());
    
    if (playerColor === 'b') window.board.orientation('black');
    
    // Для мобильных устройств используем клики
    if (window.isMobile && playerColor) {
        window.attachMobileClickHandler();
    }
    
    return window.board;
};

// ==================== ДЕСКТОПНАЯ ЛОГИКА (drag-and-drop) ====================

// Проверка перед началом перетаскивания
window.handleDragStart = function(source, piece, position, orientation) {
    if (window.game.game_over() || 
        !window.playerColor || 
        window.game.turn() !== window.playerColor || 
        window.pendingMove) {
        return false;
    }
    
    const pieceColor = piece.charAt(0);
    if ((window.playerColor === 'w' && pieceColor === 'b') ||
        (window.playerColor === 'b' && pieceColor === 'w')) {
        return false;
    }
    
    window.dragSourceSquare = source;
    window.showPossibleMoves(source);
    
    return true;
};

// Подсветка при наведении на клетку
window.handleMouseoverSquare = function(square, piece) {
    if (window.isMobile) return;
    if (!window.playerColor || window.game.game_over() || window.pendingMove) return;
    
    if (window.dragSourceSquare) return;
    
    if (piece && piece.charAt(0) === window.playerColor && window.game.turn() === window.playerColor) {
        window.showPossibleMoves(square);
    }
};

// Убираем подсветку при уходе мыши
window.handleMouseoutSquare = function(square, piece) {
    if (window.isMobile) return;
    if (!window.dragSourceSquare) {
        window.removeTemporaryHighlights();
    }
};

// Показ возможных ходов для фигуры
window.showPossibleMoves = function(square) {
    window.removeTemporaryHighlights();
    window.highlightSquare(square, 'highlight-drag-source');
    
    const moves = window.game.moves({ square: square, verbose: true });
    moves.forEach(move => {
        if (move.captured) {
            window.highlightSquare(move.to, 'highlight-capture');
        } else {
            window.highlightSquare(move.to, 'highlight-possible');
        }
    });
};

// Убираем временную подсветку
window.removeTemporaryHighlights = function() {
    $('#myBoard .square-55d63').removeClass('highlight-drag-source highlight-possible highlight-capture');
};

// Обработка сброса фигуры (drag-and-drop)
window.handleDrop = function(source, target) {
    if (window.isMobile) return 'snapback';
    
    window.removeTemporaryHighlights();
    
    if (window.game.game_over() || !window.playerColor || window.game.turn() !== window.playerColor || window.pendingMove) {
        window.dragSourceSquare = null;
        return 'snapback';
    }
    
    const preview = window.buildMovePreview(source, target, 'q');
    
    if (!preview) {
        window.dragSourceSquare = null;
        return 'snapback';
    }
    
    // Сохраняем ход
    window.pendingMove = preview;
    
    // Показываем ход на доске
    window.updateBoardPosition(preview.previewFen, true);
    
    // Показываем оверлей подтверждения
    document.getElementById('confirm-move-box')?.classList.remove('hidden');
    
    window.dragSourceSquare = null;
    return 'snapback';
};

// ==================== МОБИЛЬНАЯ ЛОГИКА (клики) ====================

// Прикрепление обработчика кликов для мобильных устройств
window.attachMobileClickHandler = function() {
    $('#myBoard').off('click');
    $('#myBoard').on('click', '.square-55d63', function(e) {
        e.stopPropagation();
        const square = $(this).attr('data-square');
        if (square) {
            window.handleMobileClick(square);
        }
    });
};

// Мобильный клик
window.handleMobileClick = function(square) {
    if (window.game.game_over()) return;
    if (!window.playerColor) return;
    if (window.game.turn() !== window.playerColor) return;
    if (window.pendingMove) return;
    
    const piece = window.game.get(square);
    
    if (window.selectedSquare) {
        if (window.selectedSquare === square) {
            window.clearSelection();
            return;
        }
        
        const preview = window.buildMovePreview(window.selectedSquare, square, 'q');
        
        if (preview) {
            window.pendingMove = preview;
            // Показываем ход на доске
            window.updateBoardPosition(preview.previewFen, true);
            document.getElementById('confirm-move-box').classList.remove('hidden');
            window.clearSelection();
        } else {
            if (piece && piece.color === window.playerColor) {
                window.selectSquare(square);
            } else {
                window.clearSelection();
            }
        }
    } else {
        if (piece && piece.color === window.playerColor) {
            window.selectSquare(square);
        }
    }
};

// ==================== ОБЩИЕ ФУНКЦИИ ====================

// Выделение фигуры и подсветка доступных ходов (для мобильной версии)
window.selectSquare = function(square) {
    window.clearSelection();
    window.selectedSquare = square;
    window.highlightSquare(square, 'highlight-selected');
    
    const moves = window.game.moves({ square: square, verbose: true });
    moves.forEach(move => {
        if (move.captured) {
            window.highlightSquare(move.to, 'highlight-capture');
        } else {
            window.highlightSquare(move.to, 'highlight-possible');
        }
    });
};

// Сброс выделения и подсветки
window.clearSelection = function() {
    window.selectedSquare = null;
    window.removeHighlights();
};

// Обновление позиции доски
window.updateBoardPosition = function(fen, animate = true) {
    if (window.board) {
        window.board.position(fen, animate);
    }
};

// Создание безопасного предпросмотра хода без изменения основной партии
window.buildMovePreview = function(from, to, promotion = 'q') {
    const previewGame = new Chess(window.game.fen());
    const move = previewGame.move({ from, to, promotion });

    if (!move) return null;

    return {
        from,
        to,
        promotion,
        san: move.san,
        previewFen: previewGame.fen()
    };
};

// Полная очистка подсветки
window.removeHighlights = function() {
    $('#myBoard .square-55d63').removeClass('highlight-selected highlight-drag-source highlight-possible highlight-capture');
};

// Подсветка клетки
window.highlightSquare = function(square, type) {
    $(`.square-${square}`).addClass(type);
};

// Обновление ориентации доски
window.setBoardOrientation = function(color) {
    if (window.board) {
        window.board.orientation(color === 'b' ? 'black' : 'white');
    }
};
// Подсветка последнего хода
function highlightLastMove(move) {
    removeLastMoveHighlight();

    document.querySelector(`.square-${move.from}`)?.classList.add('last-move');
    document.querySelector(`.square-${move.to}`)?.classList.add('last-move');
}

function removeLastMoveHighlight() {
    document.querySelectorAll('.last-move')
        .forEach(el => el.classList.remove('last-move'));
}
window.highlightLastMove = highlightLastMove;
