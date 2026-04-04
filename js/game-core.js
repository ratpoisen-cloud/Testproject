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
window.lobbyViewMode = 'games';
window.lobbyPlayersExpanded = {};
window.reviewMode = false;
window.reviewPlyIndex = null;
window.reviewGame = null;
window.lastRemotePgn = '';
window.lastKnownGameState = null;
window.lastRenderedMoveHistoryLength = 0;
window.activeReactions = [];
window.reactionRateLimitState = { cycleKey: null, count: 0 };
window.BOARD_REACTION_MAX_PER_CYCLE = 5;

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

window.getRequestedJoinColor = function() {
    const colorParam = new URLSearchParams(window.location.search).get('color');
    if (colorParam === 'w' || colorParam === 'b') return colorParam;
    if (colorParam === 'random') return Math.random() < 0.5 ? 'w' : 'b';
    return null;
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
window.initLobby = function() {
    document.getElementById('lobby-section').classList.remove('hidden');
    document.getElementById('game-section').classList.add('hidden');
    const createGameModal = document.getElementById('create-game-modal');
    const colorButtons = document.querySelectorAll('[data-create-color]');
    const gamesViewBtn = document.getElementById('lobby-view-games');
    const playersViewBtn = document.getElementById('lobby-view-players');
    const gamesList = document.getElementById('games-list');
    const playersList = document.getElementById('players-list');
    const clearFinishedBtn = document.getElementById('clear-finished-btn');
    const closeCreateGameModal = () => {
        createGameModal?.classList.add('hidden');
    };
    const updateLobbyView = () => {
        const isGamesView = window.lobbyViewMode !== 'players';
        gamesList?.classList.toggle('hidden', !isGamesView);
        playersList?.classList.toggle('hidden', isGamesView);
        gamesViewBtn?.classList.toggle('active', isGamesView);
        playersViewBtn?.classList.toggle('active', !isGamesView);
        clearFinishedBtn?.classList.toggle('hidden', !isGamesView);
    };

    document.getElementById('create-game-btn').onclick = async () => {
        const user = await window.requireAuthForGame();
        if (!user) return;

        createGameModal?.classList.remove('hidden');
    };

    colorButtons.forEach((btn) => {
        btn.onclick = () => {
            const id = window.generateRoomId();
            const color = btn.dataset.createColor;
            closeCreateGameModal();
            location.href = location.origin + location.pathname + `?room=${id}&color=${encodeURIComponent(color)}`;
        };
    });

    document.getElementById('create-game-modal-cancel').onclick = closeCreateGameModal;
    createGameModal.onclick = (event) => {
        if (event.target === createGameModal) closeCreateGameModal();
    };
    gamesViewBtn.onclick = () => {
        window.lobbyViewMode = 'games';
        updateLobbyView();
    };
    playersViewBtn.onclick = () => {
        window.lobbyViewMode = 'players';
        updateLobbyView();
    };
    updateLobbyView();
};

// Загрузка игр в лобби
window.loadLobby = function(user) {
    const gamesList = document.getElementById('games-list');
    const playersList = document.getElementById('players-list');
    window.watchGames((snap) => {
        gamesList.innerHTML = '';
        playersList.innerHTML = '';
        const games = snap.val();
        if (!games) { 
            gamesList.innerHTML = '<div class="empty-lobby">Нет активных партий</div>'; 
            playersList.innerHTML = '<div class="empty-lobby">Нет соперников<br><small>Сыграйте первую партию</small></div>';
            return; 
        }
        
        // Сортировка: сначала активные по последнему ходу (сначала свежие), потом завершённые по последнему ходу
        const sortedGames = Object.entries(games).sort((a, b) => {
            const aData = a[1];
            const bData = b[1];
            const aOver = aData.gameState === 'game_over';
            const bOver = bData.gameState === 'game_over';
            
            // Если обе активные или обе завершённые - сортируем по времени последнего хода (сначала свежие)
            if (aOver === bOver) {
                const aTime = aData.lastMoveTime || aData.createdAt || 0;
                const bTime = bData.lastMoveTime || bData.createdAt || 0;
                return bTime - aTime;  // По убыванию (сначала новые)
            }
            
            // Активные игры выше завершённых
            return aOver ? 1 : -1;
        });
        
        let hasGames = false;
        
        sortedGames.forEach(([id, data]) => {
            const p = data.players;
            if (p && (p.white === user.uid || p.black === user.uid)) {
                hasGames = true;
                const isOver = data.gameState === 'game_over';
                const myColor = p.white === user.uid ? 'white' : 'black';
                const opponentUid = myColor === 'white' ? p.black : p.white;
                const isWaitingForOpponent = !isOver && !opponentUid;
                const opponent = (myColor === 'white') ? (p.blackName || "Ожидание...") : (p.whiteName || "Ожидание...");
                const statusText = isOver ? 'Завершена' : (isWaitingForOpponent ? 'Ожидание соперника' : 'В процессе');
                const canDeleteFromLobby = isOver || isWaitingForOpponent;
                
                // Получаем время последнего хода
                const lastMoveTime = data.lastMoveTime || data.createdAt || 0;
                const timeAgo = window.formatTimeAgo(lastMoveTime);

                const item = document.createElement('div');
                item.className = `game-item ${isOver ? 'finished' : 'active'}`;
                item.innerHTML = `
                    <div class="game-info">
                        <div>Против: <b>${opponent}</b></div>
                        <div class="game-meta">
                            <span class="game-id">${id}</span>
                            <span class="game-status">${statusText}</span>
                            <span class="game-time">${timeAgo}</span>
                        </div>
                        <small>Вы играете ${myColor === 'white' ? 'белыми' : 'черными'}</small>
                    </div>
                    <div class="game-actions">
                        <button class="btn btn-sm play-btn">Играть</button>
                        <button class="btn btn-sm delete-btn ${canDeleteFromLobby ? '' : 'hidden'}" data-game-id="${id}">Удалить</button>
                    </div>
                `;
                
                const playBtn = item.querySelector('.play-btn');
                playBtn.onclick = (e) => {
                    e.stopPropagation();
                    location.href = location.origin + location.pathname + `?room=${id}`;
                };
                
                const deleteBtn = item.querySelector('.delete-btn');
                if (deleteBtn && canDeleteFromLobby) {
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        window.deleteGame(id, user.uid);
                    };
                }
                
                gamesList.appendChild(item);
            }
        });
        
        if (!hasGames) {
            gamesList.innerHTML = '<div class="empty-lobby">Нет активных партий<br><small>Создайте новую игру!</small></div>';
        }

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
        const isFinished = data.gameState === 'game_over';
        const lastMoveTime = data.lastMoveTime || data.createdAt || 0;
        const myColor = isUserWhite ? 'white' : 'black';

        if (!opponentsMap.has(opponentUid)) {
            opponentsMap.set(opponentUid, {
                uid: opponentUid,
                name: opponentName,
                totalGames: 0,
                activeGames: 0,
                finishedGames: 0,
                lastMoveTime: 0,
                games: []
            });
        }

        const opponentCard = opponentsMap.get(opponentUid);
        opponentCard.totalGames += 1;
        opponentCard.activeGames += isFinished ? 0 : 1;
        opponentCard.finishedGames += isFinished ? 1 : 0;
        opponentCard.lastMoveTime = Math.max(opponentCard.lastMoveTime, lastMoveTime);
        opponentCard.games.push({
            id: gameId,
            status: isFinished ? 'Завершена' : 'В процессе',
            isFinished,
            myColor,
            lastMoveTime,
            resultLabel: isFinished ? window.getFinishedGameResultLabel(data) : ''
        });
    });

    const players = Array.from(opponentsMap.values());
    players.forEach((opponentCard) => {
        opponentCard.games.sort((a, b) => {
            if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
            return b.lastMoveTime - a.lastMoveTime;
        });
    });

    return players.sort((a, b) => b.lastMoveTime - a.lastMoveTime);
};

window.renderPlayersLobby = function(container, players) {
    container.innerHTML = '';

    if (!players.length) {
        container.innerHTML = '<div class="empty-lobby">Нет соперников<br><small>Завершите или начните партию с игроком</small></div>';
        return;
    }

    players.forEach((player) => {
        const isExpanded = !!window.lobbyPlayersExpanded[player.uid];
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        playerItem.innerHTML = `
            <div class="player-item-header">
                <div class="player-info">
                    <div class="player-name-row">Игрок: <b>${player.name}</b></div>
                    <div class="player-stats">
                        <span class="player-stat-pill">Всего: ${player.totalGames}</span>
                        <span class="player-stat-pill">Активных: ${player.activeGames}</span>
                        <span class="player-stat-pill">Завершённых: ${player.finishedGames}</span>
                        <span class="game-time">${window.formatTimeAgo(player.lastMoveTime)}</span>
                    </div>
                </div>
                <div class="game-actions">
                    <button class="btn btn-sm play-btn player-play-btn">Новая партия</button>
                    <button class="btn btn-sm btn-outline toggle-games-btn">${isExpanded ? 'Скрыть партии' : 'Показать партии'}</button>
                </div>
            </div>
            <div class="player-games-list ${isExpanded ? '' : 'hidden'}"></div>
        `;

        const playBtn = playerItem.querySelector('.player-play-btn');
        playBtn.onclick = async (event) => {
            event.stopPropagation();
            const user = await window.requireAuthForGame();
            if (!user) return;
            document.getElementById('create-game-btn').click();
        };

        const toggleBtn = playerItem.querySelector('.toggle-games-btn');
        const gamesHistoryNode = playerItem.querySelector('.player-games-list');
        toggleBtn.onclick = () => {
            const nextExpanded = !window.lobbyPlayersExpanded[player.uid];
            window.lobbyPlayersExpanded[player.uid] = nextExpanded;
            toggleBtn.textContent = nextExpanded ? 'Скрыть партии' : 'Показать партии';
            gamesHistoryNode.classList.toggle('hidden', !nextExpanded);
        };

        const historyHtml = player.games.map((game) => `
            <div class="player-game-row ${game.isFinished ? 'finished' : 'active'}">
                <div class="game-info">
                    <div class="game-meta">
                        <span class="game-id">${game.id}</span>
                        <span class="game-status">${game.status}</span>
                        <span class="game-time">${window.formatTimeAgo(game.lastMoveTime)}</span>
                    </div>
                    ${game.isFinished ? `<div class="player-game-result">${game.resultLabel}</div>` : ''}
                    <small>Вы играли ${game.myColor === 'white' ? 'белыми' : 'черными'}</small>
                </div>
                <div class="game-actions">
                    <button class="btn btn-sm play-btn open-player-game-btn" data-game-id="${game.id}">Открыть</button>
                </div>
            </div>
        `).join('');
        gamesHistoryNode.innerHTML = historyHtml || '<div class="empty-lobby">Пока нет партий</div>';

        gamesHistoryNode.querySelectorAll('.open-player-game-btn').forEach((btn) => {
            btn.onclick = (event) => {
                event.stopPropagation();
                const gameId = btn.dataset.gameId;
                location.href = location.origin + location.pathname + `?room=${gameId}`;
            };
        });

        container.appendChild(playerItem);
    });
};

// Инициализация игры
window.initGame = async function(roomId) {
    const user = await window.requireAuthForGame();
    if (!user) {
        location.href = location.origin + location.pathname;
        return;
    }

    document.getElementById('game-section').classList.remove('hidden');
    document.getElementById('lobby-section').classList.add('hidden');
    document.getElementById('room-link').value = window.location.href;
    
    const uid = window.getUserId(user);
    const uName = window.getUserName(user);
    const gameRef = window.getGameRef(roomId);
    const playersRef = window.getPlayersRef(roomId);
    const requestedJoinColor = window.getRequestedJoinColor();
    
    window.game = new Chess();
    window.lastKnownGameState = null;
    window.lastRenderedMoveHistoryLength = 0;
    window.syncReviewStateFromCurrentGame();
    window.activeReactions = [];
    window.reactionRateLimitState = { cycleKey: window.getReactionCycleKey(), count: 0 };
    
    const gameCheck = await get(gameRef);
    if (!gameCheck.exists()) {
        await window.createGame(roomId, window.game.pgn(), window.game.fen());
    }
    
    await window.addPlayerToGame(playersRef, uid, uName, requestedJoinColor);
    
    const p = (await get(playersRef)).val() || {};
    const assignedColor = p.white === uid ? 'w' : (p.black === uid ? 'b' : null);

    window.playerColor = assignedColor;
    
    // Обновляем UI
    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    
    if (window.playerColor === 'b') window.board.orientation('black');
    
    // Синхронизация игры
    window.watchGame(gameRef, (snap) => {
        const data = snap.val();
        if (!data) return;
        window.setActiveReactionsFromState(data.reactions || []);
        if (data.pgn && data.pgn !== window.game.pgn()) {
            window.game.load_pgn(data.pgn);
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
        }
        window.updateUI(data);
    });
    
    window.setupGameControls(gameRef, roomId);
    window.currentRoomId = roomId;
};
// Функция удаления одной игры
window.deleteGame = async function(gameId, userId) {
    const gameRef = window.getGameRef(gameId);
    const gameData = (await get(gameRef)).val();
    
    if (!gameData) {
        window.notify("Игра не найдена", "error");
        return;
    }
    
    const players = gameData.players;
    const isParticipant = players && (players.white === userId || players.black === userId);
    const isFinished = gameData.gameState === 'game_over';
    const isWaitingOwned = players && (
        (players.white === userId && !players.black) ||
        (players.black === userId && !players.white)
    );
    const canDelete = isParticipant && (isFinished || isWaitingOwned);

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
            window.notify("Игра удалена", "success");
            if (window.currentUser) {
                window.loadLobby(window.currentUser);
            }
        }
    } else if (isParticipant) {
        window.notify("Можно удалить только завершённую или ожидающую соперника партию", "error", 3200);
    } else {
        window.notify("У вас нет прав на удаление этой игры", "error", 3200);
    }
};
// Функция отправки запроса на ничью
window.sendDrawRequest = async function(gameRef, roomId) {
    const currentTurn = window.game.turn();
    const request = {
        from: window.playerColor,
        fromName: window.currentUser?.displayName || window.currentUser?.email?.split('@')[0] || 'Игрок',
        timestamp: Date.now(),
        turn: currentTurn
    };
    
    await window.updateGame(gameRef, { drawRequest: request });
    window.notify("Запрос на ничью отправлен сопернику", "success");
};

// Функция принятия ничьей
window.acceptDraw = async function(gameRef, roomId) {
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
    document.getElementById('draw-request-box').classList.add('hidden');
    window.pendingDraw = null;
    window.notify("Игра закончилась ничьей", "success");
};

// Функция отклонения ничьей
window.rejectDraw = async function(gameRef, roomId) {
    await window.updateGame(gameRef, { drawRequest: null });
    document.getElementById('draw-request-box').classList.add('hidden');
    window.pendingDraw = null;
    window.notify("Соперник отклонил запрос на ничью", "info");
};
// Функция массового удаления завершённых игр
window.clearFinishedGames = async function(userId) {
    const games = (await get(ref(window.db, `games`))).val();
    if (!games) return;
    
    let deletedCount = 0;
    
    for (const [gameId, data] of Object.entries(games)) {
        const players = data.players;
        const isOver = data.gameState === 'game_over';
        
        if (isOver && players && (players.white === userId || players.black === userId)) {
            await set(window.getGameRef(gameId), null);
            deletedCount++;
        }
    }
    
    if (deletedCount > 0) {
        window.notify(`Удалено ${deletedCount} завершённых игр`, "success", 3200);
        if (window.currentUser) {
            window.loadLobby(window.currentUser);
        }
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
