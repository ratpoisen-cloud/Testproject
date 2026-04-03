// ==================== УПРАВЛЕНИЕ ДОСКОЙ ====================
// Отвечает за: инициализацию доски, подсветку клеток, drag-and-drop для десктопа, клики для мобилы

window.PIECE_SET_STORAGE_KEY = 'chess-piece-set';
window.DEFAULT_PIECE_SET = 'cdn';
window.PIECE_SETS = {
    cdn: { label: 'Стандартные (CDN)', theme: 'https://chessboardjs.com/img/chesspieces/alpha/{piece}.png' },
    alpha: { label: 'alpha', theme: 'assets/pieces/alpha/{piece}.svg' },
    chessnut: { label: 'chessnut', theme: 'assets/pieces/chessnut/{piece}.svg' },
    pixel: { label: 'pixel', theme: 'assets/pieces/pixel/{piece}.svg' },
    tatiana: { label: 'tatiana', theme: 'assets/pieces/tatiana/{piece}.svg' }
};

window.getCurrentPieceTheme = function() {
    const setName = localStorage.getItem(window.PIECE_SET_STORAGE_KEY) || window.DEFAULT_PIECE_SET;
    const selectedSet = window.PIECE_SETS[setName];

    if (selectedSet && selectedSet.theme) {
        return selectedSet.theme;
    }

    return window.PIECE_SETS[window.DEFAULT_PIECE_SET].theme;
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
    window.updateCheckHighlight(fen);

    if (window.isMobile && window.playerColor) {
        window.attachMobileClickHandler();
    }
};

window.applyPieceSet = function(setName) {
    const exists = Boolean(window.PIECE_SETS[setName]);
    const safeSetName = exists ? setName : window.DEFAULT_PIECE_SET;

    localStorage.setItem(window.PIECE_SET_STORAGE_KEY, safeSetName);

    if (window.board) {
        window.rebuildBoardWithCurrentState();
    }

    return safeSetName;
};

window.initPieceSetControls = function(pieceSetSelect) {
    if (!pieceSetSelect) return;

    pieceSetSelect.innerHTML = '';
    Object.entries(window.PIECE_SETS).forEach(([setId, setConfig]) => {
        const option = document.createElement('option');
        option.value = setId;
        option.textContent = setConfig.label;
        pieceSetSelect.appendChild(option);
    });

    const savedSet = localStorage.getItem(window.PIECE_SET_STORAGE_KEY) || window.DEFAULT_PIECE_SET;
    pieceSetSelect.value = window.PIECE_SETS[savedSet] ? savedSet : window.DEFAULT_PIECE_SET;

    pieceSetSelect.addEventListener('change', (e) => {
        const appliedSetName = window.applyPieceSet(e.target.value);
        pieceSetSelect.value = appliedSetName;
    });
};

// Инициализация доски
window.initBoard = function(playerColor) {
    window.board = Chessboard('myBoard', window.getBoardConfig());
    window.updateCheckHighlight(window.game?.fen ? window.game.fen() : 'start');
    
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

    window.updateCheckHighlight(fen);
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

window.removeCheckHighlight = function() {
    $('#myBoard .square-55d63').removeClass('highlight-check');
};

window.findCheckedKingSquare = function(fen) {
    const positionGame = new Chess(fen || window.game.fen());
    if (!positionGame.in_check()) return null;

    const checkedColor = positionGame.turn();
    const boardState = positionGame.board();

    for (let rank = 0; rank < boardState.length; rank++) {
        for (let file = 0; file < boardState[rank].length; file++) {
            const piece = boardState[rank][file];
            if (!piece || piece.type !== 'k' || piece.color !== checkedColor) continue;

            const fileChar = String.fromCharCode(97 + file);
            const rankNumber = 8 - rank;
            return `${fileChar}${rankNumber}`;
        }
    }

    return null;
};

window.updateCheckHighlight = function(fen) {
    window.removeCheckHighlight();

    const kingSquare = window.findCheckedKingSquare(fen);
    if (kingSquare) {
        window.highlightSquare(kingSquare, 'highlight-check');
    }
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
