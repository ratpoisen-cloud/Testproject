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

// Обновление UI
window.updateUI = function(data) {
    if (!data) return;
    window.lastGameUiSnapshot = data;
    
    const isMyTurn = window.playerColor && (window.playerColor === window.game.turn());
    
    window.updateTurnIndicator(isMyTurn);
    window.updateOpponentHeader(data);
    window.updateMoveHistory();
    window.updateFinishedGameActions(data);
    window.updateGameModal(data);
    if (window.isBotMode && data.gameState === 'game_over') {
        window.persistFinishedBotGame?.(data);
    }
};

// Обновление индикатора хода
window.updateTurnIndicator = function(isMyTurn) {
    const turnStatus = document.getElementById('turn-status');
    const turnText = document.getElementById('turn-text');
    
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
    };

    const normalizedQuickPhrase = window.normalizeQuickPhrase?.(window.activeQuickPhrase) || null;
    const isOnlineHumanGame = Boolean(
        window.currentRoomId
        && !window.isBotMode
        && (window.playerColor === 'w' || window.playerColor === 'b')
    );
    const shouldShowCenterQuickPhrase = Boolean(
        isOnlineHumanGame
        && normalizedQuickPhrase
        && normalizedQuickPhrase.from !== window.playerColor
    );

    if (shouldShowCenterQuickPhrase) {
        clearCenterQuickPhraseTimers();
        turnStatus.className = 'turn-status opponent-turn turn-status--quick-phrase';
        turnText.innerHTML = `
            <span class="turn-status-quick-phrase-bubble" role="status" aria-live="polite">
                <span class="turn-status-quick-phrase-emoji">${normalizedQuickPhrase.emoji}</span>
                <span class="turn-status-quick-phrase-text">${normalizedQuickPhrase.text}</span>
            </span>
        `;

        const ttlMs = window.QUICK_PHRASE_TTL_MS || 5000;
        const remainingMs = Math.max(0, (normalizedQuickPhrase.createdAt + ttlMs) - Date.now());
        const outDurationMs = 180;
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
    clearCenterQuickPhraseView();
    
    if (window.game.game_over()) {
        turnStatus.className = 'turn-status opponent-turn';
        turnText.innerText = 'Игра окончена';
        return;
    }
    
    if (!window.playerColor) {
        turnStatus.className = 'turn-status opponent-turn';
        turnText.innerHTML = 'Просмотр партии';
        return;
    }
    
    if (isMyTurn) {
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

    let opponentName = 'Соперник';
    let opponentAvatar = '';
    let opponentUid = null;
    const isBotGame = isBotMode;

    if (isBotMode) {
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
    if (isViewer) {
        presenceText = 'Режим наблюдения';
        indicatorVariant = 'offline';
        isInteractivePresence = false;
    } else if (isBotGame) {
        const botPresence = window.getEffectivePresence?.('', { isBot: true, botText: 'готов к игре' })
            || { text: 'готов к игре', tone: 'neutral' };
        presenceText = botPresence.text;
        indicatorVariant = window.resolvePresenceIndicatorVariant(botPresence, { isBot: true });
        isInteractivePresence = false;
    } else if (opponentUid) {
        window.ensurePresenceForUsers?.([opponentUid]);
        const presence = window.getEffectivePresence?.(opponentUid) || { text: 'не в сети', tone: 'offline' };
        presenceText = presence.text;
        indicatorVariant = window.resolvePresenceIndicatorVariant(presence);
    } else {
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

// Обновление истории ходов
window.updateMoveHistory = function() {
    const history = window.game.history({ verbose: true });
    const moveListDiv = document.getElementById('move-list');

    if (!moveListDiv) return;

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
            cell.textContent = text;

            if (isMoveNumber) {
                cell.classList.add('move-list-cell--move-number', 'move-list-cell--dimmed');
                // Safe visual fallback: move numbers stay dimmed without relying only on CSS.
                cell.style.color = legacyDimmedColor;
            }

            if (isEmpty) {
                cell.classList.add('move-list-cell--empty');
            }

            if (Number.isInteger(plyIndex)) {
                cell.classList.add('move-list-cell--move');
                cell.dataset.plyIndex = String(plyIndex);

                if (plyIndex === activePlyIndex) {
                    cell.classList.add('move-list-cell--active');
                    activeMoveCell = cell;
                }

                cell.addEventListener('click', () => goToPlyFromHistory(plyIndex));
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

    if (history.length === 0) {
        moveListDiv.replaceChildren(fragment);
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

    const isFinishedGame = window.isGameFinished ? window.isGameFinished(data) : false;
    const isBotMode = Boolean(window.isBotMode);

    gameSection?.classList.toggle('finished-viewer-mode', isFinishedGame);

    liveTopActions?.classList.toggle('hidden', isFinishedGame);
    liveBottomActions?.classList.toggle('hidden', isFinishedGame);

    if (finishedActions) {
        finishedActions.classList.toggle('hidden', !isFinishedGame);
    }

    drawBtn?.classList.toggle('hidden', isFinishedGame || isBotMode);
    drawBtn && (drawBtn.disabled = isFinishedGame || isBotMode);
    resignBtn?.classList.toggle('hidden', isFinishedGame);
    if (takebackBtn) {
        takebackBtn.classList.toggle('hidden', isFinishedGame || isBotMode);
        takebackBtn.disabled = isFinishedGame || isBotMode;
    }
    if (isFinishedGame) {
        confirmMoveBox?.classList.add('hidden');
        takebackRequestBox?.classList.add('hidden');
        drawRequestBox?.classList.add('hidden');
    }
    shareBox?.classList.toggle('hidden', isFinishedGame || isBotMode);
};

// Обновление модального окна окончания игры
window.updateGameModal = function(data) {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    const currentState = data?.gameState || null;
    const previousState = window.lastKnownGameState;
    const isFirstStateSync = previousState === null;
    const isRealGameOverTransition =
        !isFirstStateSync &&
        previousState === 'active' &&
        currentState === 'game_over';
    const isLocalBotGameOver = Boolean(window.isBotMode && currentState === 'game_over');

    if ((isRealGameOverTransition || isLocalBotGameOver) && modal.classList.contains('hidden')) {
        const metadata = window.applyGameHeaders(window.game, data);
        modal.classList.remove('hidden');
        document.getElementById('modal-title').innerHTML = '🏆 Игра окончена';
        document.getElementById('modal-desc').innerHTML = metadata.message;
        document.getElementById('confirm-move-box').classList.add('hidden');
        window.pendingMove = null;
        window.clearSelection();
    }

    window.lastKnownGameState = currentState;
};

// Обновление бейджа игрока
window.updatePlayerBadge = function() {
    return;
};
