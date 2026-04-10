// ==================== ИГРОВАЯ ЛОГИКА ====================
// Отвечает за: лобби, создание/подключение к игре, ходы, синхронизацию

// Переменные состояния игры
window.game = null;
window.playerColor = null;
window.pendingMove = null;
window.selectedSquare = null;
window.currentRoomId = null;
window.pendingTakeback = null;
window.dragSourceSquare = null; // Добавляем переменную для drag-and-drop
window.lobbyCurrentScreen = 'hub';
window.lobbyShowFinished = false;
window.reviewMode = false;
window.reviewPlyIndex = null;
window.reviewGame = null;
window.lastRemotePgn = '';
window.lastKnownGameState = null;
window.lastRenderedMoveHistoryLength = 0;
window.activeReactions = [];
window.reactionRateLimitState = { cycleKey: null, count: 0 };
window.BOARD_REACTION_MAX_PER_CYCLE = 5;
window.playersExpandedResultFilter = {};
window.pendingDirectChallengeOpponent = null;
window.lobbyNotifiedDirectChallenges = new Set();
window.DIRECT_CHALLENGE_SEEN_STORAGE_KEY = 'chess_direct_challenge_seen_v1';

window.isGameFinished = function(gameData = null) {
    return Boolean(
        window.game?.game_over?.() ||
        gameData?.gameState === 'game_over' ||
        window.lastKnownGameState === 'game_over'
    );
};

window.getReactionCycleKey = function() {
    if (!window.game) return 'idle';
    return `${window.game.turn()}_${window.game.history().length}`;
};

window.canSendBoardReaction = function() {
    const cycleKey = window.getReactionCycleKey();
    if (window.reactionRateLimitState.cycleKey !== cycleKey) {
        window.reactionRateLimitState = { cycleKey, count: 0 };
    }

    if (window.reactionRateLimitState.count >= window.BOARD_REACTION_MAX_PER_CYCLE) {
        return false;
    }

    window.reactionRateLimitState.count += 1;
    return true;
};

window.normalizeBoardReactions = function(reactions) {
    const list = Array.isArray(reactions) ? reactions : [];
    const now = Date.now();
    const active = list.filter((reaction) => {
        return reaction &&
            typeof reaction.id === 'string' &&
            typeof reaction.square === 'string' &&
            typeof reaction.emoji === 'string' &&
            Number(reaction.expiresAt) > now;
    });

    const bySquare = new Map();
    active.forEach((reaction) => {
        const existing = bySquare.get(reaction.square);
        if (!existing || Number(reaction.timestamp || 0) >= Number(existing.timestamp || 0)) {
            bySquare.set(reaction.square, reaction);
        }
    });

    return Array.from(bySquare.values());
};

window.setActiveReactionsFromState = function(reactions) {
    window.activeReactions = window.normalizeBoardReactions(reactions);
    window.renderBoardReactions?.();
};

window.getActiveReactionBySquare = function(square, reactions = window.activeReactions) {
    if (!square) return null;
    const active = window.normalizeBoardReactions(reactions);
    return active.find((reaction) => reaction.square === square) || null;
};

window.pushBoardReaction = async function(square, emoji) {
    if (!window.currentRoomId || !window.playerColor) return false;

    const liveReactions = window.normalizeBoardReactions(window.activeReactions);
    const existingReaction = window.getActiveReactionBySquare(square, liveReactions);
    if (existingReaction) {
        window.notify('На этой клетке уже есть реакция', 'info', 1800);
        return false;
    }

    if (!window.canSendBoardReaction()) {
        window.notify('Лимит реакций: до 5 за текущий ходовой цикл', 'warning', 2200);
        return false;
    }

    const now = Date.now();
    const nextReaction = {
        id: `reaction_${now}_${Math.random().toString(36).slice(2, 8)}`,
        square,
        emoji,
        from: window.playerColor,
        timestamp: now,
        expiresAt: now + (window.BOARD_REACTION_TTL_MS || 7000)
    };

    const nextReactions = [...liveReactions, nextReaction].slice(-24);

    window.activeReactions = nextReactions;
    window.renderBoardReactions?.();

    try {
        // MVP: реакции пишутся в общий массив состояния партии (last-write-wins при почти одновременных апдейтах).
        // Для более строгой конкурентности позже можно вынести в RPC/отдельную таблицу.
        await window.updateGame(window.getGameRef(window.currentRoomId), { reactions: nextReactions });
        return true;
    } catch (error) {
        console.error('Ошибка отправки реакции:', error);
        window.activeReactions = liveReactions;
        window.renderBoardReactions?.();
        window.notify('Не удалось отправить реакцию', 'error', 2200);
        return false;
    }
};

window.syncReviewStateFromCurrentGame = function() {
    if (!window.game) {
        window.lastRemotePgn = '';
        window.reviewGame = null;
        window.reviewPlyIndex = null;
        return;
    }

    const pgn = window.game.pgn() || '';
    window.lastRemotePgn = pgn;

    const reviewGame = new Chess();
    if (pgn) reviewGame.load_pgn(pgn);

    window.reviewGame = reviewGame;

    if (window.reviewMode) {
        const maxPly = reviewGame.history().length;
        const currentIndex = Number.isInteger(window.reviewPlyIndex) ? window.reviewPlyIndex : maxPly;
        window.reviewPlyIndex = Math.max(0, Math.min(currentIndex, maxPly));
    } else {
        window.reviewPlyIndex = null;
    }
};

window.buildReviewDisplayGame = function(index) {
    if (!window.reviewGame) {
        window.syncReviewStateFromCurrentGame();
    }

    const sourceReviewGame = window.reviewGame || new Chess();
    const historySan = sourceReviewGame.history();
    const maxPly = historySan.length;
    const safeIndex = Math.max(0, Math.min(Number.isInteger(index) ? index : maxPly, maxPly));

    const displayGame = new Chess();
    for (let i = 0; i < safeIndex; i++) {
        displayGame.move(historySan[i]);
    }

    return { displayGame, safeIndex, maxPly };
};

window.enterReviewMode = function(startIndex) {
    if (!window.game) return;

    window.resetTransientBoardInteractionState?.();
    window.reviewMode = true;
    window.syncReviewStateFromCurrentGame();

    const maxPly = window.reviewGame ? window.reviewGame.history().length : 0;
    const targetIndex = Number.isInteger(startIndex) ? startIndex : maxPly;
    window.goToReviewPly(targetIndex);
};

window.exitReviewMode = function() {
    window.resetTransientBoardInteractionState?.();
    window.reviewMode = false;
    window.reviewPlyIndex = null;
    window.reviewGame = null;

    if (!window.game) return;

    window.updateBoardPosition(window.game.fen(), true);
    const history = window.game.history({ verbose: true });
    if (history.length > 0 && window.highlightLastMove) {
        window.highlightLastMove(history[history.length - 1]);
    }
    window.updateMoveHistory?.();
};

window.goToReviewPly = function(index) {
    if (!window.reviewMode) {
        window.enterReviewMode(index);
        return;
    }

    const { displayGame, safeIndex } = window.buildReviewDisplayGame(index);

    window.reviewPlyIndex = safeIndex;
    window.removeHighlights?.();
    window.updateBoardPosition(displayGame.fen(), true);

    const reviewHistory = displayGame.history({ verbose: true });
    if (reviewHistory.length > 0 && window.highlightLastMove) {
        window.highlightLastMove(reviewHistory[reviewHistory.length - 1]);
    }
    window.updateMoveHistory?.();
};

window.stepReview = function(delta) {
    const step = Number.isInteger(delta) ? delta : 0;
    if (!window.reviewMode) {
        window.enterReviewMode();
    }

    const currentIndex = Number.isInteger(window.reviewPlyIndex) ? window.reviewPlyIndex : 0;
    window.goToReviewPly(currentIndex + step);
};

window.getFinishedGameResultLabel = function(gameData) {
    if (!gameData || gameData.gameState !== 'game_over') return '';

    const normalize = (value) => String(value || '').toLowerCase();
    const message = normalize(gameData.message);
    const pgn = String(gameData.pgn || '');
    const resign = gameData.resign;

    if (resign === 'w') return 'Победили чёрные';
    if (resign === 'b') return 'Победили белые';

    if (message.includes('ничья')) return 'Ничья';
    if (message.includes('бел') && message.includes('побед')) return 'Победили белые';
    if ((message.includes('черн') || message.includes('чёрн')) && message.includes('побед')) return 'Победили чёрные';

    if (/\b1-0\b/.test(pgn)) return 'Победили белые';
    if (/\b0-1\b/.test(pgn)) return 'Победили чёрные';
    if (/\b1\/2-1\/2\b/.test(pgn)) return 'Ничья';

    return 'Результат завершён';
};

function resolveFinishedResultCode(gameData) {
    const pgn = String(gameData?.pgn || '');
    if (/\b1-0\b/.test(pgn)) return '1-0';
    if (/\b0-1\b/.test(pgn)) return '0-1';
    if (/\b1\/2-1\/2\b/.test(pgn)) return '1/2-1/2';

    const replayGame = new Chess();
    if (pgn) {
        try {
            replayGame.load_pgn(pgn);
        } catch (error) {
            console.warn('Не удалось загрузить PGN для результата:', error);
        }
    }

    return window.resolveGameResult?.(replayGame, gameData) || '*';
}

window.getFinishedGamePerspective = function(gameData, userId) {
    const result = resolveFinishedResultCode(gameData);
    const players = gameData?.players || {};
    const myColor = players.white === userId ? 'white' : (players.black === userId ? 'black' : null);

    if (result === '1/2-1/2') {
        return { key: 'draws', label: 'Ничья', className: 'result-draw' };
    }

    const isWhiteWin = result === '1-0';
    const isBlackWin = result === '0-1';
    const isWin = (isWhiteWin && myColor === 'white') || (isBlackWin && myColor === 'black');
    const isLoss = (isWhiteWin && myColor === 'black') || (isBlackWin && myColor === 'white');

    if (isWin) return { key: 'wins', label: 'Вы победили', className: 'result-win' };
    if (isLoss) return { key: 'losses', label: 'Вы проиграли', className: 'result-loss' };
    return { key: 'draws', label: window.getFinishedGameResultLabel(gameData), className: 'result-draw' };
};

window.getRequestedJoinColor = function() {
    const colorParam = new URLSearchParams(window.location.search).get('color');
    if (colorParam === 'w' || colorParam === 'b') return colorParam;
    if (colorParam === 'random') return Math.random() < 0.5 ? 'w' : 'b';
    return null;
};

window.applyRemotePgnUpdate = function(pgn) {
    if (!window.game || !pgn || pgn === window.game.pgn()) return false;
    try {
        window.game.load_pgn(pgn);
    } catch (error) {
        console.error('Ошибка синхронизации PGN:', error);
        window.notify('Не удалось синхронизировать партию. Обновите страницу.', 'error', 3200);
        return false;
    }
    window.syncReviewStateFromCurrentGame();

    window.pendingMove = null;
    window.dragSourceSquare = null;
    document.getElementById('confirm-move-box').classList.add('hidden');
    window.removeHighlights?.();

    if (window.reviewMode) {
        window.goToReviewPly(window.reviewPlyIndex);
    } else {
        window.updateBoardPosition(window.game.fen(), true);
        const history = window.game.history({ verbose: true });
        if (history.length > 0 && window.highlightLastMove) {
            window.highlightLastMove(history[history.length - 1]);
        }
    }

    return true;
};

// Проверка доступа: при текущих RLS игра доступна только авторизованным пользователям
window.requireAuthForGame = async function() {
    if (window.currentUser) return window.currentUser;

    let user = null;
    if (window.supabaseClient?.auth?.getUser) {
        const { data } = await window.supabaseClient.auth.getUser();
        user = data?.user ? {
            ...data.user,
            uid: data.user.id,
            displayName: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Игрок',
            photoURL: data.user.user_metadata?.avatar_url || null
        } : null;
    }

    if (!user) {
        window.notify('Чтобы играть онлайн, сначала войдите через Google или Email.', 'warning', 3200);
        return null;
    }

    return user;
};

// Лобби
function getLobbyNodes() {
    return {
        lobbySection: document.getElementById('lobby-section'),
        gameSection: document.getElementById('game-section'),
        hubView: document.getElementById('lobby-view-hub'),
        gamesView: document.getElementById('lobby-view-games'),
        playersView: document.getElementById('lobby-view-players'),
        hubCreateBtn: document.getElementById('hub-create-game'),
        hubOpenGamesBtn: document.getElementById('hub-open-games'),
        hubOpenPlayersBtn: document.getElementById('hub-open-players'),
        createGameBtn: document.getElementById('create-game-btn'),
        createGameModal: document.getElementById('create-game-modal'),
        createGameModalTitle: document.getElementById('create-game-modal-title'),
        createGameModalDesc: document.getElementById('create-game-modal-desc'),
        createGameCancelBtn: document.getElementById('create-game-modal-cancel'),
        colorButtons: document.querySelectorAll('[data-create-color]'),
        backButtons: document.querySelectorAll('[data-lobby-back]'),
        finishedGamesList: document.getElementById('finished-games-list'),
        toggleFinishedGamesBtn: document.getElementById('toggle-finished-games-btn')
    };
}

window.setLobbyScreen = function(screen) {
    const nodes = getLobbyNodes();
    const safeScreen = ['hub', 'games', 'players'].includes(screen) ? screen : 'hub';
    window.lobbyCurrentScreen = safeScreen;

    nodes.hubView?.classList.toggle('hidden', safeScreen !== 'hub');
    nodes.gamesView?.classList.toggle('hidden', safeScreen !== 'games');
    nodes.playersView?.classList.toggle('hidden', safeScreen !== 'players');

    return safeScreen;
};

function closeCreateGameModal(modal) {
    modal?.classList.add('hidden');
    window.pendingDirectChallengeOpponent = null;
    const nodes = getLobbyNodes();
    if (nodes.createGameModalTitle) {
        nodes.createGameModalTitle.textContent = 'Выберите сторону';
    }
    if (nodes.createGameModalDesc) {
        nodes.createGameModalDesc.textContent = 'За кого хотите играть в новой партии?';
    }
}

function syncFinishedGamesVisibility(toggleBtn, finishedList) {
    if (!toggleBtn || !finishedList) return;
    finishedList.classList.toggle('hidden', !window.lobbyShowFinished);
    toggleBtn.textContent = window.lobbyShowFinished ? 'Скрыть завершённые' : 'Показать завершённые';
}

async function openCreateGameModal(nodes) {
    const user = await window.requireAuthForGame();
    if (!user) return;
    window.pendingDirectChallengeOpponent = null;
    if (nodes.createGameModalTitle) {
        nodes.createGameModalTitle.textContent = 'Выберите сторону';
    }
    if (nodes.createGameModalDesc) {
        nodes.createGameModalDesc.textContent = 'За кого хотите играть в новой партии?';
    }
    nodes.createGameModal?.classList.remove('hidden');
}

function openDirectChallengeModal(nodes, opponent) {
    if (!opponent?.uid) return;
    window.pendingDirectChallengeOpponent = opponent;
    if (nodes.createGameModalTitle) {
        nodes.createGameModalTitle.textContent = 'Новая партия с игроком';
    }
    if (nodes.createGameModalDesc) {
        nodes.createGameModalDesc.textContent = `За кого хотите играть против ${opponent.name || 'соперника'}?`;
    }
    nodes.createGameModal?.classList.remove('hidden');
}

function resolveDirectChallengeColors(colorChoice) {
    if (colorChoice === 'w') return { creatorColor: 'white', opponentColor: 'black' };
    if (colorChoice === 'b') return { creatorColor: 'black', opponentColor: 'white' };
    return Math.random() < 0.5
        ? { creatorColor: 'white', opponentColor: 'black' }
        : { creatorColor: 'black', opponentColor: 'white' };
}

async function createDirectChallengeGame({ creator, opponent, colorChoice }) {
    const roomId = window.generateRoomId();
    const now = Date.now();
    const { creatorColor, opponentColor } = resolveDirectChallengeColors(colorChoice);
    const creatorIsWhite = creatorColor === 'white';
    const creatorName = window.getUserName(creator);
    const creatorPhoto = creator?.photoURL || creator?.user_metadata?.avatar_url || '';

    const players = {
        white: creatorIsWhite ? creator.uid : opponent.uid,
        whiteName: creatorIsWhite ? creatorName : (opponent.name || 'Игрок'),
        black: creatorIsWhite ? opponent.uid : creator.uid,
        blackName: creatorIsWhite ? (opponent.name || 'Игрок') : creatorName,
        whitePhotoURL: creatorIsWhite ? creatorPhoto : (opponent.avatarUrl || ''),
        blackPhotoURL: creatorIsWhite ? (opponent.avatarUrl || '') : creatorPhoto,
        invite: {
            type: 'direct_challenge',
            createdByUid: creator.uid,
            createdByName: creatorName,
            targetUid: opponent.uid,
            targetName: opponent.name || 'Игрок',
            createdAt: now
        }
    };

    await window.set(window.getGameRef(roomId), {
        players,
        pgn: new Chess().pgn(),
        fen: 'start',
        gameState: 'active',
        createdAt: now,
        lastMoveTime: now
    });

    return roomId;
}

function buildLobbyEmptyState() {
    return {
        activeGames: `
            <div class="empty-lobby">
                <p class="empty-lobby-title">Пока здесь пусто</p>
                <p class="empty-lobby-text">Активных партий нет. Создайте новую, чтобы начать.</p>
                <button class="btn btn-primary empty-lobby-cta" type="button" data-empty-action="create-game">Создать новую игру</button>
            </div>
        `,
        finishedGames: '<div class="empty-lobby">Завершённых партий пока нет</div>',
        players: '<div class="empty-lobby">Нет соперников<br><small>Сыграйте первую партию</small></div>'
    };
}

function sortLobbyGames(games) {
    return Object.entries(games)
        .filter(([, gameData]) => gameData && typeof gameData === 'object')
        .sort((a, b) => {
        const aData = a[1];
        const bData = b[1];
        const aOver = aData.gameState === 'game_over';
        const bOver = bData.gameState === 'game_over';

        if (aOver === bOver) {
            const aTime = aData.lastMoveTime || aData.createdAt || 0;
            const bTime = bData.lastMoveTime || bData.createdAt || 0;
            return bTime - aTime;
        }

        return aOver ? 1 : -1;
    });
}

function getGameMoveCount(gameData) {
    if (!gameData) return 0;
    if (Number.isFinite(gameData?.lastMove)) return 1;
    if (Number.isFinite(gameData?.turn)) return 1;

    const pgn = String(gameData?.pgn || '').trim();
    if (!pgn) return 0;

    try {
        const tempGame = new Chess();
        tempGame.load_pgn(pgn);
        return tempGame.history().length;
    } catch (error) {
        console.warn('Не удалось распарсить PGN при определении старта игры:', error);
        return 0;
    }
}

function isGameStarted(gameData) {
    return getGameMoveCount(gameData) > 0;
}

function resolveTurnColorCode(gameData) {
    const turn = gameData?.turn;
    if (turn === 'w' || turn === 'b') return turn;
    if (turn === 'white') return 'w';
    if (turn === 'black') return 'b';

    const pgn = String(gameData?.pgn || '').trim();
    if (!pgn) return null;

    try {
        const tempGame = new Chess();
        tempGame.load_pgn(pgn);
        return tempGame.turn();
    } catch (error) {
        console.warn('Не удалось распарсить PGN при определении очереди хода в лобби:', error);
        return null;
    }
}

function getSeenDirectChallengeIds() {
    try {
        const raw = localStorage.getItem(window.DIRECT_CHALLENGE_SEEN_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id) => typeof id === 'string'));
    } catch (error) {
        console.warn('Не удалось восстановить seen direct challenges из localStorage:', error);
        return new Set();
    }
}

function persistSeenDirectChallengeIds(idsSet) {
    try {
        const compact = Array.from(idsSet).slice(-300);
        localStorage.setItem(window.DIRECT_CHALLENGE_SEEN_STORAGE_KEY, JSON.stringify(compact));
    } catch (error) {
        console.warn('Не удалось сохранить seen direct challenges в localStorage:', error);
    }
}

function buildLobbyGameCardData(id, data, userId) {
    const players = data.players;
    if (!players || typeof players !== 'object') return null;
    if (players.white !== userId && players.black !== userId) return null;

    const isOver = data.gameState === 'game_over';
    const myColor = players.white === userId ? 'white' : 'black';
    const myColorCode = myColor === 'white' ? 'w' : 'b';
    const opponentUid = myColor === 'white' ? players.black : players.white;
    const isWaitingForOpponent = !isOver && !opponentUid;
    const currentTurnCode = resolveTurnColorCode(data);
    const isMyTurn = !isOver && !isWaitingForOpponent && currentTurnCode === myColorCode;
    const opponent = myColor === 'white' ? (players.blackName || 'Ожидание...') : (players.whiteName || 'Ожидание...');
    const opponentAvatar = myColor === 'white'
        ? (players.blackPhotoURL || players.blackAvatar || '')
        : (players.whitePhotoURL || players.whiteAvatar || '');
    const resultState = isOver ? window.getFinishedGamePerspective(data, userId) : null;
    const invite = players.invite && players.invite.type === 'direct_challenge' ? players.invite : null;
    const isDirectInvite = Boolean(invite);
    const hasStarted = isGameStarted(data);
    const showInviteStatus = isDirectInvite && !isOver && !hasStarted && isWaitingForOpponent;
    const statusText = isOver
        ? resultState.label
        : (isWaitingForOpponent
            ? 'Ожидание'
            : (showInviteStatus
                ? (invite.targetUid === userId ? 'Приглашение' : 'Приглашение отправлено')
                : ''));
    const stateClass = isOver ? 'finished' : (isWaitingForOpponent ? 'waiting' : 'active');

    return {
        id,
        isOver,
        isWaitingForOpponent,
        isMyTurn,
        stateClass,
        myColor,
        opponent,
        opponentAvatar,
        statusText,
        resultClass: resultState?.className || '',
        turnLabel: !isOver && !isWaitingForOpponent ? (isMyTurn ? 'Ваш ход' : 'Ход соперника') : '',
        turnClass: isMyTurn ? 'my-turn' : 'opponent-turn',
        canDeleteFromLobby: isOver || isWaitingForOpponent,
        timeAgo: window.formatTimeAgo(data.lastMoveTime || data.createdAt || 0)
    };
}

function getAvatarInitial(name) {
    const safeName = (name || 'Игрок').trim() || 'Игрок';
    return safeName.charAt(0).toUpperCase();
}

window.handleAvatarImageError = function(img) {
    const shell = img?.closest?.('.avatar-shell');
    if (!shell) return;
    const fallback = document.createElement('span');
    fallback.className = 'avatar-shell avatar-fallback';
    fallback.textContent = img.dataset.initial || 'И';
    shell.replaceWith(fallback);
};

function getAvatarMarkup(name, avatarUrl) {
    const safeName = (name || 'Игрок').trim() || 'Игрок';
    const initial = getAvatarInitial(safeName);
    if (avatarUrl) {
        return `<span class="avatar-shell"><img class="avatar-img" src="${avatarUrl}" data-initial="${initial}" alt="Аватар ${safeName}" loading="lazy"></span>`;
    }
    return `<span class="avatar-shell avatar-fallback">${initial}</span>`;
}

function bindAvatarFallbackHandlers(rootNode) {
    if (!rootNode) return;
    rootNode.querySelectorAll('.avatar-img').forEach((img) => {
        if (img.dataset.fallbackBound === '1') return;
        img.dataset.fallbackBound = '1';
        img.addEventListener('error', () => window.handleAvatarImageError(img), { once: true });
    });
}

function createLobbyGameElement(cardData, userId) {
    const item = document.createElement('div');
    item.className = `game-item ${cardData.stateClass} ${cardData.resultClass || ''}`.trim();
    item.innerHTML = `
        <div class="game-accent" aria-hidden="true"></div>
        <div class="game-info">
            <div class="game-title-row">
                <div class="game-opponent-wrap">
                    ${getAvatarMarkup(cardData.opponent, cardData.opponentAvatar)}
                    <p class="game-opponent">${cardData.opponent}</p>
                </div>
                ${cardData.statusText ? `<span class="game-status-pill ${cardData.stateClass} ${cardData.resultClass}">${cardData.statusText}</span>` : ''}
            </div>
            <div class="game-meta">
                ${cardData.turnLabel ? `<span class="game-turn-pill ${cardData.turnClass}">${cardData.turnLabel}</span>` : ''}
                <span class="game-side">Вы ${cardData.myColor === 'white' ? 'белыми' : 'чёрными'}</span>
                <span class="game-dot" aria-hidden="true">•</span>
                <span class="game-time">${cardData.timeAgo}</span>
            </div>
        </div>
        <div class="game-actions">
            <button class="btn btn-sm play-btn">Играть</button>
            <button class="btn btn-sm delete-btn ${cardData.canDeleteFromLobby ? '' : 'hidden'}" data-game-id="${cardData.id}">Удалить</button>
        </div>
    `;

    item.querySelector('.play-btn').onclick = (event) => {
        event.stopPropagation();
        location.href = `${location.origin}${location.pathname}?room=${cardData.id}`;
    };

    const deleteBtn = item.querySelector('.delete-btn');
    if (deleteBtn && cardData.canDeleteFromLobby) {
        deleteBtn.onclick = (event) => {
            event.stopPropagation();
            window.deleteGame(cardData.id, userId);
        };
    }

    bindAvatarFallbackHandlers(item);
    return item;
}

function resetLobbyContainers(gamesList, finishedGamesList, playersList) {
    gamesList.innerHTML = '';
    if (finishedGamesList) finishedGamesList.innerHTML = '';
    playersList.innerHTML = '';
}

function bindLobbyEmptyStateActions(container, createGameBtn) {
    const emptyActionBtn = container.querySelector('[data-empty-action="create-game"]');
    if (!emptyActionBtn || !createGameBtn) return;
    emptyActionBtn.onclick = () => createGameBtn.click();
}

window.initLobby = function() {
    const nodes = getLobbyNodes();
    const isAuthorized = Boolean(window.currentUser);
    if (window.setAppAuthView) {
        window.setAppAuthView(isAuthorized);
    } else {
        nodes.lobbySection?.classList.toggle('hidden', !isAuthorized);
    }
    nodes.gameSection?.classList.add('hidden');

    nodes.hubCreateBtn.onclick = () => openCreateGameModal(nodes);
    nodes.hubOpenGamesBtn.onclick = () => window.setLobbyScreen('games');
    nodes.hubOpenPlayersBtn.onclick = () => window.setLobbyScreen('players');
    nodes.backButtons.forEach((button) => {
        button.onclick = () => window.setLobbyScreen('hub');
    });

    nodes.createGameBtn.onclick = () => openCreateGameModal(nodes);

    nodes.colorButtons.forEach((btn) => {
        btn.onclick = async () => {
            const user = await window.requireAuthForGame();
            if (!user) return;
            const color = btn.dataset.createColor;
            const directOpponent = window.pendingDirectChallengeOpponent;
            closeCreateGameModal(nodes.createGameModal);
            if (directOpponent?.uid) {
                try {
                    const roomId = await createDirectChallengeGame({
                        creator: user,
                        opponent: directOpponent,
                        colorChoice: color
                    });
                    window.notify(`Приглашение отправлено игроку ${directOpponent.name || 'Игрок'}`, 'success', 2600);
                    location.href = location.origin + location.pathname + `?room=${roomId}`;
                } catch (error) {
                    console.error('Ошибка создания адресной партии:', error);
                    window.notify('Не удалось создать адресную партию', 'error', 3000);
                }
                return;
            }

            const id = window.generateRoomId();
            location.href = location.origin + location.pathname + `?room=${id}&color=${encodeURIComponent(color)}`;
        };
    });

    nodes.createGameCancelBtn.onclick = () => closeCreateGameModal(nodes.createGameModal);
    nodes.createGameModal.onclick = (event) => {
        if (event.target === nodes.createGameModal) closeCreateGameModal(nodes.createGameModal);
    };
    window.lobbyShowFinished = false;
    syncFinishedGamesVisibility(nodes.toggleFinishedGamesBtn, nodes.finishedGamesList);

    if (nodes.toggleFinishedGamesBtn) {
        nodes.toggleFinishedGamesBtn.onclick = () => {
            window.lobbyShowFinished = !window.lobbyShowFinished;
            syncFinishedGamesVisibility(nodes.toggleFinishedGamesBtn, nodes.finishedGamesList);
        };
    }

    window.setLobbyScreen('hub');
};

// Загрузка игр в лобби
window.loadLobby = function(user) {
    window.setAppAuthView?.(true);
    window.lobbyNotifiedDirectChallenges = getSeenDirectChallengeIds();
    if (typeof window.__lobbyWatchUnsubscribe === 'function') {
        window.__lobbyWatchUnsubscribe();
        window.__lobbyWatchUnsubscribe = null;
    }

    const nodes = getLobbyNodes();
    const gamesList = document.getElementById('games-list');
    const finishedGamesList = nodes.finishedGamesList;
    const playersList = document.getElementById('players-list');
    window.__lobbyWatchUnsubscribe = window.watchGames((snap) => {
        resetLobbyContainers(gamesList, finishedGamesList, playersList);
        const games = snap.val();
        if (!games) {
            const empty = buildLobbyEmptyState();
            gamesList.innerHTML = empty.activeGames;
            bindLobbyEmptyStateActions(gamesList, nodes.createGameBtn);
            if (finishedGamesList) finishedGamesList.innerHTML = empty.finishedGames;
            playersList.innerHTML = empty.players;
            return;
        }

        const sortedGames = sortLobbyGames(games);
        let hasActiveGames = false;
        let hasFinishedGames = false;

        sortedGames.forEach(([id, data]) => {
            const cardData = buildLobbyGameCardData(id, data, user.uid);
            if (!cardData) return;

            const invite = data?.players?.invite;
            const hasStarted = isGameStarted(data);
            if (
                invite?.type === 'direct_challenge' &&
                invite.targetUid === user.uid &&
                invite.createdByUid !== user.uid &&
                !hasStarted &&
                !window.lobbyNotifiedDirectChallenges.has(id)
            ) {
                window.lobbyNotifiedDirectChallenges.add(id);
                persistSeenDirectChallengeIds(window.lobbyNotifiedDirectChallenges);
                window.notify(`${invite.createdByName || 'Игрок'} приглашает вас в новую партию`, 'info', 4200);
            }

            const cardNode = createLobbyGameElement(cardData, user.uid);
            if (cardData.isOver) {
                hasFinishedGames = true;
                finishedGamesList?.appendChild(cardNode);
            } else {
                hasActiveGames = true;
                gamesList.appendChild(cardNode);
            }
        });

        if (!hasActiveGames) {
            gamesList.innerHTML = buildLobbyEmptyState().activeGames;
            bindLobbyEmptyStateActions(gamesList, nodes.createGameBtn);
        }
        if (!hasFinishedGames && finishedGamesList) {
            finishedGamesList.innerHTML = buildLobbyEmptyState().finishedGames;
        }

        syncFinishedGamesVisibility(nodes.toggleFinishedGamesBtn, finishedGamesList);

        const playersAggregate = window.buildPlayersAggregate(sortedGames, user.uid);
        window.renderPlayersLobby(playersList, playersAggregate);
    });
};

window.buildPlayersAggregate = function(sortedGames, userId) {
    const opponentsMap = new Map();

    sortedGames.forEach(([gameId, data]) => {
        const players = data.players;
        if (!players) return;

        const isUserWhite = players.white === userId;
        const isUserBlack = players.black === userId;
        if (!isUserWhite && !isUserBlack) return;

        const opponentUid = isUserWhite ? players.black : players.white;
        if (!opponentUid) return;

        const opponentNameRaw = isUserWhite ? players.blackName : players.whiteName;
        const opponentName = opponentNameRaw || 'Игрок';
        const opponentAvatar = isUserWhite
            ? (players.blackPhotoURL || players.blackAvatar || '')
            : (players.whitePhotoURL || players.whiteAvatar || '');
        const isFinished = data.gameState === 'game_over';
        const lastMoveTime = data.lastMoveTime || data.createdAt || 0;
        if (!opponentsMap.has(opponentUid)) {
            opponentsMap.set(opponentUid, {
                uid: opponentUid,
                name: opponentName,
                avatarUrl: opponentAvatar,
                wins: 0,
                losses: 0,
                draws: 0,
                lastMoveTime: 0,
                finishedGames: { wins: [], losses: [], draws: [] }
            });
        }

        const opponentCard = opponentsMap.get(opponentUid);
        if ((!opponentCard.avatarUrl || !opponentCard.avatarUrl.trim()) && opponentAvatar) {
            opponentCard.avatarUrl = opponentAvatar;
        }
        if ((opponentCard.name === 'Игрок' || !opponentCard.name) && opponentNameRaw) {
            opponentCard.name = opponentNameRaw;
        }
        opponentCard.lastMoveTime = Math.max(opponentCard.lastMoveTime, lastMoveTime);

        if (isFinished) {
            const resultState = window.getFinishedGamePerspective(data, userId);
            if (resultState.key === 'wins') opponentCard.wins += 1;
            if (resultState.key === 'losses') opponentCard.losses += 1;
            if (resultState.key === 'draws') opponentCard.draws += 1;
            opponentCard.finishedGames[resultState.key].push({ id: gameId, data });
        }
    });

    return Array.from(opponentsMap.values()).sort((a, b) => b.lastMoveTime - a.lastMoveTime);
};

window.renderPlayersLobby = function(container, players) {
    container.innerHTML = '';

    if (!players.length) {
        container.innerHTML = '<div class="empty-lobby">Нет соперников<br><small>Завершите или начните партию с игроком</small></div>';
        return;
    }

    players.forEach((player) => {
        const selectedFilter = window.playersExpandedResultFilter?.[player.uid] || '';
        const selectedGames = selectedFilter ? (player.finishedGames?.[selectedFilter] || []) : [];
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        playerItem.innerHTML = `
            <div class="player-item-header">
                <div class="player-info">
                    <div class="player-name-row">${getAvatarMarkup(player.name, player.avatarUrl)} <b>${player.name}</b></div>
                    <div class="player-stats">
                        <button class="player-stat-pill player-stat-pill-win ${selectedFilter === 'wins' ? 'is-active' : ''}" type="button" data-result-filter="wins">Выиграно: ${player.wins}</button>
                        <button class="player-stat-pill player-stat-pill-loss ${selectedFilter === 'losses' ? 'is-active' : ''}" type="button" data-result-filter="losses">Проиграно: ${player.losses}</button>
                        <button class="player-stat-pill player-stat-pill-draw ${selectedFilter === 'draws' ? 'is-active' : ''}" type="button" data-result-filter="draws">Ничьи: ${player.draws}</button>
                    </div>
                </div>
                <div class="game-actions">
                    <button class="btn btn-sm play-btn player-play-btn">Играть</button>
                </div>
            </div>
            ${selectedFilter ? `
                <div class="player-finished-list">
                    ${selectedGames.length ? '' : '<div class="empty-lobby">Подходящих завершённых партий пока нет</div>'}
                </div>
            ` : ''}
        `;

        const playBtn = playerItem.querySelector('.player-play-btn');
        playBtn.onclick = async (event) => {
            event.stopPropagation();
            const user = await window.requireAuthForGame();
            if (!user) return;
            openDirectChallengeModal(getLobbyNodes(), player);
        };

        playerItem.querySelectorAll('[data-result-filter]').forEach((filterBtn) => {
            filterBtn.onclick = (event) => {
                event.stopPropagation();
                const nextFilter = filterBtn.dataset.resultFilter;
                window.playersExpandedResultFilter = window.playersExpandedResultFilter || {};
                window.playersExpandedResultFilter[player.uid] = selectedFilter === nextFilter ? '' : nextFilter;
                window.renderPlayersLobby(container, players);
            };
        });

        if (selectedFilter && selectedGames.length) {
            const listNode = playerItem.querySelector('.player-finished-list');
            selectedGames
                .slice()
                .sort((a, b) => (b.data.lastMoveTime || b.data.createdAt || 0) - (a.data.lastMoveTime || a.data.createdAt || 0))
                .forEach((gameEntry) => {
                    const cardData = buildLobbyGameCardData(gameEntry.id, gameEntry.data, window.currentUser?.uid || '');
                    if (!cardData) return;
                    const cardNode = createLobbyGameElement(cardData, window.currentUser?.uid || '');
                    cardNode.classList.add('player-finished-card');
                    listNode.appendChild(cardNode);
                });
        }

        bindAvatarFallbackHandlers(playerItem);
        container.appendChild(playerItem);
    });
};

// Инициализация игры
function setGameSectionVisibility() {
    document.getElementById('game-section').classList.remove('hidden');
    document.getElementById('lobby-section').classList.add('hidden');
}

function initLocalGameState() {
    window.game = new Chess();
    window.currentRoomId = null;
    window.pendingDraw = null;
    window.pendingTakeback = null;
    window.playerColor = null;
    window.lastKnownGameState = null;
    window.lastRenderedMoveHistoryLength = 0;
    window.syncReviewStateFromCurrentGame();
    window.activeReactions = [];
    window.reactionRateLimitState = { cycleKey: window.getReactionCycleKey(), count: 0 };
}

async function ensureGameExists(gameRef, roomId) {
    const gameCheck = await get(gameRef);
    if (!gameCheck.exists()) {
        await window.createGame(roomId, window.game.pgn(), window.game.fen());
    }
}

function resolveAssignedColor(players, uid) {
    if (players.white === uid) return 'w';
    if (players.black === uid) return 'b';
    return null;
}

function applyAssignedColorToBoard() {
    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    if (window.playerColor === 'b') window.board.orientation('black');
}

function subscribeToGameUpdates(gameRef) {
    window.watchGame(gameRef, (snap) => {
        const data = snap.val();
        if (!data) return;
        window.setActiveReactionsFromState(data.reactions || []);
        window.applyRemotePgnUpdate(data.pgn);
        window.updateUI(data);
    });
}

window.initGame = async function(roomId) {
    const user = await window.requireAuthForGame();
    if (!user) {
        location.href = location.origin + location.pathname;
        return;
    }

    setGameSectionVisibility();
    document.getElementById('room-link').value = window.location.href;
    
    const uid = window.getUserId(user);
    const uName = window.getUserName(user);
    const gameRef = window.getGameRef(roomId);
    const playersRef = window.getPlayersRef(roomId);
    const requestedJoinColor = window.getRequestedJoinColor();
    
    initLocalGameState();
    await ensureGameExists(gameRef, roomId);
    await window.addPlayerToGame(playersRef, uid, uName, requestedJoinColor);
    
    const p = (await get(playersRef)).val() || {};
    window.playerColor = resolveAssignedColor(p, uid);
    applyAssignedColorToBoard();
    subscribeToGameUpdates(gameRef);
    
    window.setupGameControls(gameRef, roomId);
    window.currentRoomId = roomId;
};
// Функция удаления одной игры
function canDeleteGameByState(gameData, userId) {
    const players = gameData.players;
    const isParticipant = players && (players.white === userId || players.black === userId);
    const isFinished = gameData.gameState === 'game_over';
    const isWaitingOwned = players && (
        (players.white === userId && !players.black) ||
        (players.black === userId && !players.white)
    );

    return { players, isParticipant, isFinished, isWaitingOwned, canDelete: isParticipant && (isFinished || isWaitingOwned) };
}

function notifyAndReloadLobby(message, type, timeout) {
    window.notify(message, type, timeout);
    if (window.currentUser) {
        window.loadLobby(window.currentUser);
    }
}

window.deleteGame = async function(gameId, userId) {
    const gameRef = window.getGameRef(gameId);
    const gameData = (await get(gameRef)).val();
    
    if (!gameData) {
        window.notify("Игра не найдена", "error");
        return;
    }
    
    const { isParticipant, isWaitingOwned, canDelete } = canDeleteGameByState(gameData, userId);

    if (canDelete) {
        const deleteMessage = isWaitingOwned
            ? `Удалить ожидающую партию ${gameId}? Это действие нельзя отменить.`
            : `Удалить игру ${gameId}? Это действие нельзя отменить.`;
        const confirmDelete = await window.confirmAction({
            title: "Удаление партии",
            message: deleteMessage,
            confirmText: "Удалить",
            cancelText: "Отмена",
            danger: true
        });
        if (confirmDelete) {
            await set(gameRef, null);
            notifyAndReloadLobby("Игра удалена", "success");
        }
    } else if (isParticipant) {
        window.notify("Можно удалить только завершённую или ожидающую соперника партию", "error", 3200);
    } else {
        window.notify("У вас нет прав на удаление этой игры", "error", 3200);
    }
};
// Функция отправки запроса на ничью
function hideDrawRequestBox() {
    document.getElementById('draw-request-box')?.classList.add('hidden');
}

function getCurrentUserDisplayName() {
    return window.currentUser?.displayName || window.currentUser?.email?.split('@')[0] || 'Игрок';
}

window.sendDrawRequest = async function(gameRef, roomId) {
    if (window.isGameFinished?.()) {
        hideDrawRequestBox();
        window.pendingDraw = null;
        window.notify("Игра уже окончена", "warning");
        return;
    }

    const currentTurn = window.game.turn();
    const request = {
        from: window.playerColor,
        fromName: getCurrentUserDisplayName(),
        timestamp: Date.now(),
        turn: currentTurn
    };
    
    await window.updateGame(gameRef, { drawRequest: request });
    window.notify("Запрос на ничью отправлен сопернику", "success");
};

// Функция принятия ничьей
window.acceptDraw = async function(gameRef, roomId) {
    if (window.isGameFinished?.()) {
        hideDrawRequestBox();
        window.pendingDraw = null;
        window.notify("Игра уже окончена", "warning");
        return;
    }

    const players = (await get(window.getPlayersRef(roomId))).val() || null;
    const metadata = window.applyGameHeaders(window.game, {
        players,
        gameState: 'game_over',
        message: 'Ничья по соглашению'
    });
    const updateData = { 
        gameState: 'game_over', 
        message: metadata.message,
        pgn: window.game.pgn()
    };
    await window.updateGame(gameRef, updateData);
    hideDrawRequestBox();
    window.pendingDraw = null;
    window.notify("Игра закончилась ничьей", "success");
};

// Функция отклонения ничьей
window.rejectDraw = async function(gameRef, roomId) {
    if (window.isGameFinished?.()) {
        hideDrawRequestBox();
        window.pendingDraw = null;
        window.notify("Игра уже окончена", "warning");
        return;
    }

    await window.updateGame(gameRef, { drawRequest: null });
    hideDrawRequestBox();
    window.pendingDraw = null;
    window.notify("Соперник отклонил запрос на ничью", "info");
};
// Функция массового удаления завершённых игр
function isFinishedGameForUser(data, userId) {
    const players = data.players;
    return data.gameState === 'game_over' && players && (players.white === userId || players.black === userId);
}

window.clearFinishedGames = async function(userId) {
    const games = (await get(ref(window.db, `games`))).val();
    if (!games) return;
    
    let deletedCount = 0;
    
    for (const [gameId, data] of Object.entries(games)) {
        if (isFinishedGameForUser(data, userId)) {
            await set(window.getGameRef(gameId), null);
            deletedCount++;
        }
    }
    
    if (deletedCount > 0) {
        notifyAndReloadLobby(`Удалено ${deletedCount} завершённых игр`, "success", 3200);
    } else {
        window.notify("Нет завершённых игр для удаления", "info");
    }
};

// Инициализация кнопки массового удаления
window.initClearFinishedButton = function(userId) {
    const clearBtn = document.getElementById('clear-finished-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            window.confirmAction({
                title: "Очистить завершённые",
                message: "Удалить все завершённые игры? Это действие нельзя отменить.",
                confirmText: "Удалить всё",
                cancelText: "Отмена",
                danger: true
            }).then((confirmed) => {
                if (confirmed) {
                    window.clearFinishedGames(userId);
                }
            });
        };
    }
};
