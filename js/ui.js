// ==================== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ====================
// Отвечает за: статус игры, индикатор хода, историю ходов, модальные окна

window.resolvePresenceIndicatorVariant = function resolvePresenceIndicatorVariant(presence, options = {}) {
    if (options.isBot) return 'bot';
    const text = String(presence?.text || '').toLowerCase();
    const tone = String(presence?.tone || '').toLowerCase();

    if (tone === 'online' || text === 'в сети') return 'online';
    if (tone === 'recently' || text === 'был недавно' || text === 'не в сети') return 'offline';
    if (tone === 'offline') return 'offline';
    if (text === 'не беспокоить') return 'dnd';
    if (
        text === 'отошёл на 5 минут'
        || text === 'вернусь через 10 минут'
        || text === 'работаю'
    ) return 'away';
    return 'offline';
};

window.applyStatusIndicatorClass = function applyStatusIndicatorClass(node, variant) {
    if (!node) return;
    const nextVariant = variant || 'offline';
    node.classList.remove(
        'status-indicator-online',
        'status-indicator-away',
        'status-indicator-dnd',
        'status-indicator-offline',
        'status-indicator-bot'
    );
    node.classList.add(`status-indicator-${nextVariant}`);
};

window.resetQuickPhraseUiState = function resetQuickPhraseUiState() {
    if (window.__centerQuickPhraseOutTimer) {
        clearTimeout(window.__centerQuickPhraseOutTimer);
        window.__centerQuickPhraseOutTimer = null;
    }
    if (window.__centerQuickPhraseClearTimer) {
        clearTimeout(window.__centerQuickPhraseClearTimer);
        window.__centerQuickPhraseClearTimer = null;
    }

    window.__centerQuickPhraseRenderState = null;
    window.activeQuickPhrase = null;

    const turnStatus = document.getElementById('turn-status');
    const gameStatusHeader = document.querySelector('.game-status-header');
    const statusActions = document.querySelector('.status-actions');

    turnStatus?.classList.remove('turn-status--quick-phrase', 'turn-status--quick-phrase-out');
    gameStatusHeader?.classList.remove('game-status-header--quick-phrase');
    statusActions?.classList.remove('status-actions--hidden');
};

// Обновление UI
window.updateUI = function(data) {
    if (!data) return;
    window.lastGameUiSnapshot = data;
    
    const currentTurn = window.game?.turn?.();
    const isMyTurn = Boolean(window.playerColor && currentTurn && window.playerColor === currentTurn);
    
    window.updateTurnIndicator(isMyTurn);
    window.updateOpponentHeader(data);
    window.updateMoveHistory();
    window.updateFinishedGameActions(data);
    window.updateGameModal(data);
    window.updatePostGameAnalysisUI?.();
    window.applyGameEndBoardEffects?.(window.game?.fen?.());
    if (window.isBotMode && data.gameState === 'game_over') {
        window.persistFinishedBotGame?.(data);
    }
};

// Обновление индикатора хода
window.updateTurnIndicator = function(isMyTurn) {
    const turnStatus = document.getElementById('turn-status');
    const turnText = document.getElementById('turn-text');
    const gameStatusHeader = document.querySelector('.game-status-header');
    const statusActions = document.querySelector('.status-actions');
    const quickPhrasesMenu = document.getElementById('quick-phrases-menu');
    
    if (!turnStatus || !turnText) return;

    const clearCenterQuickPhraseTimers = () => {
        if (window.__centerQuickPhraseOutTimer) {
            clearTimeout(window.__centerQuickPhraseOutTimer);
            window.__centerQuickPhraseOutTimer = null;
        }
        if (window.__centerQuickPhraseClearTimer) {
            clearTimeout(window.__centerQuickPhraseClearTimer);
            window.__centerQuickPhraseClearTimer = null;
        }
    };

    const clearCenterQuickPhraseView = () => {
        turnStatus.classList.remove('turn-status--quick-phrase', 'turn-status--quick-phrase-out');
        gameStatusHeader?.classList.remove('game-status-header--quick-phrase');
        statusActions?.classList.remove('status-actions--hidden');
    };

    const normalizedQuickPhrase = window.normalizeQuickPhrase?.(window.activeQuickPhrase) || null;
    const quickPhraseKey = normalizedQuickPhrase
        ? `${normalizedQuickPhrase.from}|${normalizedQuickPhrase.createdAt}|${normalizedQuickPhrase.emoji}|${normalizedQuickPhrase.text}`
        : null;
    const isOnlineHumanGame = Boolean(
        window.currentRoomId
        && !window.isLocalGameMode?.()
        && (window.playerColor === 'w' || window.playerColor === 'b')
    );
    const shouldShowCenterQuickPhrase = Boolean(
        isOnlineHumanGame
        && normalizedQuickPhrase
        && normalizedQuickPhrase.from !== window.playerColor
    );

    if (shouldShowCenterQuickPhrase) {
        clearCenterQuickPhraseTimers();
        const now = Date.now();
        if (!window.__centerQuickPhraseRenderState || window.__centerQuickPhraseRenderState.key !== quickPhraseKey) {
            window.__centerQuickPhraseRenderState = {
                key: quickPhraseKey,
                shownAt: now
            };
        }
        turnStatus.className = 'turn-status opponent-turn turn-status--quick-phrase';
        gameStatusHeader?.classList.add('game-status-header--quick-phrase');
        statusActions?.classList.add('status-actions--hidden');
        quickPhrasesMenu?.classList.add('hidden');
        turnText.innerHTML = `
            <span class="turn-status-quick-phrase-banner" role="status" aria-live="polite">
                <span class="turn-status-quick-phrase-emoji">${normalizedQuickPhrase.emoji}</span>
                <span class="turn-status-quick-phrase-text">${normalizedQuickPhrase.text}</span>
            </span>
        `;

        const ttlMs = window.QUICK_PHRASE_TTL_MS || 5000;
        const shownAt = Number(window.__centerQuickPhraseRenderState?.shownAt) || now;
        const remainingMs = Math.max(0, ttlMs - (now - shownAt));
        const outDurationMs = 260;
        const outDelay = Math.max(0, remainingMs - outDurationMs);

        window.__centerQuickPhraseOutTimer = setTimeout(() => {
            turnStatus.classList.add('turn-status--quick-phrase-out');
        }, outDelay);

        window.__centerQuickPhraseClearTimer = setTimeout(() => {
            window.activeQuickPhrase = null;
            turnStatus.classList.remove('turn-status--quick-phrase-out');
            window.updateTurnIndicator(Boolean(window.playerColor && (window.playerColor === window.game?.turn?.())));
        }, remainingMs);
        return;
    }

    clearCenterQuickPhraseTimers();
    window.__centerQuickPhraseRenderState = null;
    clearCenterQuickPhraseView();
    
    if (!window.game || typeof window.game.game_over !== 'function') {
        turnStatus.className = 'turn-status opponent-turn';
        turnText.innerText = 'Загрузка партии...';
        return;
    }

    const isFinishedGame = window.isGameFinished ? window.isGameFinished(window.lastGameUiSnapshot) : window.game.game_over();
    if (isFinishedGame) {
        const summary = window.getGameOverSummary?.(window.game, window.lastGameUiSnapshot) || {};
        const myColor = window.playerColor === 'w' || window.playerColor === 'b' ? window.playerColor : null;
        const isWinner = Boolean(myColor && summary.winnerColor === myColor);
        const isLoser = Boolean(myColor && summary.loserColor === myColor);

        let resultText = 'Игра окончена';
        if (summary.termination === 'checkmate') {
            if (isWinner) resultText = 'Победа';
            else if (isLoser) resultText = 'Мат';
            else resultText = 'Мат';
        } else if (summary.termination === 'resign') {
            if (isWinner) resultText = 'Победа';
            else if (isLoser) resultText = 'Сдача';
            else resultText = 'Сдача';
        } else if (summary.termination === 'stalemate') {
            resultText = 'Пат';
        } else if (summary.termination === 'draw') {
            resultText = 'Ничья';
        }

        turnStatus.className = 'turn-status turn-status--game-over';
        turnStatus.classList.add(`turn-status--result-${summary.termination || 'unknown'}`);
        turnText.innerText = resultText;
        return;
    }
    
    if (!window.playerColor) {
        turnStatus.className = 'turn-status opponent-turn';
        turnText.innerHTML = 'Просмотр партии';
        return;
    }
    
    if (window.isSelfTrainingMode?.() || window.isPassAndPlayStandardMode?.()) {
        const sideLabel = window.game?.turn?.() === 'b' ? 'Чёрных' : 'Белых';
        turnStatus.className = 'turn-status my-turn';
        turnText.innerHTML = `Ход ${sideLabel}`;
    } else if (isMyTurn) {
        turnStatus.className = 'turn-status my-turn';
        turnText.innerHTML = 'Ваш ход';
    } else {
        turnStatus.className = 'turn-status opponent-turn';
        turnText.innerHTML = 'Ход соперника';
    }

};

window.updateOpponentHeader = function(data) {
    const opponentNameEl = document.getElementById('game-opponent-name');
    const opponentPresenceEl = document.getElementById('game-opponent-presence');
    const opponentPresenceTextEl = document.getElementById('game-opponent-presence-text');
    const opponentPresencePopoverEl = document.getElementById('game-opponent-presence-popover');
    const opponentAvatarEl = document.getElementById('game-opponent-avatar');
    if (!opponentNameEl || !opponentPresenceEl || !opponentPresenceTextEl || !opponentAvatarEl || !opponentPresencePopoverEl) return;

    const players = data?.players || {};
    const isWhitePlayer = window.playerColor === 'w';
    const isBlackPlayer = window.playerColor === 'b';
    const isViewer = !isWhitePlayer && !isBlackPlayer;
    const isBotMode = Boolean(window.isBotMode || data?.mode === 'bot');
    const isSelfTrainingMode = Boolean(window.isSelfTrainingMode?.() || (window.isTrainingMode && window.trainingModeType === 'self'));
    const isPassAndPlayMode = Boolean(window.isPassAndPlayStandardMode?.() || (window.isPassAndPlayMode && window.passAndPlayVariant === 'standard'));

    let opponentName = 'Соперник';
    let opponentAvatar = '';
    let opponentUid = null;
    const isBotGame = isBotMode;

    if (isSelfTrainingMode) {
        opponentName = 'Сам с собой';
    } else if (isPassAndPlayMode) {
        opponentName = 'Локальная партия (Вдвоём)';
    } else if (isBotMode) {
        const levelMap = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сильный' };
        opponentName = `Бот (${levelMap[window.botLevel] || 'Средний'})`;
    } else if (isWhitePlayer) {
        opponentName = players.blackName || 'Ожидание соперника';
        opponentAvatar = players.blackPhotoURL || players.blackAvatar || '';
        opponentUid = players.black || null;
    } else if (isBlackPlayer) {
        opponentName = players.whiteName || 'Ожидание соперника';
        opponentAvatar = players.whitePhotoURL || players.whiteAvatar || '';
        opponentUid = players.white || null;
    } else {
        opponentName = `${players.whiteName || 'Белые'} vs ${players.blackName || 'Чёрные'}`;
    }

    opponentNameEl.textContent = opponentName;
    let presenceText = 'не в сети';
    let isInteractivePresence = true;
    let indicatorVariant = 'offline';
    if (window.isPassAndPlayStandardMode?.()) {
        window.__lastEnsuredOpponentUid = null;
        presenceText = 'На одном устройстве';
        indicatorVariant = 'offline';
        isInteractivePresence = false;
    } else if (isViewer) {
        window.__lastEnsuredOpponentUid = null;
        presenceText = 'Режим наблюдения';
        indicatorVariant = 'offline';
        isInteractivePresence = false;
    } else if (isSelfTrainingMode || isPassAndPlayMode) {
        window.__lastEnsuredOpponentUid = null;
        presenceText = 'Локальный режим';
        indicatorVariant = 'offline';
        isInteractivePresence = false;
    } else if (isBotGame) {
        window.__lastEnsuredOpponentUid = null;
        const botPresence = window.getEffectivePresence?.('', { isBot: true, botText: 'готов к игре' })
            || { text: 'готов к игре', tone: 'neutral' };
        presenceText = botPresence.text;
        indicatorVariant = window.resolvePresenceIndicatorVariant(botPresence, { isBot: true });
        isInteractivePresence = false;
    } else if (opponentUid) {
        if (window.__lastEnsuredOpponentUid !== opponentUid) {
            window.ensurePresenceForUsers?.([opponentUid]);
            window.__lastEnsuredOpponentUid = opponentUid;
        }
        const presence = window.getEffectivePresence?.(opponentUid) || { text: 'не в сети', tone: 'offline' };
        presenceText = presence.text;
        indicatorVariant = window.resolvePresenceIndicatorVariant(presence);
    } else {
        window.__lastEnsuredOpponentUid = null;
        presenceText = 'Ожидание соперника';
        indicatorVariant = 'offline';
        isInteractivePresence = false;
    }
    window.applyStatusIndicatorClass(opponentPresenceEl, indicatorVariant);
    opponentPresenceTextEl.textContent = presenceText;
    opponentPresenceEl.title = presenceText;
    opponentPresenceEl.setAttribute('aria-label', `Статус соперника: ${presenceText}`);
    opponentPresenceEl.disabled = !isInteractivePresence;
    opponentPresenceEl.dataset.popoverEnabled = isInteractivePresence ? '1' : '0';
    opponentPresencePopoverEl.textContent = presenceText;
    opponentPresencePopoverEl.classList.add('hidden');
    opponentPresenceEl.setAttribute('aria-expanded', 'false');

    if (opponentAvatar) {
        const avatarImage = document.createElement('img');
        avatarImage.src = opponentAvatar;
        avatarImage.alt = '';
        avatarImage.loading = 'lazy';
        opponentAvatarEl.replaceChildren(avatarImage);
    } else {
        const letter = (opponentName || '?').trim().charAt(0).toUpperCase() || '?';
        opponentAvatarEl.textContent = letter;
    }

    if (!window.__opponentPresencePopoverBound) {
        const closePopover = () => {
            opponentPresencePopoverEl.classList.add('hidden');
            opponentPresenceEl.setAttribute('aria-expanded', 'false');
        };

        const openPopover = () => {
            if (opponentPresenceEl.dataset.popoverEnabled !== '1') return;
            opponentPresencePopoverEl.classList.remove('hidden');
            opponentPresenceEl.setAttribute('aria-expanded', 'true');
        };

        opponentPresenceEl.addEventListener('click', (event) => {
            event.stopPropagation();
            if (opponentPresenceEl.dataset.popoverEnabled !== '1') return;
            const shouldOpen = opponentPresencePopoverEl.classList.contains('hidden');
            if (shouldOpen) openPopover();
            else closePopover();
        });

        document.addEventListener('click', (event) => {
            if (!opponentPresenceEl.contains(event.target) && !opponentPresencePopoverEl.contains(event.target)) {
                closePopover();
            }
        });

        window.__opponentPresencePopoverBound = true;
    }

    window.renderOpponentQuickPhrase?.(data?.quickPhrase || window.activeQuickPhrase);
};

window.renderOpponentQuickPhrase = function(quickPhraseState) {
    window.activeQuickPhrase = window.normalizeQuickPhrase?.(quickPhraseState) || null;
    window.updateTurnIndicator(Boolean(window.playerColor && (window.playerColor === window.game?.turn?.())));
};

// Legacy no-op: отдельный #game-status-text удалён из текущей вёрстки.
// Игровой статус теперь показывается через #turn-status в updateTurnIndicator.
window.updateGameStatus = function(data) {
    return data;
};

window.CAPTURED_PIECE_ORDER = ['p', 'n', 'b', 'r', 'q'];
window.CAPTURED_PIECE_START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };
window.CAPTURED_PIECE_UNICODE = {
    w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
    b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
};

window.getCapturedPiecesBySide = function(fen) {
    const normalizedFen = typeof fen === 'string' && fen.trim() ? fen : 'start';
    const positionGame = new Chess(normalizedFen);
    const board = positionGame.board();
    const currentCounts = {
        w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
        b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };

    board.forEach((rank) => {
        rank.forEach((piece) => {
            if (!piece) return;
            if (piece.type === 'k') return;
            if (!currentCounts[piece.color] || !Object.prototype.hasOwnProperty.call(currentCounts[piece.color], piece.type)) {
                return;
            }
            currentCounts[piece.color][piece.type] += 1;
        });
    });

    const missingByColor = { w: {}, b: {} };
    ['w', 'b'].forEach((color) => {
        window.CAPTURED_PIECE_ORDER.forEach((type) => {
            const startCount = window.CAPTURED_PIECE_START_COUNTS[type] || 0;
            missingByColor[color][type] = Math.max(0, startCount - (currentCounts[color][type] || 0));
        });
    });

    return {
        byWhite: missingByColor.b,
        byBlack: missingByColor.w
    };
};

window.renderCapturedPieces = function() {
    const container = document.getElementById('captured-pieces');
    if (!container) return;

    const leftSide = container.querySelector('[data-captured-by="white"]');
    const rightSide = container.querySelector('[data-captured-by="black"]');
    if (!leftSide || !rightSide) return;

    const displayedFen = window.getDisplayedBoardContext?.()?.fen || window.game?.fen?.() || 'start';
    const captured = window.getCapturedPiecesBySide(displayedFen);

    const renderSide = (sideNode, capturedMap, capturedPieceColor) => {
        sideNode.replaceChildren();
        const fragment = document.createDocumentFragment();
        let hasAny = false;

        window.CAPTURED_PIECE_ORDER.forEach((type) => {
            const count = capturedMap?.[type] || 0;
            if (count <= 0) return;
            hasAny = true;

            const item = document.createElement('span');
            item.className = 'captured-piece-item';

            const iconPath = window.getPieceAssetPath?.(type, capturedPieceColor);
            if (iconPath) {
                const icon = document.createElement('img');
                icon.className = 'captured-piece-icon';
                icon.src = iconPath;
                icon.alt = '';
                icon.loading = 'lazy';
                item.appendChild(icon);
            } else {
                const iconFallback = document.createElement('span');
                iconFallback.className = 'captured-piece-icon captured-piece-icon--fallback';
                iconFallback.textContent = window.CAPTURED_PIECE_UNICODE[capturedPieceColor]?.[type] || '';
                item.appendChild(iconFallback);
            }

            const countNode = document.createElement('span');
            countNode.className = 'captured-piece-count';
            countNode.textContent = `×${count}`;
            item.appendChild(countNode);
            fragment.appendChild(item);
        });

        if (!hasAny) {
            const empty = document.createElement('span');
            empty.className = 'captured-pieces-empty';
            empty.textContent = '—';
            fragment.appendChild(empty);
        }

        sideNode.appendChild(fragment);
    };

    renderSide(leftSide, captured.byWhite, 'b');
    renderSide(rightSide, captured.byBlack, 'w');
};

// Обновление истории ходов
window.updateMoveHistory = function() {
    const history = window.game.history({ verbose: true });
    const moveListDiv = document.getElementById('move-list');

    if (!moveListDiv) return;
    window.renderCapturedPieces?.();

    const previousHistoryLength = Number.isInteger(window.lastRenderedMoveHistoryLength)
        ? window.lastRenderedMoveHistoryLength
        : 0;
    const fragment = document.createDocumentFragment();
    const legacyDimmedColor = 'var(--text-secondary)';

    if (history.length === 0) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'move-list-cell move-list-cell--empty-state';
        emptyCell.textContent = 'Нет ходов';
        // Safe visual fallback: keep previous inline empty-state contract
        // even if corresponding CSS modifiers are missing.
        emptyCell.style.gridColumn = 'span 3';
        emptyCell.style.textAlign = 'center';
        emptyCell.style.color = legacyDimmedColor;
        fragment.appendChild(emptyCell);
    } else {
        const maxPly = history.length;
        const reviewIndex = Number.isInteger(window.reviewPlyIndex) ? window.reviewPlyIndex : maxPly;
        const activePlyIndex = window.reviewMode
            ? Math.max(0, Math.min(reviewIndex, maxPly))
            : maxPly;
        let activeMoveCell = null;

        const goToPlyFromHistory = (plyIndex) => {
            if (typeof window.goToReviewPly !== 'function') return;
            window.goToReviewPly(plyIndex);
        };

        const createCell = ({ text = '', plyIndex = null, isMoveNumber = false, isEmpty = false }) => {
            const cell = document.createElement('div');
            cell.classList.add('move-list-cell');
            const content = document.createElement('span');
            content.className = 'move-list-cell-content';
            const sanNode = document.createElement('span');
            sanNode.textContent = text;
            content.appendChild(sanNode);

            if (isMoveNumber) {
                cell.classList.add('move-list-cell--move-number', 'move-list-cell--dimmed');
                cell.textContent = text;
                // Safe visual fallback: move numbers stay dimmed without relying only on CSS.
                cell.style.color = legacyDimmedColor;
            }

            if (isEmpty) {
                cell.classList.add('move-list-cell--empty');
            }

            if (Number.isInteger(plyIndex)) {
                cell.classList.add('move-list-cell--move');
                cell.dataset.plyIndex = String(plyIndex);
                const annotation = window.getPostGameAnalysisMove?.(plyIndex);
                if (annotation?.badge) {
                    const badge = document.createElement('span');
                    badge.className = `move-annotation-badge move-annotation-badge--${annotation.classification}`;
                    badge.textContent = annotation.badge;
                    badge.title = annotation.label;
                    content.appendChild(badge);
                }

                if (plyIndex === activePlyIndex) {
                    cell.classList.add('move-list-cell--active');
                    activeMoveCell = cell;
                }

                cell.addEventListener('click', () => {
                    goToPlyFromHistory(plyIndex);
                    if (annotation) {
                        window.setActivePostGameAnalysisPly?.(plyIndex);
                    }
                });
                cell.appendChild(content);
            } else if (!isMoveNumber) {
                cell.appendChild(content);
            }

            return cell;
        };

        for (let i = 0; i < history.length; i += 2) {
            const moveNum = Math.floor(i / 2) + 1;
            const whiteMove = history[i];
            const blackMove = history[i + 1];

            fragment.appendChild(createCell({ text: `${moveNum}.`, isMoveNumber: true }));
            fragment.appendChild(createCell({
                text: whiteMove?.san || whiteMove || '',
                plyIndex: i + 1
            }));
            fragment.appendChild(createCell({
                text: blackMove?.san || blackMove || '',
                plyIndex: blackMove ? i + 2 : null,
                isEmpty: !blackMove
            }));
        }

        moveListDiv.replaceChildren(fragment);

        if (window.reviewMode && activeMoveCell) {
            const cellTop = activeMoveCell.offsetTop;
            const cellBottom = cellTop + activeMoveCell.offsetHeight;
            const viewTop = moveListDiv.scrollTop;
            const viewBottom = viewTop + moveListDiv.clientHeight;

            if (cellTop < viewTop) {
                moveListDiv.scrollTop = cellTop;
            } else if (cellBottom > viewBottom) {
                moveListDiv.scrollTop = cellBottom - moveListDiv.clientHeight;
            }
        } else {
            const hasNewRealMove = history.length > previousHistoryLength;
            if (hasNewRealMove) {
                moveListDiv.scrollTop = moveListDiv.scrollHeight;
            }
        }
    }

    window.lastRenderedMoveHistoryLength = history.length;
    window.updateReviewControlsState?.();
};

window.updateReviewControlsState = function() {
    if (!window.game) return;

    const firstBtn = document.getElementById('review-first-btn');
    const prevBtn = document.getElementById('review-prev-btn');
    const nextBtn = document.getElementById('review-next-btn');
    const lastBtn = document.getElementById('review-last-btn');
    const liveBtn = document.getElementById('review-live-btn');
    const statusNode = document.getElementById('review-status');

    const maxPly = window.game.history().length;
    const hasMoves = maxPly > 0;
    const reviewIndex = Number.isInteger(window.reviewPlyIndex) ? window.reviewPlyIndex : maxPly;
    const activePlyIndex = window.reviewMode
        ? Math.max(0, Math.min(reviewIndex, maxPly))
        : maxPly;
    const isAtStart = activePlyIndex <= 0;
    const isAtEnd = activePlyIndex >= maxPly;
    const isFinishedGame = window.game.game_over() || window.lastKnownGameState === 'game_over';

    if (statusNode) {
        if (!hasMoves) {
            statusNode.textContent = 'Нет ходов';
        } else if (!window.reviewMode || isAtEnd) {
            statusNode.textContent = 'Последняя позиция';
        } else if (isAtStart) {
            statusNode.textContent = 'Начало партии';
        } else {
            statusNode.textContent = `Просмотр: позиция после ${activePlyIndex}-го полухода`;
        }
    }

    if (firstBtn) firstBtn.disabled = !hasMoves || isAtStart;
    if (prevBtn) prevBtn.disabled = !hasMoves || isAtStart;
    if (nextBtn) nextBtn.disabled = !hasMoves || isAtEnd;
    if (lastBtn) lastBtn.disabled = !hasMoves || isAtEnd;
    if (liveBtn) {
        liveBtn.disabled = !window.reviewMode || isFinishedGame;
    }
    window.updatePostGameAnalysisUI?.();
};

window.updateFinishedGameActions = function(data) {
    const gameSection = document.getElementById('game-section');
    const liveTopActions = document.getElementById('live-game-actions-top');
    const liveBottomActions = document.getElementById('live-game-actions-bottom');
    const finishedActions = document.getElementById('finished-game-actions');
    const drawBtn = document.getElementById('draw-btn');
    const resignBtn = document.getElementById('resign-btn');
    const takebackBtn = document.getElementById('takeback-btn');
    const confirmMoveBox = document.getElementById('confirm-move-box');
    const takebackRequestBox = document.getElementById('takeback-request-box');
    const drawRequestBox = document.getElementById('draw-request-box');
    const shareBox = document.querySelector('.game-share-box');
    const quickPhrasesToggle = document.getElementById('quick-phrases-toggle');
    const quickPhrasesMenu = document.getElementById('quick-phrases-menu');
    const modalAnalysisBtn = document.getElementById('modal-analysis-btn');
    const inlineAnalysisBtn = document.getElementById('inline-analysis-btn');

    const isFinishedGame = window.isGameFinished ? window.isGameFinished(data) : false;
    const isBotMode = Boolean(window.isBotMode);
    const isSelfTrainingMode = Boolean(window.isSelfTrainingMode?.());
    const isPassAndPlayMode = Boolean(window.isPassAndPlayStandardMode?.());
    const isLocalMode = isBotMode || isSelfTrainingMode || isPassAndPlayMode;
    const shouldShowFinishedLayout = isFinishedGame && !isPassAndPlayMode;

    gameSection?.classList.toggle('finished-viewer-mode', shouldShowFinishedLayout);

    liveTopActions?.classList.toggle('hidden', shouldShowFinishedLayout);
    liveBottomActions?.classList.toggle('hidden', shouldShowFinishedLayout);

    if (finishedActions) {
        finishedActions.classList.toggle('hidden', !shouldShowFinishedLayout);
    }

    drawBtn?.classList.toggle('hidden', isFinishedGame || isLocalMode);
    drawBtn && (drawBtn.disabled = isFinishedGame || isLocalMode);
    resignBtn?.classList.toggle('hidden', isFinishedGame || isPassAndPlayMode);
    quickPhrasesToggle?.classList.toggle('hidden', isFinishedGame || isLocalMode);
    if (isFinishedGame || isLocalMode) {
        quickPhrasesMenu?.classList.add('hidden');
    }
    if (takebackBtn) {
        const shouldHideTakeback = isBotMode || (isFinishedGame && !isPassAndPlayMode);
        takebackBtn.classList.toggle('hidden', shouldHideTakeback);
        takebackBtn.disabled = shouldHideTakeback;
    }
    if (isFinishedGame) {
        confirmMoveBox?.classList.add('hidden');
        takebackRequestBox?.classList.add('hidden');
        drawRequestBox?.classList.add('hidden');
    }
    shareBox?.classList.toggle('hidden', isFinishedGame || isLocalMode);

    const supportedAnalysisMode = Boolean(window.isPostGameAnalysisSupportedMode?.());
    const showModalAnalysisEntry = isFinishedGame && supportedAnalysisMode && isSelfTrainingMode;
    const showInlineAnalysisEntry = isFinishedGame && supportedAnalysisMode && !isSelfTrainingMode;
    modalAnalysisBtn?.classList.toggle('hidden', !showModalAnalysisEntry);
    inlineAnalysisBtn?.classList.toggle('hidden', !showInlineAnalysisEntry);
};

window.updatePostGameAnalysisUI = function() {
    const analysis = window.postGameAnalysis || {};
    const modalAnalysisBtn = document.getElementById('modal-analysis-btn');
    const inlineAnalysisBtn = document.getElementById('inline-analysis-btn');
    const hint = document.getElementById('review-analysis-hint');

    const updateAnalysisLaunchButton = (button) => {
        if (!button) return;
        if (analysis.loading) {
            button.textContent = 'Анализируем...';
            button.disabled = true;
        } else {
            button.textContent = 'Анализ';
            button.disabled = !analysis.supportedMode || !window.isGameFinished?.();
        }
    };

    updateAnalysisLaunchButton(modalAnalysisBtn);
    updateAnalysisLaunchButton(inlineAnalysisBtn);

    if (!hint) return;
    const hasAnnotatedMoves = Array.isArray(analysis.annotations) && analysis.annotations.length > 0;
    const shouldShowHint = window.reviewMode && analysis.ready;
    hint.classList.toggle('hidden', !shouldShowHint);
    if (!shouldShowHint) return;
    if (analysis.loading) {
        hint.textContent = 'Анализируем завершённую партию...';
    } else if (analysis.error) {
        hint.textContent = 'Не удалось подготовить анализ.';
    } else if (!hasAnnotatedMoves) {
        hint.textContent = 'Явных ключевых ходов не найдено.';
    } else if (Number.isInteger(analysis.activePlyIndex)) {
        const active = analysis.byPly?.[analysis.activePlyIndex];
        hint.textContent = active?.detailReason || 'Выберите помеченный ход для разбора.';
    } else {
        hint.textContent = 'Выберите помеченный ход для разбора.';
    }
};

// Обновление модального окна окончания игры
window.updateGameModal = function(data) {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    const currentState = data?.gameState || null;
    const previousState = window.lastKnownGameState;
    if (currentState === 'game_over' && !modal.classList.contains('hidden')) {
        const metadata = window.applyGameHeaders(window.game, data);
        document.getElementById('modal-title').innerHTML = '🏆 Игра окончена';
        document.getElementById('modal-desc').innerHTML = metadata.message;
    }

    window.lastKnownGameState = currentState;
};

// Обновление бейджа игрока
window.updatePlayerBadge = function() {
    return;
};
