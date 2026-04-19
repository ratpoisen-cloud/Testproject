// ==================== УПРАВЛЕНИЕ ДОСКОЙ ====================
// Отвечает за: инициализацию доски, подсветку клеток, drag-and-drop для десктопа, клики для мобилы

window.PIECE_SET_STORAGE_KEY = 'chess-piece-set';
window.DEFAULT_PIECE_SET = 'tatiana';
window.LEGACY_PIECE_SET_MIGRATIONS = {
    cdn: 'alpha'
};
window.PIECE_SETS = {
    alpha: { label: 'alpha', theme: 'assets/pieces/alpha/{piece}.svg' },
    chessnut: { label: 'chessnut', theme: 'assets/pieces/chessnut/{piece}.svg' },
    pixel: { label: 'pixel', theme: 'assets/pieces/pixel/{piece}.svg' },
    tatiana: { label: 'tatiana', theme: 'assets/pieces/tatiana/{piece}.svg' }
};

window.BOARD_REACTIONS = ['💀', '🤡', '😭', '😏', '👀', '🔥', '😴', '⚰️', '🖕🏻', '💅🏻', '⚔️', '🏴‍☠️', '🤝', '🐒', '🤬', '💩'];
window.BOARD_REACTION_TTL_MS = 7000;
window.BOARD_REACTION_LONG_PRESS_MS = 450;
window.BOARD_REACTION_EVENTS_NS = '.boardReaction';
window.BOARD_MOBILE_TAP_EVENTS_NS = '.mobileBoardTap';
window.BOARD_RESIZE_SYNC_DELAY_MS = 80;
window.boardReactionPickerSquare = null;
window.boardReactionLongPressTimer = null;
window.boardReactionSuppressTapUntil = 0;
window.boardReactionLongPressTriggered = false;
window.__boardResizeSyncObserver = null;
window.__boardResizeSyncRafId = null;
window.__boardResizeSyncTimeoutId = null;
window.pendingPromotionSelection = null;

const PROMOTION_PIECE_ORDER = ['q', 'r', 'b', 'n'];
const PROMOTION_PIECE_TO_BOARD_SUFFIX = {
    q: 'Q',
    r: 'R',
    b: 'B',
    n: 'N'
};
const PIECE_TO_BOARD_SUFFIX = {
    p: 'P',
    n: 'N',
    b: 'B',
    r: 'R',
    q: 'Q',
    k: 'K'
};
const PROMOTION_PIECE_LABELS = {
    q: 'Ферзь',
    r: 'Ладья',
    b: 'Слон',
    n: 'Конь'
};

window.syncBoardSizeWithLayout = function() {
    if (!window.board || typeof window.board.resize !== 'function') {
        return;
    }

    window.board.resize();
    window.reapplyPersistentBoardHighlights?.();
    window.renderBoardReactions?.();

    if (window.boardReactionPickerSquare) {
        window.openBoardReactionPicker(window.boardReactionPickerSquare);
    }
};

window.scheduleBoardResizeSync = function() {
    if (!window.board || typeof window.board.resize !== 'function') {
        return;
    }

    if (window.__boardResizeSyncRafId) {
        cancelAnimationFrame(window.__boardResizeSyncRafId);
    }

    window.__boardResizeSyncRafId = requestAnimationFrame(() => {
        window.__boardResizeSyncRafId = null;
        window.syncBoardSizeWithLayout();
    });

    if (window.__boardResizeSyncTimeoutId) {
        clearTimeout(window.__boardResizeSyncTimeoutId);
    }

    window.__boardResizeSyncTimeoutId = setTimeout(() => {
        window.__boardResizeSyncTimeoutId = null;
        window.syncBoardSizeWithLayout();
    }, window.BOARD_RESIZE_SYNC_DELAY_MS);
};

window.initBoardResizeSync = function() {
    const boardArea = document.querySelector('.board-area');
    const mainColumn = document.querySelector('.game-main-column');

    if (!boardArea || !mainColumn) {
        return;
    }

    if (window.__boardResizeSyncObserver) {
        window.__boardResizeSyncObserver.disconnect();
    }

    if (typeof ResizeObserver === 'undefined') {
        window.__boardResizeSyncObserver = null;
        window.scheduleBoardResizeSync();
        return;
    }

    const observer = new ResizeObserver(() => {
        window.scheduleBoardResizeSync();
    });

    observer.observe(boardArea);
    observer.observe(mainColumn);
    window.__boardResizeSyncObserver = observer;

    const section = document.getElementById('game-section');
    if (section && !section.__boardResizeSyncTransitionBound) {
        section.addEventListener('transitionend', () => {
            window.scheduleBoardResizeSync();
        });
        section.__boardResizeSyncTransitionBound = true;
    }

    window.scheduleBoardResizeSync();
};

window.getNormalizedPieceSet = function(setName) {
    if (!setName) {
        return window.DEFAULT_PIECE_SET;
    }

    return window.LEGACY_PIECE_SET_MIGRATIONS[setName] || setName;
};

window.getStoredPieceSet = function() {
    const rawSetName = localStorage.getItem(window.PIECE_SET_STORAGE_KEY);
    const normalizedSetName = window.getNormalizedPieceSet(rawSetName || window.DEFAULT_PIECE_SET);
    const exists = Boolean(window.PIECE_SETS[normalizedSetName]);
    const safeSetName = exists ? normalizedSetName : window.DEFAULT_PIECE_SET;

    if (rawSetName !== safeSetName) {
        localStorage.setItem(window.PIECE_SET_STORAGE_KEY, safeSetName);
    }

    return safeSetName;
};

window.getCurrentPieceTheme = function() {
    const setName = window.getStoredPieceSet();
    const selectedSet = window.PIECE_SETS[setName];

    if (selectedSet && selectedSet.theme) {
        return selectedSet.theme;
    }

    return window.PIECE_SETS[window.DEFAULT_PIECE_SET].theme;
};

window.getPieceAssetPath = function(pieceType, pieceColor, pieceTheme = window.getCurrentPieceTheme()) {
    const suffix = PIECE_TO_BOARD_SUFFIX[pieceType];
    const colorCode = pieceColor === 'b' ? 'b' : 'w';
    if (!suffix || typeof pieceTheme !== 'string') return '';
    return pieceTheme.replace('{piece}', `${colorCode}${suffix}`);
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

window.isReviewInteractionLocked = function() {
    return Boolean(window.reviewMode);
};

window.getBoardInteractionColor = function() {
    if (window.isSelfTrainingMode?.() || window.isPassAndPlayStandardMode?.()) {
        return window.game?.turn?.() || null;
    }
    return window.playerColor || null;
};

window.resetTransientBoardInteractionState = function() {
    window.dragSourceSquare = null;
    window.selectedSquare = null;
    window.pendingMove = null;
    window.pendingPromotionSelection = null;
    window.removeHighlights();
    window.closeBoardReactionPicker?.();
    document.getElementById('confirm-move-box')?.classList.add('hidden');
    document.getElementById('promotion-choice-box')?.classList.add('hidden');
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
    window.reapplyPersistentBoardHighlights?.(fen);

    if (window.isMobile && window.playerColor) {
        window.attachMobileClickHandler();
    }

    window.setupBoardReactionUI();
    window.renderBoardReactions();
    window.initBoardResizeSync();
    window.scheduleBoardResizeSync();
};

window.applyPieceSet = function(setName) {
    const normalizedSetName = window.getNormalizedPieceSet(setName);
    const exists = Boolean(window.PIECE_SETS[normalizedSetName]);
    const safeSetName = exists ? normalizedSetName : window.DEFAULT_PIECE_SET;

    localStorage.setItem(window.PIECE_SET_STORAGE_KEY, safeSetName);

    if (window.board) {
        window.rebuildBoardWithCurrentState();
    }
    window.renderCapturedPieces?.();

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

    pieceSetSelect.value = window.getStoredPieceSet();

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

    window.setupBoardReactionUI();
    window.renderBoardReactions();
    window.initBoardResizeSync();
    window.scheduleBoardResizeSync();
    
    return window.board;
};

window.setupBoardReactionUI = function() {
    const boardWrapper = document.querySelector('.board-wrapper');
    const boardElement = document.getElementById('myBoard');
    if (!boardWrapper || !boardElement) return;

    if (!document.getElementById('board-reactions-layer')) {
        const layer = document.createElement('div');
        layer.id = 'board-reactions-layer';
        layer.className = 'board-reactions-layer';
        boardWrapper.appendChild(layer);
    }

    if (!document.getElementById('board-reaction-picker')) {
        const picker = document.createElement('div');
        picker.id = 'board-reaction-picker';
        picker.className = 'board-reaction-picker hidden';
        picker.setAttribute('role', 'dialog');
        picker.setAttribute('aria-label', 'Реакции на доске');
        boardWrapper.appendChild(picker);
    }

    const pickerNode = document.getElementById('board-reaction-picker');
    if (pickerNode) {
        pickerNode.innerHTML = '';
        window.BOARD_REACTIONS.forEach((emoji) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'board-reaction-option';
            button.textContent = emoji;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                if (!window.boardReactionPickerSquare) return;
                window.sendBoardReaction(window.boardReactionPickerSquare, emoji);
                window.closeBoardReactionPicker();
            });
            pickerNode.appendChild(button);
        });
    }

    if (!window.__boardReactionGlobalHandlersBound) {
        document.addEventListener('click', (event) => {
            const picker = document.getElementById('board-reaction-picker');
            if (!picker || picker.classList.contains('hidden')) return;
            if (!picker.contains(event.target)) {
                window.closeBoardReactionPicker();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                window.closeBoardReactionPicker();
            }
        });

        window.addEventListener('resize', () => {
            window.renderBoardReactions?.();
            if (window.boardReactionPickerSquare) {
                window.openBoardReactionPicker(window.boardReactionPickerSquare);
            }
        });
        window.__boardReactionGlobalHandlersBound = true;
    }

    const $board = $('#myBoard');
    $board.off(window.BOARD_REACTION_EVENTS_NS);

    const suppressPieceImageDefault = function(event) {
        const isPieceImage = event.target.closest?.('img, .piece-417db');
        if (!isPieceImage) return;
        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation();
    };

    $board.on(`dragstart${window.BOARD_REACTION_EVENTS_NS}`, 'img, .piece-417db', function(event) {
        if (!window.isMobile) return;
        suppressPieceImageDefault(event);
    });

    $board.on(`contextmenu${window.BOARD_REACTION_EVENTS_NS}`, '.square-55d63', function(event) {
        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation();
        const square = $(this).attr('data-square');
        if (!square || window.isReviewInteractionLocked()) return;
        window.boardReactionSuppressTapUntil = Date.now() + 500;
        window.openBoardReactionPicker(square);
    });

    $board.on(`contextmenu${window.BOARD_REACTION_EVENTS_NS}`, 'img, .piece-417db', function(event) {
        suppressPieceImageDefault(event);
        const square = $(this).closest('.square-55d63').attr('data-square');
        if (!square || window.isReviewInteractionLocked()) return;
        window.boardReactionSuppressTapUntil = Date.now() + 500;
        window.openBoardReactionPicker(square);
    });

    $board.on(`touchstart${window.BOARD_REACTION_EVENTS_NS}`, '.square-55d63', function(event) {
        const square = $(this).attr('data-square');
        if (!square || window.isReviewInteractionLocked()) return;

        window.boardReactionLongPressTriggered = false;
        clearTimeout(window.boardReactionLongPressTimer);
        window.boardReactionLongPressTimer = setTimeout(() => {
            window.boardReactionLongPressTriggered = true;
            window.boardReactionSuppressTapUntil = Date.now() + 500;
            window.openBoardReactionPicker(square);
        }, window.BOARD_REACTION_LONG_PRESS_MS);
    });

    const cancelLongPress = (event) => {
        const longPressTriggered = window.boardReactionLongPressTriggered;
        clearTimeout(window.boardReactionLongPressTimer);
        window.boardReactionLongPressTimer = null;

        if (longPressTriggered && event?.cancelable) {
            event.preventDefault();
        }

        window.boardReactionLongPressTriggered = false;
    };

    $board.on(
        `touchend${window.BOARD_REACTION_EVENTS_NS} touchcancel${window.BOARD_REACTION_EVENTS_NS} touchmove${window.BOARD_REACTION_EVENTS_NS}`,
        '.square-55d63',
        cancelLongPress
    );

    $board.find('img, .piece-417db').attr('draggable', 'false');
};

window.openBoardReactionPicker = function(square) {
    if (!square) return;
    if (!window.canUseBoardReactions?.()) return;

    const picker = document.getElementById('board-reaction-picker');
    const boardWrapper = document.querySelector('.board-wrapper');
    const squareNode = document.querySelector(`.square-${square}`);
    if (!picker || !boardWrapper || !squareNode) return;

    window.boardReactionPickerSquare = square;
    picker.classList.remove('hidden');
    picker.style.visibility = 'hidden';
    picker.style.left = '0px';
    picker.style.top = '0px';

    const wrapperRect = boardWrapper.getBoundingClientRect();
    const squareRect = squareNode.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();

    const preferredLeft = squareRect.left - wrapperRect.left + (squareRect.width / 2) - (pickerRect.width / 2);
    const preferredTop = squareRect.top - wrapperRect.top - pickerRect.height - 8;
    const fallbackTop = squareRect.bottom - wrapperRect.top + 8;

    const maxLeft = Math.max(8, wrapperRect.width - pickerRect.width - 8);
    const left = Math.max(8, Math.min(preferredLeft, maxLeft));
    const hasTopSpace = preferredTop >= 8;
    const topCandidate = hasTopSpace ? preferredTop : fallbackTop;
    const maxTop = Math.max(8, wrapperRect.height - pickerRect.height - 8);
    const top = Math.max(8, Math.min(topCandidate, maxTop));

    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    picker.style.visibility = 'visible';
};

window.closeBoardReactionPicker = function() {
    const picker = document.getElementById('board-reaction-picker');
    if (!picker) return;
    picker.classList.add('hidden');
    picker.style.visibility = '';
    window.boardReactionPickerSquare = null;
};

window.sendBoardReaction = function(square, emoji) {
    if (!window.pushBoardReaction) return;
    window.pushBoardReaction(square, emoji);
};

window.renderBoardReactions = function() {
    const layer = document.getElementById('board-reactions-layer');
    const boardWrapper = document.querySelector('.board-wrapper');
    if (!layer || !boardWrapper) return;

    const now = Date.now();
    const reactions = (window.activeReactions || []).filter((reaction) => Number(reaction.expiresAt) > now);
    layer.innerHTML = '';

    const wrapperRect = boardWrapper.getBoundingClientRect();
    reactions.forEach((reaction) => {
        const squareNode = document.querySelector(`.square-${reaction.square}`);
        if (!squareNode) return;

        const squareRect = squareNode.getBoundingClientRect();
        const bubble = document.createElement('div');
        bubble.className = 'board-reaction-bubble';
        bubble.textContent = reaction.emoji;
        bubble.style.left = `${squareRect.left - wrapperRect.left + squareRect.width / 2}px`;
        bubble.style.top = `${squareRect.top - wrapperRect.top + 6}px`;
        layer.appendChild(bubble);
    });
};

if (!window.__boardReactionCleanupTimerStarted) {
    window.__boardReactionCleanupTimerStarted = true;
    setInterval(() => {
        if (!window.activeReactions) return;
        const now = Date.now();
        const filtered = window.activeReactions.filter((reaction) => Number(reaction.expiresAt) > now);
        if (filtered.length !== window.activeReactions.length) {
            window.activeReactions = filtered;
            window.renderBoardReactions();
        }
    }, 1000);
}

// ==================== ДЕСКТОПНАЯ ЛОГИКА (drag-and-drop) ====================

// Проверка перед началом перетаскивания
window.handleDragStart = function(source, piece, position, orientation) {
    window.closeBoardReactionPicker?.();

    if (window.isReviewInteractionLocked()) {
        window.resetTransientBoardInteractionState();
        return false;
    }

    const interactionColor = window.getBoardInteractionColor();
    if (window.game.game_over() ||
        !interactionColor ||
        window.game.turn() !== interactionColor ||
        window.pendingMove) {
        return false;
    }
    
    const pieceColor = piece.charAt(0);
    if (pieceColor !== interactionColor) {
        return false;
    }
    
    const availableMoves = window.game.moves({ square: source, verbose: true });

    window.dragSourceSquare = source;
    window.showPossibleMoves(source, availableMoves);
    if (availableMoves.length > 0) {
        window.SoundManager?.play?.('piece_select');
    }
    
    return true;
};

// Подсветка при наведении на клетку
window.handleMouseoverSquare = function(square, piece) {
    if (window.isMobile) return;
    if (window.isReviewInteractionLocked()) return;
    const interactionColor = window.getBoardInteractionColor();
    if (!interactionColor || window.game.game_over() || window.pendingMove) return;
    
    if (window.dragSourceSquare) return;
    
    if (piece && piece.charAt(0) === interactionColor && window.game.turn() === interactionColor) {
        window.showPossibleMoves(square);
    }
};

// Убираем подсветку при уходе мыши
window.handleMouseoutSquare = function(square, piece) {
    if (window.isMobile) return;
    if (window.isReviewInteractionLocked()) {
        window.removeTemporaryHighlights();
        return;
    }
    if (!window.dragSourceSquare) {
        window.removeTemporaryHighlights();
    }
};

// Показ возможных ходов для фигуры
window.showPossibleMoves = function(square, precomputedMoves = null) {
    if (window.isReviewInteractionLocked()) return;

    window.removeTemporaryHighlights();
    window.highlightSquare(square, 'highlight-drag-source');
    
    const moves = Array.isArray(precomputedMoves)
        ? precomputedMoves
        : window.game.moves({ square: square, verbose: true });
    moves.forEach(move => {
        if (move.captured) {
            window.highlightSquare(move.to, 'highlight-capture');
        } else {
            window.highlightSquare(move.to, 'highlight-possible');
        }
    });

    return moves;
};

// Убираем временную подсветку
window.removeTemporaryHighlights = function() {
    $('#myBoard .square-55d63').removeClass('highlight-drag-source highlight-possible highlight-capture');
};

// Обработка сброса фигуры (drag-and-drop)
window.handleDrop = function(source, target) {
    if (window.isMobile) return 'snapback';
    window.closeBoardReactionPicker?.();

    if (window.isReviewInteractionLocked()) {
        window.resetTransientBoardInteractionState();
        return 'snapback';
    }

    window.removeTemporaryHighlights();
    
    const interactionColor = window.getBoardInteractionColor();
    if (window.game.game_over() || !interactionColor || window.game.turn() !== interactionColor || window.pendingMove) {
        window.dragSourceSquare = null;
        return 'snapback';
    }
    
    if (window.moveRequiresPromotion(source, target)) {
        const opened = window.openPromotionChoice(source, target);
        window.dragSourceSquare = null;
        return opened ? 'snapback' : 'snapback';
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
    const $board = $('#myBoard');
    $board.off(`click${window.BOARD_MOBILE_TAP_EVENTS_NS}`);
    $board.on(`click${window.BOARD_MOBILE_TAP_EVENTS_NS}`, '.square-55d63', function(e) {
        e.stopPropagation();
        const square = $(this).attr('data-square');
        if (square) {
            window.handleMobileClick(square);
        }
    });
};

// Мобильный клик
window.handleMobileClick = function(square) {
    if (Date.now() < window.boardReactionSuppressTapUntil) {
        return;
    }
    window.closeBoardReactionPicker?.();

    if (window.isReviewInteractionLocked()) {
        window.resetTransientBoardInteractionState();
        return;
    }

    if (window.game.game_over()) return;
    const interactionColor = window.getBoardInteractionColor();
    if (!interactionColor) return;
    if (window.game.turn() !== interactionColor) return;
    if (window.pendingMove) return;
    
    const piece = window.game.get(square);
    
    if (window.selectedSquare) {
        if (window.selectedSquare === square) {
            window.clearSelection();
            return;
        }
        
        if (window.moveRequiresPromotion(window.selectedSquare, square)) {
            window.openPromotionChoice(window.selectedSquare, square);
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
            if (piece && piece.color === interactionColor) {
                window.selectSquare(square);
            } else {
                window.clearSelection();
            }
        }
    } else {
        if (piece && piece.color === interactionColor) {
            window.selectSquare(square);
        }
    }
};

// ==================== ОБЩИЕ ФУНКЦИИ ====================

// Выделение фигуры и подсветка доступных ходов (для мобильной версии)
window.selectSquare = function(square) {
    if (window.isReviewInteractionLocked()) return;
    window.closeBoardReactionPicker?.();

    window.clearSelection();
    window.selectedSquare = square;
    window.highlightSquare(square, 'highlight-selected');

    const moves = window.game.moves({ square: square, verbose: true });
    if (moves.length > 0) {
        window.SoundManager?.play?.('piece_select');
    }

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

    window.reapplyPersistentBoardHighlights?.(fen);
};

window.getDisplayedBoardContext = function() {
    if (window.reviewMode && typeof window.buildReviewDisplayGame === 'function') {
        const targetIndex = Number.isInteger(window.reviewPlyIndex)
            ? window.reviewPlyIndex
            : (window.reviewGame?.history?.().length ?? 0);
        const { displayGame } = window.buildReviewDisplayGame(targetIndex);
        return {
            fen: displayGame.fen(),
            history: displayGame.history({ verbose: true })
        };
    }

    if (!window.game) {
        return { fen: 'start', history: [] };
    }

    return {
        fen: window.game.fen(),
        history: window.game.history({ verbose: true })
    };
};

window.reapplyPersistentBoardHighlights = function(forcedFen = null) {
    const { fen, history } = window.getDisplayedBoardContext();
    const effectiveFen = forcedFen || fen;

    window.updateCheckHighlight(effectiveFen);

    if (history.length > 0 && window.highlightLastMove) {
        window.highlightLastMove(history[history.length - 1]);
    } else {
        document.querySelectorAll('.last-move')
            .forEach(el => el.classList.remove('last-move'));
    }

    window.applyGameEndBoardEffects?.(effectiveFen);
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

window.moveRequiresPromotion = function(from, to) {
    if (!window.game) return false;
    const piece = window.game.get(from);
    if (!piece || piece.type !== 'p') return false;
    const targetRank = String(to || '').charAt(1);
    return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1');
};

window.ensurePromotionChoiceBindings = function() {
    const container = document.getElementById('promotion-choice-options');
    if (!container || container.dataset.bound === '1') return;
    container.dataset.bound = '1';
    container.querySelectorAll('[data-promotion-piece]').forEach((button) => {
        button.addEventListener('click', () => {
            const selectedPiece = button.dataset.promotionPiece;
            const pending = window.pendingPromotionSelection;
            if (!pending || !selectedPiece) return;

            const preview = window.buildMovePreview(pending.from, pending.to, selectedPiece);
            const box = document.getElementById('promotion-choice-box');
            box?.classList.add('hidden');
            window.pendingPromotionSelection = null;
            if (!preview) return;

            window.pendingMove = preview;
            window.updateBoardPosition(preview.previewFen, true);
            document.getElementById('confirm-move-box')?.classList.remove('hidden');
            window.clearSelection?.();
        });
    });
};

window.openPromotionChoice = function(from, to) {
    const box = document.getElementById('promotion-choice-box');
    const options = document.getElementById('promotion-choice-options');
    if (!box || !options) return false;

    window.ensurePromotionChoiceBindings();
    window.pendingPromotionSelection = { from, to };

    const movingPiece = window.game?.get?.(from);
    const color = movingPiece?.type === 'p'
        ? movingPiece.color
        : (window.game?.turn?.() === 'b' ? 'b' : 'w');
    options.querySelectorAll('[data-promotion-piece]').forEach((button) => {
        const piece = button.dataset.promotionPiece;
        const assetPath = window.getPieceAssetPath(piece, color);
        const pieceLabel = PROMOTION_PIECE_LABELS[piece] || 'Фигура';
        const colorLabel = color === 'w' ? 'белый' : 'чёрный';
        button.setAttribute('aria-label', `${pieceLabel} (${colorLabel})`);
        button.setAttribute('title', pieceLabel);
        button.innerHTML = assetPath
            ? `<img class="promotion-choice-piece" src="${assetPath}" alt="${pieceLabel}" loading="lazy">`
            : `<span class="promotion-choice-fallback">${pieceLabel}</span>`;
    });

    box.classList.remove('hidden');
    return true;
};

// Полная очистка подсветки
window.BOARD_SQUARE_SELECTOR = '#myBoard .square-55d63';
window.BOARD_PIECE_SELECTOR = '#myBoard .piece-417db';

window.removeHighlights = function() {
    $(window.BOARD_SQUARE_SELECTOR).removeClass('highlight-selected highlight-drag-source highlight-possible highlight-capture');
};

// Подсветка клетки
window.highlightSquare = function(square, type) {
    $(`.square-${square}`).addClass(type);
};

window.removeCheckHighlight = function() {
    $(window.BOARD_SQUARE_SELECTOR).removeClass('highlight-check');
};

window.clearGameEndBoardEffects = function() {
    $(window.BOARD_PIECE_SELECTOR).removeClass('piece-game-over-loser');
    document.querySelectorAll('#myBoard .king-game-over-marker').forEach((node) => node.remove());
};

window.appendKingMarker = function(square, emoji, markerClass) {
    if (!square || !emoji) return;
    const squareNode = document.querySelector(`#myBoard .square-${square}`);
    if (!squareNode) return;
    if (squareNode.querySelector(`.king-game-over-marker.${markerClass}`)) return;

    const marker = document.createElement('span');
    marker.className = `king-game-over-marker king-game-over-marker--animate ${markerClass}`;
    marker.textContent = emoji;
    marker.setAttribute('aria-hidden', 'true');
    squareNode.appendChild(marker);
};

window.applyGameEndBoardEffects = function(fen) {
    window.clearGameEndBoardEffects();
    if (!window.game) return;

    const summary = window.getGameOverSummary?.(window.game, window.lastGameUiSnapshot);
    if (!summary?.isFinished) return;

    if (window.reviewMode) {
        const maxPly = window.reviewGame?.history?.().length ?? window.game.history().length;
        const reviewIndex = Number.isInteger(window.reviewPlyIndex) ? window.reviewPlyIndex : maxPly;
        const isAtFinalReviewPly = Math.max(0, Math.min(reviewIndex, maxPly)) >= maxPly;
        if (!isAtFinalReviewPly) return;
    }

    const boardState = new Chess(fen || window.game.fen()).board();
    const kingSquares = { w: null, b: null };

    for (let rank = 0; rank < boardState.length; rank++) {
        for (let file = 0; file < boardState[rank].length; file++) {
            const piece = boardState[rank][file];
            if (!piece || piece.type !== 'k') continue;
            const fileChar = String.fromCharCode(97 + file);
            const rankNumber = 8 - rank;
            kingSquares[piece.color] = `${fileChar}${rankNumber}`;
        }
    }

    const applyLoserVisual = (color) => {
        const square = kingSquares[color];
        if (!square) return;
        document.querySelector(`#myBoard .square-${square} .piece-417db`)?.classList.add('piece-game-over-loser');
    };

    if (summary.termination === 'checkmate') {
        const loserSquare = kingSquares[summary.loserColor];
        if (loserSquare) {
            window.highlightSquare(loserSquare, 'highlight-check');
        }
        applyLoserVisual(summary.loserColor);
        window.appendKingMarker(loserSquare, '☠️', 'king-game-over-marker-death');
        return;
    }

    if (summary.termination === 'resign') {
        const loserSquare = kingSquares[summary.loserColor];
        applyLoserVisual(summary.loserColor);
        window.appendKingMarker(loserSquare, '🏳️', 'king-game-over-marker-resign');
        return;
    }

    if (summary.termination === 'stalemate' || summary.termination === 'draw') {
        window.appendKingMarker(kingSquares.w, '🤝', 'king-game-over-marker-draw');
        window.appendKingMarker(kingSquares.b, '🤝', 'king-game-over-marker-draw');
    }
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
