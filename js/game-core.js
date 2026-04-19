// ==================== ИГРОВАЯ ЛОГИКА ====================
// Отвечает за: лобби, создание/подключение к игре, ходы, синхронизацию

// Переменные состояния игры
window.game = null;
window.playerColor = null;
window.pendingMove = null;
window.selectedSquare = null;
window.currentRoomId = null;
window.isBotMode = false;
window.isTrainingMode = false;
window.trainingModeType = null;
window.isPassAndPlayMode = false;
window.passAndPlayVariant = null;
window.botColor = null;
window.botLevel = 'medium';
window.botEngine = null;
window.isBotThinking = false;
window.pendingTakeback = null;
window.pendingDraw = null;
window.pendingRematch = null;
window.dragSourceSquare = null; // Добавляем переменную для drag-and-drop
window.lobbyCurrentScreen = 'hub';
window.lobbyShowFinished = false;
window.reviewMode = false;
window.reviewPlyIndex = null;
window.reviewGame = null;
window.lastRemotePgn = '';
window.hasInitializedRemotePgnSync = false;
window.lastKnownGameState = null;
window.lastRenderedMoveHistoryLength = 0;
window.activeReactions = [];
window.reactionRateLimitState = { cycleKey: null, count: 0 };
window.BOARD_REACTION_MAX_PER_CYCLE = 5;
window.activeQuickPhrase = null;
window.quickPhraseRateLimitState = { cycleKey: null, count: 0 };
window.QUICK_PHRASE_MAX_PER_CYCLE = 3;
window.QUICK_PHRASE_TTL_MS = 5000;
window.playersExpandedResultFilter = {};
window.pendingDirectChallengeOpponent = null;
window.lobbyNotifiedDirectChallenges = new Set();
window.lobbyNotifiedRematchInvites = new Set();
window.DIRECT_CHALLENGE_SEEN_STORAGE_KEY = 'chess_direct_challenge_seen_v1';
window.DIRECT_INVITE_HANDLED_STORAGE_KEY = 'chess_direct_invite_handled_v1';
window.REMATCH_INVITE_SEEN_STORAGE_KEY = 'chess_rematch_invite_seen_v1';
window.BOT_GAMES_HISTORY_STORAGE_KEY = 'chess_bot_games_history_v1';
window.PASS_AND_PLAY_SAVED_GAME_STORAGE_KEY = 'go_chess_pass_and_play_saved_game_v1';
window.lobbyLastSnapshotByGame = new Map();
window.lobbyLastEventSnapshotByGame = new Map();
window.lobbyGameCardRegistry = new Map();
window.lobbyRenderedCardSignatureByRoom = new Map();
window.lobbyPlayerCardRegistry = new Map();
window.lobbyRenderedPlayerSignatureByUid = new Map();
window.lobbyLastPlayersAggregate = [];
window.lobbyHasProcessedFirstSnapshot = false;
window.LOBBY_DOM_FLUSH_DEBOUNCE_MS = 140;
window.__lobbyDomFlushTimer = null;
window.__lobbyDomFlushPayload = null;
window.botGamesLevelFilter = 'all';
window.lastSavedBotGameSignature = '';
window.isBotHistoryViewer = false;
window.currentBotSessionId = null;
window.isArchivedFinishedView = false;
window.gameSoundFlags = {
    rookVoicePlayed: false,
    queenVoicePlayed: false
};
window.lastPlayedGameOverSoundKey = null;
window.lastMoveSequenceEndgameMarker = null;

window.isSelfTrainingMode = function() {
    return Boolean(window.isTrainingMode && window.trainingModeType === 'self');
};

window.isPassAndPlayStandardMode = function() {
    return Boolean(window.isPassAndPlayMode && window.passAndPlayVariant === 'standard');
};

window.isLocalGameMode = function() {
    return Boolean(window.isBotMode || window.isTrainingMode || window.isPassAndPlayMode);
};

window.isGameFinished = function(gameData = null) {
    return Boolean(
        window.game?.game_over?.() ||
        gameData?.gameState === 'game_over' ||
        window.lastKnownGameState === 'game_over'
    );
};

window.applyImmediateGameOverState = function(partialData = {}) {
    const nextSnapshot = {
        ...(window.lastGameUiSnapshot || {}),
        ...partialData,
        gameState: 'game_over'
    };

    window.lastKnownGameState = 'game_over';
    window.updateUI?.(nextSnapshot);
    window.applyGameEndBoardEffects?.(window.game?.fen?.());
    window.playGameOverSoundForCurrentClient?.(nextSnapshot);
};

window.canUseBoardReactions = function(gameData = null) {
    if (!window.currentRoomId || !window.playerColor || !window.game) return false;
    if (!window.isGameFinished(gameData)) return true;
    return !window.isArchivedFinishedView;
};

window.getReactionCycleKey = function() {
    if (!window.game) return 'idle';
    return `${window.game.turn()}_${window.game.history().length}`;
};

window.getQuickPhraseCycleKey = function() {
    if (!window.game) return 'idle';
    return `${window.game.turn()}_${window.game.history().length}`;
};

window.resolveRematchStatus = function(rematchRequest) {
    const rawStatus = rematchRequest?.status ?? rematchRequest?.state;
    if (rawStatus === undefined || rawStatus === null) return '';
    return String(rawStatus).trim().toLowerCase();
};

window.isRematchRequestRelevant = function(rematchRequest) {
    if (!rematchRequest || typeof rematchRequest !== 'object') return false;
    const status = window.resolveRematchStatus(rematchRequest);
    if (!status) return false;
    return status === 'pending' || status === 'accepted';
};

window.getRematchInvitationForUser = function(roomId, gameData, userId) {
    if (!roomId || !gameData || !userId || gameData.gameState !== 'game_over') return null;
    const players = gameData.players || {};
    const rematchRequest = gameData.rematchRequest || null;
    if (!players.white || !players.black || !window.isRematchRequestRelevant(rematchRequest)) return null;
    if (rematchRequest.createdByUid === userId) return null;
    if (rematchRequest.targetUid !== userId) return null;
    if (Number.isFinite(rematchRequest.expiresAt) && rematchRequest.expiresAt <= Date.now()) return null;
    const userColor = players.white === userId ? 'w' : (players.black === userId ? 'b' : null);
    if (!userColor) return null;
    if (rematchRequest.confirmedBy?.[userColor]) return null;
    return rematchRequest;
};

window.finalizeRematchIfReady = async function(roomId, gameData) {
    if (!roomId || !gameData) return null;

    const players = gameData.players || {};
    const rematch = gameData.rematchRequest || null;
    if (!window.isRematchRequestRelevant(rematch)) return null;
    if (rematch.startedRoomId) return rematch.startedRoomId;

    const confirmedBy = rematch.confirmedBy || {};
    const bothConfirmed = Boolean(confirmedBy.w && confirmedBy.b);
    if (!bothConfirmed) return null;

    if (!players.white || !players.black) return null;

    const startedRoomId = rematch.proposedRoomId || window.generateRoomId();
    const now = Date.now();

    const startedRoomSnap = await get(window.getGameRef(startedRoomId));
    if (!startedRoomSnap.exists()) {
        await set(window.getGameRef(startedRoomId), {
            players: {
                white: players.black,
                whiteName: players.blackName,
                whitePhotoURL: players.blackPhotoURL || '',
                black: players.white,
                blackName: players.whiteName,
                blackPhotoURL: players.whitePhotoURL || ''
            },
            pgn: new Chess().pgn(),
            fen: 'start',
            gameState: 'active',
            createdAt: now,
            lastMoveTime: now
        });
    }

    await window.updateGame(window.getGameRef(roomId), {
        rematchRequest: {
            ...rematch,
            confirmedBy: {
                ...confirmedBy,
                w: true,
                b: true
            },
            status: 'resolved',
            resolvedAt: now,
            startedRoomId,
            updatedAt: now
        }
    });

    return startedRoomId;
};

window.requestRematchFromRoom = async function(roomId, requesterUid) {
    if (!roomId || !requesterUid) return null;
    const gameSnap = await get(window.getGameRef(roomId));
    const gameData = gameSnap.val();
    if (!gameData || gameData.gameState !== 'game_over') return null;

    const players = gameData.players || {};
    const requesterColor = players.white === requesterUid ? 'w' : (players.black === requesterUid ? 'b' : null);
    if (!requesterColor) return null;
    const targetUid = requesterColor === 'w' ? players.black : players.white;
    if (!targetUid) return null;

    const existing = gameData.rematchRequest || null;
    const existingStatus = window.resolveRematchStatus(existing);
    if (existing && (existingStatus === 'pending' || existingStatus === 'accepted')) {
        const nextConfirmedBy = { ...(existing.confirmedBy || {}), [requesterColor]: true };
        const now = Date.now();
        const nextRequest = {
            ...existing,
            status: 'pending',
            confirmedBy: nextConfirmedBy,
            updatedAt: now
        };
        await window.updateGame(window.getGameRef(roomId), {
            rematchRequest: nextRequest
        });
        const startedRoomId = await window.finalizeRematchIfReady(roomId, {
            ...gameData,
            rematchRequest: nextRequest
        });
        return { roomId, rematchRequestId: existing.id || '', startedRoomId: startedRoomId || null };
    }

    const now = Date.now();
    const request = {
        id: `${roomId}_${now}`,
        type: 'rematch_invite',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + (1000 * 60 * 60 * 12),
        createdByUid: requesterUid,
        createdByName: window.currentUser?.displayName || window.currentUser?.email?.split('@')[0] || 'Игрок',
        targetUid,
        status: 'pending',
        confirmedBy: {
            [requesterColor]: true
        },
        proposedRoomId: window.generateRoomId()
    };

    await window.updateGame(window.getGameRef(roomId), { rematchRequest: request });
    return { roomId, rematchRequestId: request.id, startedRoomId: null };
};

window.confirmRematchForRoom = async function(roomId, confirmerUid) {
    if (!roomId || !confirmerUid) return null;
    const gameRef = window.getGameRef(roomId);
    const gameSnap = await get(gameRef);
    const gameData = gameSnap.val();
    const players = gameData?.players || {};
    const rematch = gameData?.rematchRequest || null;
    if (!window.isRematchRequestRelevant(rematch)) return null;

    const confirmerColor = players.white === confirmerUid ? 'w' : (players.black === confirmerUid ? 'b' : null);
    if (!confirmerColor) return null;
    const nextConfirmedBy = { ...(rematch.confirmedBy || {}), [confirmerColor]: true };
    const now = Date.now();
    const nextRequest = {
        ...rematch,
        confirmedBy: nextConfirmedBy,
        status: 'pending',
        updatedAt: now
    };

    await window.updateGame(gameRef, {
        rematchRequest: nextRequest
    });

    return window.finalizeRematchIfReady(roomId, {
        ...gameData,
        rematchRequest: nextRequest
    });
};

window.declineRematchForRoom = async function(roomId, declinerUid) {
    if (!roomId || !declinerUid) return;
    const gameRef = window.getGameRef(roomId);
    const gameSnap = await get(gameRef);
    const gameData = gameSnap.val();
    const rematch = gameData?.rematchRequest || null;
    if (!rematch) return;
    await window.updateGame(gameRef, {
        rematchRequest: {
            ...rematch,
            status: 'declined',
            declinedByUid: declinerUid,
            declinedAt: Date.now(),
            updatedAt: Date.now()
        }
    });
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

window.canSendQuickPhrase = function() {
    const cycleKey = window.getQuickPhraseCycleKey();
    if (window.quickPhraseRateLimitState.cycleKey !== cycleKey) {
        window.quickPhraseRateLimitState = { cycleKey, count: 0 };
    }

    if (window.quickPhraseRateLimitState.count >= window.QUICK_PHRASE_MAX_PER_CYCLE) {
        return false;
    }

    window.quickPhraseRateLimitState.count += 1;
    return true;
};

window.normalizeQuickPhrase = function(quickPhrase) {
    if (!quickPhrase || typeof quickPhrase !== 'object') return null;
    const createdAt = Number(quickPhrase.createdAt);
    if (!Number.isFinite(createdAt)) return null;
    if (Date.now() - createdAt >= (window.QUICK_PHRASE_TTL_MS || 5000)) return null;
    if (typeof quickPhrase.from !== 'string' || typeof quickPhrase.text !== 'string' || typeof quickPhrase.emoji !== 'string') {
        return null;
    }
    return {
        from: quickPhrase.from,
        text: quickPhrase.text,
        emoji: quickPhrase.emoji,
        createdAt
    };
};

window.setActiveQuickPhraseFromState = function(quickPhrase) {
    window.activeQuickPhrase = window.normalizeQuickPhrase(quickPhrase);
    window.renderOpponentQuickPhrase?.(window.activeQuickPhrase);
};

window.pushQuickPhrase = async function({ text, emoji }) {
    if (!window.currentRoomId || !window.playerColor || window.isLocalGameMode?.()) return false;
    if (window.playerColor !== 'w' && window.playerColor !== 'b') return false;

    const safeText = String(text || '').trim().slice(0, 64);
    const safeEmoji = String(emoji || '⚡').trim().slice(0, 4);
    if (!safeText) return false;

    if (!window.canSendQuickPhrase()) {
        window.notify('Лимит эмоций на этот ход исчерпан', 'warning', 2200);
        return false;
    }

    const nextQuickPhrase = {
        text: safeText,
        emoji: safeEmoji || '⚡',
        from: window.playerColor,
        createdAt: Date.now()
    };

    window.setActiveQuickPhraseFromState(nextQuickPhrase);

    try {
        await window.updateGame(window.getGameRef(window.currentRoomId), { quickPhrase: nextQuickPhrase });
        return true;
    } catch (error) {
        console.error('Ошибка отправки быстрой фразы:', error);
        if (
            window.quickPhraseRateLimitState?.cycleKey === window.getQuickPhraseCycleKey()
            && window.quickPhraseRateLimitState.count > 0
        ) {
            window.quickPhraseRateLimitState.count -= 1;
        }
        window.activeQuickPhrase = null;
        window.renderOpponentQuickPhrase?.(null);
        window.notify('Не удалось отправить фразу', 'error', 2200);
        return false;
    }
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
    if (!window.canUseBoardReactions?.()) return false;

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

window.getFinishedGameTerminationLabel = function(gameData) {
    if (!gameData || gameData.gameState !== 'game_over') return '';

    const resignColor = gameData.resign;
    if (resignColor === 'w') return 'Сдались белые';
    if (resignColor === 'b') return 'Сдались чёрные';

    const pgn = String(gameData.pgn || '');
    const terminationHeader = pgn.match(/\[Termination\s+"([^"]+)"\]/i)?.[1] || '';
    const combined = `${terminationHeader} ${String(gameData.message || '')}`.toLowerCase();

    if (combined.includes('мат')) return 'Мат';
    if (combined.includes('пат')) return 'Пат';
    if (combined.includes('троекрат')) return 'Троекратное повторение';
    if (combined.includes('недостат')) return 'Недостаточно фигур';
    if (combined.includes('соглаш')) return 'По соглашению';

    const replayGame = new Chess();
    if (pgn) {
        try {
            replayGame.load_pgn(pgn);
        } catch (error) {
            console.warn('Не удалось загрузить PGN для причины завершения:', error);
        }
    }

    if (replayGame.in_checkmate?.()) return 'Мат';
    if (replayGame.in_stalemate?.()) return 'Пат';
    if (replayGame.in_threefold_repetition?.()) return 'Троекратное повторение';
    if (replayGame.insufficient_material?.()) return 'Недостаточно фигур';
    return '';
};

window.getGameOverSummary = function(game = window.game, gameData = window.lastGameUiSnapshot || null) {
    const fallback = {
        isFinished: false,
        termination: 'unknown',
        resultCode: '*',
        winnerColor: null,
        loserColor: null
    };

    const isFinished = Boolean(
        game?.game_over?.() ||
        gameData?.gameState === 'game_over' ||
        window.lastKnownGameState === 'game_over'
    );
    if (!isFinished) return fallback;

    const message = String(gameData?.message || '').toLowerCase();
    const resignColor = gameData?.resign === 'w' || gameData?.resign === 'b'
        ? gameData.resign
        : null;
    const resultCode = window.resolveGameResult?.(game, gameData) || '*';
    const loserByResult = resultCode === '1-0' ? 'b' : (resultCode === '0-1' ? 'w' : null);

    let termination = 'unknown';
    if (resignColor) {
        termination = 'resign';
    } else if (game?.in_checkmate?.() || message.includes('мат')) {
        termination = 'checkmate';
    } else if (game?.in_stalemate?.() || message.includes('пат')) {
        termination = 'stalemate';
    } else if (
        resultCode === '1/2-1/2' ||
        game?.in_draw?.() ||
        message.includes('ничья') ||
        message.includes('соглаш')
    ) {
        termination = 'draw';
    }

    const loserColor = resignColor || (termination === 'checkmate' ? game?.turn?.() : loserByResult);
    const winnerColor = loserColor === 'w' ? 'b' : (loserColor === 'b' ? 'w' : null);

    return {
        isFinished: true,
        termination,
        resultCode,
        winnerColor,
        loserColor
    };
};

window.getRequestedJoinColor = function() {
    const colorParam = new URLSearchParams(window.location.search).get('color');
    if (colorParam === 'w' || colorParam === 'b') return colorParam;
    if (colorParam === 'random') return Math.random() < 0.5 ? 'w' : 'b';
    return null;
};

window.resolveMoveSoundEvent = function(moveResult) {
    if (!moveResult) return null;
    if (!moveResult.captured) return 'move';

    const movingPiece = String(moveResult.piece || '').toLowerCase();
    if (movingPiece === 'p' || movingPiece === 'n' || movingPiece === 'k') {
        return 'capture_default';
    }

    if (movingPiece === 'b' || movingPiece === 'r' || movingPiece === 'q') {
        return 'capture_ranged';
    }

    return 'capture_default';
};

window.resetGameSoundFlags = function() {
    window.gameSoundFlags = {
        rookVoicePlayed: false,
        queenVoicePlayed: false
    };
};

window.resolveEndgameSoundEventForCurrentClient = function({
    game = window.game,
    gameData = window.lastGameUiSnapshot || null
} = {}) {
    const summary = window.getGameOverSummary?.(game, gameData);
    if (!summary?.isFinished) return null;

    if (summary.termination === 'draw' || summary.termination === 'stalemate' || summary.resultCode === '1/2-1/2') {
        return 'draw';
    }

    const currentClientColor = window.playerColor === 'w' || window.playerColor === 'b'
        ? window.playerColor
        : null;

    if (!currentClientColor) {
        return null;
    }

    if (summary.winnerColor === currentClientColor) {
        return currentClientColor === 'w' ? 'win_white' : 'win_black';
    }

    if (summary.loserColor === currentClientColor) {
        return 'defeat';
    }

    return null;
};

window.resolveGameOverSoundKey = function({
    game = window.game,
    gameData = window.lastGameUiSnapshot || null
} = {}) {
    const summary = window.getGameOverSummary?.(game, gameData);
    if (!summary?.isFinished) return null;

    const finalSoundEvent = window.resolveEndgameSoundEventForCurrentClient?.({
        game,
        gameData
    }) || '-';
    const resignColor = gameData?.resign === 'w' || gameData?.resign === 'b' ? gameData.resign : '';
    const plyCount = Array.isArray(game?.history?.()) ? game.history().length : 0;
    const roomId = window.currentRoomId || '-';
    return [
        roomId,
        plyCount,
        summary.termination,
        summary.resultCode,
        summary.winnerColor || '-',
        summary.loserColor || '-',
        resignColor || '-',
        finalSoundEvent
    ].join('|');
};

window.playGameOverSoundForCurrentClient = function(gameData = window.lastGameUiSnapshot || null) {
    const summary = window.getGameOverSummary?.(window.game, gameData);
    if (!summary?.isFinished) return Promise.resolve();

    const key = window.resolveGameOverSoundKey?.({ game: window.game, gameData });
    if (key && window.lastPlayedGameOverSoundKey === key) {
        return Promise.resolve();
    }

    const finalSoundEvent = window.resolveEndgameSoundEventForCurrentClient?.({
        game: window.game,
        gameData
    });

    const queue = [];
    if (summary.termination === 'checkmate') {
        queue.push('checkmate');
    }
    if (finalSoundEvent) {
        queue.push(finalSoundEvent);
    }

    if (queue.length === 0) {
        if (key) window.lastPlayedGameOverSoundKey = key;
        return Promise.resolve();
    }

    if (key) window.lastPlayedGameOverSoundKey = key;

    if (window.SoundManager?.playSequence) {
        return window.SoundManager.playSequence(queue);
    }

    queue.forEach((eventName) => window.SoundManager?.play?.(eventName));
    return Promise.resolve();
};

window.resolveMovePostSoundEvents = function(moveResult, options = {}) {
    if (!moveResult || !window.game) return [];

    const { allowVoiceLine = false } = options;
    const events = [];
    const summary = window.getGameOverSummary?.(window.game, window.lastGameUiSnapshot);
    const isFinishedGame = Boolean(summary?.isFinished);
    const isCheckmate = Boolean(window.game.in_checkmate?.());
    const isCheck = !isCheckmate && Boolean(window.game.in_check?.());

    if (moveResult.promotion) {
        events.push('promotion');
    }

    if (isCheckmate) {
        events.push('checkmate');
        const finalEvent = window.resolveEndgameSoundEventForCurrentClient?.({
            game: window.game,
            gameData: window.lastGameUiSnapshot
        });
        if (finalEvent) {
            events.push(finalEvent);
        }
    } else if (isFinishedGame) {
        const finalEvent = window.resolveEndgameSoundEventForCurrentClient?.({
            game: window.game,
            gameData: window.lastGameUiSnapshot
        });
        if (finalEvent) {
            events.push(finalEvent);
        }
    } else if (isCheck) {
        events.push('check');
    }

    if (allowVoiceLine && !isCheck && !isCheckmate) {
        const movingPiece = String(moveResult.piece || '').toLowerCase();
        if (movingPiece === 'r' && !window.gameSoundFlags?.rookVoicePlayed) {
            events.push('rook_first_move_voice');
            window.gameSoundFlags.rookVoicePlayed = true;
        } else if (movingPiece === 'q' && !window.gameSoundFlags?.queenVoicePlayed) {
            events.push('queen_first_move_voice');
            window.gameSoundFlags.queenVoicePlayed = true;
        }
    }

    if (events.length > 0 && isFinishedGame) {
        const key = window.resolveGameOverSoundKey?.({
            game: window.game,
            gameData: window.lastGameUiSnapshot
        });
        if (key) {
            window.lastPlayedGameOverSoundKey = key;
        }
    }

    return events;
};

window.resolveMoveSoundSequence = function(moveResult, options = {}) {
    const primarySoundEvent = window.resolveMoveSoundEvent?.(moveResult);
    const tailEvents = window.resolveMovePostSoundEvents?.(moveResult, options) || [];

    return [primarySoundEvent, ...tailEvents].filter((eventName) => typeof eventName === 'string' && eventName);
};

window.isEndgameSoundEvent = function(eventName) {
    return eventName === 'checkmate'
        || eventName === 'win_white'
        || eventName === 'win_black'
        || eventName === 'defeat'
        || eventName === 'draw';
};

window.markMoveSequenceEndgameIfNeeded = function(queue = []) {
    if (!Array.isArray(queue) || queue.length === 0) return;
    if (!queue.some((eventName) => window.isEndgameSoundEvent?.(eventName))) return;
    const plyCount = window.game?.history?.().length || 0;
    window.lastMoveSequenceEndgameMarker = {
        roomId: window.currentRoomId || '-',
        plyCount
    };
};

window.wasCurrentEndgameHandledByMoveSequence = function() {
    const marker = window.lastMoveSequenceEndgameMarker;
    if (!marker) return false;
    const currentPly = window.game?.history?.().length || 0;
    const currentRoom = window.currentRoomId || '-';
    return marker.roomId === currentRoom && marker.plyCount === currentPly;
};

window.playMoveSoundSequence = function(moveResult, options = {}) {
    const queue = window.resolveMoveSoundSequence?.(moveResult, options) || [];
    if (queue.length === 0) {
        return Promise.resolve();
    }
    window.markMoveSequenceEndgameIfNeeded?.(queue);

    if (window.SoundManager?.playSequence) {
        return window.SoundManager.playSequence(queue);
    }

    queue.forEach((eventName) => window.SoundManager?.play?.(eventName));
    return Promise.resolve();
};

window.applyRemotePgnUpdate = function(pgn) {
    if (!window.game || !pgn) return false;

    const currentPgn = window.game.pgn();
    const isInitialRemoteSync = !window.hasInitializedRemotePgnSync;
    if (isInitialRemoteSync) {
        window.hasInitializedRemotePgnSync = true;
    }
    const isNewPgnForClient = pgn !== currentPgn;
    if (!isNewPgnForClient) return false;

    try {
        window.game.load_pgn(pgn);
    } catch (error) {
        console.error('Ошибка синхронизации PGN:', error);
        window.notify('Не удалось синхронизировать партию. Обновите страницу.', 'error', 3200);
        return false;
    }

    const history = window.game.history({ verbose: true });
    const lastMove = history[history.length - 1] || null;
    if (!isInitialRemoteSync && lastMove) {
        window.playMoveSoundSequence?.(lastMove, { allowVoiceLine: false });
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
        botGamesView: document.getElementById('lobby-view-bot-games'),
        hubCreateBtn: document.getElementById('hub-create-game'),
        hubOpenGamesBtn: document.getElementById('hub-open-games'),
        hubOpenPlayersBtn: document.getElementById('hub-open-players'),
        hubOpenBotGamesBtn: document.getElementById('hub-open-bot-games'),
        hubOpenTrainingBtn: document.getElementById('hub-open-training'),
        hubOpenPassAndPlayBtn: document.getElementById('hub-open-pass-and-play'),
        hubGamesInviteDot: document.getElementById('hub-games-invite-dot'),
        hubGamesInviteLabel: document.getElementById('hub-games-invite-label'),
        createGameBtn: document.getElementById('create-game-btn'),
        createGameModal: document.getElementById('create-game-modal'),
        createGameModalTitle: document.getElementById('create-game-modal-title'),
        createGameModalDesc: document.getElementById('create-game-modal-desc'),
        createGameCancelBtn: document.getElementById('create-game-modal-cancel'),
        botGameModal: document.getElementById('bot-game-modal'),
        botGameStartBtn: document.getElementById('bot-game-start'),
        botGameCancelBtn: document.getElementById('bot-game-cancel'),
        trainingModeModal: document.getElementById('training-mode-modal'),
        trainingModeSelfBtn: document.getElementById('training-mode-self'),
        trainingModeCancelBtn: document.getElementById('training-mode-cancel'),
        passAndPlayModeModal: document.getElementById('pass-and-play-mode-modal'),
        passAndPlayModeStandardBtn: document.getElementById('pass-and-play-mode-standard'),
        passAndPlayModeResumeBtn: document.getElementById('pass-and-play-mode-resume'),
        passAndPlayModeNewGameBtn: document.getElementById('pass-and-play-mode-new-game'),
        passAndPlayModeCancelBtn: document.getElementById('pass-and-play-mode-cancel'),
        botColorSelect: document.getElementById('bot-color-select'),
        botLevelSelect: document.getElementById('bot-level-select'),
        colorButtons: document.querySelectorAll('[data-create-color]'),
        backButtons: document.querySelectorAll('[data-lobby-back]'),
        finishedGamesList: document.getElementById('finished-games-list'),
        showActiveGamesBtn: document.getElementById('show-active-games-btn'),
        showFinishedGamesBtn: document.getElementById('show-finished-games-btn'),
        clearFinishedBtn: document.getElementById('clear-finished-btn'),
        botGamesList: document.getElementById('bot-games-list'),
        botGamesNewBtn: document.getElementById('bot-games-new-btn'),
        botGamesFilterAllBtn: document.getElementById('bot-games-filter-all'),
        botGamesFilterEasyBtn: document.getElementById('bot-games-filter-easy'),
        botGamesFilterMediumBtn: document.getElementById('bot-games-filter-medium'),
        botGamesFilterHardBtn: document.getElementById('bot-games-filter-hard')
    };
}

window.updateTopLobbyBrandVisibility = function() {
    const topBrand = document.getElementById('top-lobby-brand');
    if (!topBrand) return;

    topBrand.classList.remove('hidden');
};

window.bindTopBrandHomeAction = function bindTopBrandHomeAction() {
    if (window.__topBrandHomeBound) return;
    const topBrand = document.getElementById('top-lobby-brand');
    if (!topBrand) return;

    topBrand.addEventListener('click', () => {
        const gameSection = document.getElementById('game-section');
        const isGameVisible = Boolean(gameSection && !gameSection.classList.contains('hidden'));
        const lobbySection = document.getElementById('lobby-section');
        const targetLobbyVisible = Boolean(lobbySection && !lobbySection.classList.contains('hidden'));
        const targetUrl = `${window.location.origin}${window.location.pathname}`;

        if (isGameVisible) {
            if (window.location.href !== targetUrl) {
                window.location.href = targetUrl;
                return;
            }
            if (typeof window.initLobby === 'function') {
                window.initLobby();
                return;
            }
            if (typeof window.setLobbyScreen === 'function') {
                window.setLobbyScreen('hub');
            }
            return;
        }

        if (targetLobbyVisible && typeof window.setLobbyScreen === 'function') {
            window.setLobbyScreen('hub');
            return;
        }

        if (window.location.href !== targetUrl) {
            window.location.href = targetUrl;
        }
    });

    window.__topBrandHomeBound = true;
};

window.setLobbyScreen = function(screen) {
    const nodes = getLobbyNodes();
    const safeScreen = ['hub', 'games', 'players', 'bot-games'].includes(screen) ? screen : 'hub';
    window.lobbyCurrentScreen = safeScreen;

    nodes.hubView?.classList.toggle('hidden', safeScreen !== 'hub');
    nodes.gamesView?.classList.toggle('hidden', safeScreen !== 'games');
    nodes.playersView?.classList.toggle('hidden', safeScreen !== 'players');
    nodes.botGamesView?.classList.toggle('hidden', safeScreen !== 'bot-games');
    window.updateTopLobbyBrandVisibility?.();

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


function closeBotGameModal(modal) {
    modal?.classList.add('hidden');
}

function closeTrainingModeModal(modal) {
    modal?.classList.add('hidden');
}

function closePassAndPlayModeModal(modal) {
    modal?.classList.add('hidden');
}

function syncPassAndPlayModeModalState(nodes) {
    const hasSavedGame = Boolean(window.hasSavedPassAndPlayGame?.());
    const standardBtn = nodes.passAndPlayModeStandardBtn;
    const resumeBtn = nodes.passAndPlayModeResumeBtn;
    const newGameBtn = nodes.passAndPlayModeNewGameBtn;

    if (standardBtn) {
        standardBtn.classList.toggle('hidden', hasSavedGame);
    }
    if (resumeBtn) {
        resumeBtn.classList.toggle('hidden', !hasSavedGame);
    }
    if (newGameBtn) {
        newGameBtn.classList.toggle('hidden', !hasSavedGame);
    }
}

function getPassAndPlaySnapshotGameState(snapshot, gameInstance = null) {
    if (snapshot?.gameState === 'game_over') return 'game_over';
    if (gameInstance?.game_over?.()) return 'game_over';
    return 'active';
}

window.loadPassAndPlayGameSnapshot = function() {
    try {
        const raw = localStorage.getItem(window.PASS_AND_PLAY_SAVED_GAME_STORAGE_KEY);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') return null;
        if (snapshot.mode !== 'pass-and-play') return null;
        if (snapshot.variant !== 'standard') return null;
        if (!snapshot.pgn && !snapshot.fen) return null;
        return snapshot;
    } catch (error) {
        console.warn('Не удалось загрузить локальное сохранение pass-and-play:', error);
        return null;
    }
};

window.clearPassAndPlayGameSnapshot = function() {
    try {
        localStorage.removeItem(window.PASS_AND_PLAY_SAVED_GAME_STORAGE_KEY);
    } catch (error) {
        console.warn('Не удалось очистить локальное сохранение pass-and-play:', error);
    }
};

window.savePassAndPlayGameSnapshot = function(extra = {}) {
    if (!window.isPassAndPlayStandardMode?.() || !window.game) return null;
    try {
        const history = window.game.history?.() || [];
        const snapshot = {
            mode: 'pass-and-play',
            variant: 'standard',
            pgn: window.game.pgn(),
            fen: window.game.fen(),
            history,
            turn: window.game.turn(),
            orientation: window.board?.orientation?.() || (window.game.turn() === 'b' ? 'black' : 'white'),
            gameState: getPassAndPlaySnapshotGameState(extra, window.game),
            updatedAt: Date.now(),
            ...extra
        };
        localStorage.setItem(window.PASS_AND_PLAY_SAVED_GAME_STORAGE_KEY, JSON.stringify(snapshot));
        return snapshot;
    } catch (error) {
        console.warn('Не удалось сохранить локальную партию pass-and-play:', error);
        return null;
    }
};

window.hasSavedPassAndPlayGame = function() {
    const snapshot = window.loadPassAndPlayGameSnapshot?.();
    return Boolean(snapshot);
};

function getBotLevelLabel(level) {
    if (level === 'easy') return 'Лёгкий';
    if (level === 'hard') return 'Сильный';
    return 'Средний';
}

function getUserColorLabel(color) {
    return color === 'b' ? 'Чёрные' : 'Белые';
}

function getLobbyPresenceSnapshot(opponentUid, { isWaitingForOpponent = false } = {}) {
    if (!opponentUid) {
        return {
            text: isWaitingForOpponent ? 'ожидание соперника' : 'не в сети',
            variant: 'offline'
        };
    }

    const effectivePresence = window.getEffectivePresence?.(opponentUid) || { text: 'не в сети', tone: 'offline' };
    const variant = typeof window.resolvePresenceIndicatorVariant === 'function'
        ? window.resolvePresenceIndicatorVariant(effectivePresence)
        : 'offline';
    return {
        text: effectivePresence.text || 'не в сети',
        variant
    };
}

function parseBotGamesHistory() {
    try {
        const raw = localStorage.getItem(window.BOT_GAMES_HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('Не удалось прочитать историю bot games:', error);
        return [];
    }
}

function persistBotGamesHistory(list) {
    try {
        localStorage.setItem(window.BOT_GAMES_HISTORY_STORAGE_KEY, JSON.stringify(list.slice(0, 300)));
    } catch (error) {
        console.warn('Не удалось сохранить историю bot games:', error);
    }
}

function getResultTextForBotHistory(resultCode, message) {
    if (message) return message;
    if (resultCode === '1-0') return 'Победа белых';
    if (resultCode === '0-1') return 'Победа чёрных';
    if (resultCode === '1/2-1/2') return 'Ничья';
    return 'Игра окончена';
}

window.persistFinishedBotGame = function(data = {}) {
    if (!window.isBotMode || !window.game || window.isBotHistoryViewer) return;
    if (data?.gameState !== 'game_over' && !window.game.game_over?.()) return;

    const pgn = window.game.pgn?.() || '';
    if (!pgn.trim()) return;

    const metadata = window.applyGameHeaders(window.game, {
        gameState: 'game_over',
        message: data?.message || window.getGameResultMessage(window.game),
        resign: data?.resign
    });
    const timestamp = Date.now();
    const terminationReason = window.game.header?.('Termination') || data?.message || '';
    const historyPlyCount = window.game.history?.().length || 0;
    const signature = `${pgn}|${metadata.result}|${window.botLevel}|${window.playerColor}|${terminationReason}`;
    if (window.lastSavedBotGameSignature === signature) return;

    const existing = parseBotGamesHistory();
    if (window.currentBotSessionId && existing.some((entry) => entry?.sourceSessionId === window.currentBotSessionId)) {
        return;
    }
    if (existing.some((entry) => entry?.signature === signature)) {
        window.lastSavedBotGameSignature = signature;
        return;
    }

    const entry = {
        id: `bot_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
        completedAt: timestamp,
        botLevel: window.botLevel || 'medium',
        userColor: window.playerColor || 'w',
        result: metadata.result || '*',
        resultText: getResultTextForBotHistory(metadata.result, metadata.message),
        reason: terminationReason,
        pgn,
        plyCount: historyPlyCount,
        updatedAt: timestamp,
        sourceSessionId: window.currentBotSessionId,
        signature
    };

    persistBotGamesHistory([entry, ...existing]);
    window.lastSavedBotGameSignature = signature;
};

window.openBotHistoryViewer = function(gameId) {
    const entry = parseBotGamesHistory().find((item) => item?.id === gameId);
    if (!entry?.pgn) {
        window.notify('Не удалось открыть партию из истории', 'error', 2600);
        return;
    }

    initLocalGameState();
    window.isBotHistoryViewer = true;
    window.isArchivedFinishedView = true;
    window.isBotMode = true;
    window.playerColor = entry.userColor === 'b' ? 'b' : 'w';
    window.botColor = window.playerColor === 'w' ? 'b' : 'w';
    window.botLevel = window.BOT_LEVELS?.[entry.botLevel] ? entry.botLevel : 'medium';
    window.game = new Chess();
    const loaded = window.game.load_pgn(entry.pgn);
    if (!loaded) {
        window.notify('PGN партии повреждён', 'error', 2600);
        return;
    }
    window.lastKnownGameState = 'game_over';

    window.setGameSectionVisibility();
    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    if (window.playerColor === 'b') {
        window.board.orientation('black');
    }

    window.setupGameControls(null, null);
    window.syncReviewStateFromCurrentGame();
    const maxPly = window.game.history().length;
    window.enterReviewMode(maxPly);
    window.updateUI({ gameState: 'game_over', message: entry.resultText, mode: 'bot' });
    window.markGameReady?.();
};

window.renderBotGamesLobby = function() {
    const nodes = getLobbyNodes();
    const container = nodes.botGamesList;
    if (!container) return;

    const activeFilter = window.botGamesLevelFilter || 'all';
    const allGames = parseBotGamesHistory();
    const filtered = allGames.filter((entry) => activeFilter === 'all' || entry?.botLevel === activeFilter);

    const filters = [
        ['all', nodes.botGamesFilterAllBtn],
        ['easy', nodes.botGamesFilterEasyBtn],
        ['medium', nodes.botGamesFilterMediumBtn],
        ['hard', nodes.botGamesFilterHardBtn]
    ];
    filters.forEach(([value, button]) => {
        button?.classList.toggle('is-active', activeFilter === value);
    });

    container.innerHTML = '';
    if (!filtered.length) {
        container.innerHTML = '<div class="empty-lobby">История игр с Ичи пока пуста</div>';
        return;
    }

    filtered.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'game-item finished';
        const dateText = entry.completedAt ? new Date(entry.completedAt).toLocaleString('ru-RU') : 'Неизвестно';
        item.innerHTML = `
            <div class="game-accent" aria-hidden="true"></div>
            <div class="game-info">
                <div class="game-title-row">
                    <div class="game-opponent-wrap">
                        <span class="avatar-shell avatar-fallback">🤖</span>
                        <p class="game-opponent">Бот (${getBotLevelLabel(entry.botLevel)})</p>
                    </div>
                    <span class="game-status-pill finished">${entry.resultText || 'Игра окончена'}</span>
                </div>
                <div class="game-meta">
                    <span class="game-turn-pill opponent-turn">Вы: ${getUserColorLabel(entry.userColor)}</span>
                    <span class="game-finish-note">${entry.reason || 'Завершена штатно'}</span>
                    <span class="game-dot" aria-hidden="true">•</span>
                    <span class="game-time">${dateText}</span>
                </div>
            </div>
            <div class="game-actions">
                <button class="btn btn-sm bot-history-view-btn" type="button">Смотреть</button>
                <button class="btn btn-sm bot-history-copy-btn" type="button">Скопировать PGN</button>
                <button class="btn btn-primary btn-sm bot-history-replay-btn" type="button">Сыграть снова</button>
            </div>
        `;

        item.querySelector('.bot-history-view-btn')?.addEventListener('click', () => {
            window.openBotHistoryViewer(entry.id);
        });
        item.querySelector('.bot-history-copy-btn')?.addEventListener('click', async () => {
            if (!entry.pgn) return;
            try {
                await navigator.clipboard.writeText(entry.pgn);
                window.notify('PGN скопирован', 'success', 1800);
            } catch (error) {
                console.error('Ошибка копирования PGN bot history:', error);
                window.notify('Не удалось скопировать PGN', 'error', 2200);
            }
        });
        item.querySelector('.bot-history-replay-btn')?.addEventListener('click', () => {
            window.initBotGame({ color: entry.userColor || 'random', level: entry.botLevel || 'medium' });
        });

        container.appendChild(item);
    });
};

function syncLobbyGamesFilterVisibility(nodes, gamesList, finishedList) {
    if (!nodes || !gamesList || !finishedList) return;
    const showFinished = window.lobbyShowFinished;
    gamesList.classList.toggle('hidden', showFinished);
    finishedList.classList.toggle('hidden', !showFinished);
    nodes.showActiveGamesBtn?.classList.toggle('is-active', !showFinished);
    nodes.showFinishedGamesBtn?.classList.toggle('is-active', showFinished);
    nodes.clearFinishedBtn?.classList.toggle('hidden', !showFinished);
}

function updateGamesHubInviteIndicator(nodes, inviteCount = 0) {
    const hasInvites = inviteCount > 0;
    nodes?.hubGamesInviteDot?.classList.toggle('hidden', !hasInvites);
    nodes?.hubGamesInviteLabel?.classList.toggle('hidden', !hasInvites);
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
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => {
            const aData = a.entry[1];
            const bData = b.entry[1];
            const aOver = aData.gameState === 'game_over';
            const bOver = bData.gameState === 'game_over';

            if (aOver !== bOver) return aOver ? 1 : -1;

            const userId = window.currentUser?.uid || '';
            if (!aOver && !bOver && userId) {
                const aIsInvite = isDirectInvitePendingForRoom(a.entry[0], aData, userId);
                const bIsInvite = isDirectInvitePendingForRoom(b.entry[0], bData, userId);
                if (aIsInvite !== bIsInvite) return aIsInvite ? -1 : 1;

                const aIsMyTurn = isMyTurnForLobbyGame(aData, userId);
                const bIsMyTurn = isMyTurnForLobbyGame(bData, userId);
                if (aIsMyTurn !== bIsMyTurn) return aIsMyTurn ? -1 : 1;
            }

            const aTime = aData.lastMoveTime || aData.createdAt || 0;
            const bTime = bData.lastMoveTime || bData.createdAt || 0;
            if (aTime !== bTime) return bTime - aTime;
            return a.index - b.index;
        })
        .map(({ entry }) => entry);
}

function isMyTurnForLobbyGame(gameData, userId) {
    if (!gameData || !userId || gameData.gameState === 'game_over') return false;
    const players = gameData.players || {};
    const myColor = players.white === userId ? 'w' : (players.black === userId ? 'b' : null);
    if (!myColor) return false;
    const opponentUid = players.white === userId ? players.black : players.white;
    if (!opponentUid) return false;
    return resolveTurnColorCode(gameData) === myColor;
}

function getGameMoveCount(gameData) {
    if (!gameData) return 0;
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
    if (turn === 'W' || turn === 'WHITE') return 'w';
    if (turn === 'B' || turn === 'BLACK') return 'b';

    const fen = String(gameData?.fen || '').trim();
    if (fen) {
        const fenParts = fen.split(/\s+/);
        const fenTurn = fenParts[1];
        if (fenTurn === 'w' || fenTurn === 'b') {
            return fenTurn;
        }
    }

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

function getHandledDirectInviteIds() {
    try {
        const raw = localStorage.getItem(window.DIRECT_INVITE_HANDLED_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id) => typeof id === 'string'));
    } catch (error) {
        console.warn('Не удалось восстановить handled direct invites из localStorage:', error);
        return new Set();
    }
}

function persistHandledDirectInviteIds(idsSet) {
    try {
        const compact = Array.from(idsSet).slice(-300);
        localStorage.setItem(window.DIRECT_INVITE_HANDLED_STORAGE_KEY, JSON.stringify(compact));
    } catch (error) {
        console.warn('Не удалось сохранить handled direct invites в localStorage:', error);
    }
}

function getSeenRematchInviteIds() {
    try {
        const raw = localStorage.getItem(window.REMATCH_INVITE_SEEN_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id) => typeof id === 'string'));
    } catch (error) {
        console.warn('Не удалось восстановить seen rematch invites из localStorage:', error);
        return new Set();
    }
}

function persistSeenRematchInviteIds(idsSet) {
    try {
        const compact = Array.from(idsSet).slice(-300);
        localStorage.setItem(window.REMATCH_INVITE_SEEN_STORAGE_KEY, JSON.stringify(compact));
    } catch (error) {
        console.warn('Не удалось сохранить seen rematch invites в localStorage:', error);
    }
}

function buildRematchInviteSeenKey(roomId, rematchRequest) {
    const requestId = String(rematchRequest?.id || '').trim();
    if (!roomId || !requestId) return '';
    return `${roomId}:${requestId}`;
}

function markRematchInviteAsSeen(roomId, rematchRequest) {
    const inviteKey = buildRematchInviteSeenKey(roomId, rematchRequest);
    if (!inviteKey) return;
    window.lobbyNotifiedRematchInvites = window.lobbyNotifiedRematchInvites || getSeenRematchInviteIds();
    if (window.lobbyNotifiedRematchInvites.has(inviteKey)) return;
    window.lobbyNotifiedRematchInvites.add(inviteKey);
    persistSeenRematchInviteIds(window.lobbyNotifiedRematchInvites);
}

function markDirectInviteAsHandled(roomId) {
    if (!roomId) return;
    window.lobbyHandledDirectInvites = window.lobbyHandledDirectInvites || getHandledDirectInviteIds();
    if (window.lobbyHandledDirectInvites.has(roomId)) return;
    window.lobbyHandledDirectInvites.add(roomId);
    persistHandledDirectInviteIds(window.lobbyHandledDirectInvites);
}

function extractDirectInvite(data) {
    const invite = data?.players?.invite;
    if (!invite || invite.type !== 'direct_challenge') return null;
    return invite;
}

function resolveDirectInviteStatus(invite) {
    const rawStatus = invite?.status ?? invite?.state ?? invite?.inviteStatus;
    if (rawStatus === undefined || rawStatus === null) return '';
    return String(rawStatus).trim().toLowerCase();
}

function isDirectInviteRelevant(invite) {
    if (!invite) return false;

    const status = resolveDirectInviteStatus(invite);
    if (status) {
        const inactiveStatuses = new Set([
            'accepted',
            'declined',
            'rejected',
            'cancelled',
            'canceled',
            'expired',
            'handled',
            'resolved',
            'revoked',
            'withdrawn',
            'closed'
        ]);
        if (inactiveStatuses.has(status)) return false;
    }

    if (invite.acceptedAt || invite.declinedAt || invite.rejectedAt || invite.cancelledAt || invite.canceledAt || invite.handledAt) {
        return false;
    }

    if (Number.isFinite(invite.expiresAt) && invite.expiresAt <= Date.now()) {
        return false;
    }

    return true;
}

function shouldNotifyDirectInvite(data, userId) {
    const invite = extractDirectInvite(data);
    if (!invite) return false;
    if (!isDirectInviteRelevant(invite)) return false;
    return invite.targetUid === userId && invite.createdByUid !== userId;
}

function isDirectInvitePendingForRoom(roomId, data, userId) {
    const invite = extractDirectInvite(data);
    if (!invite || !roomId || !userId || data?.gameState === 'game_over') return false;
    if (!isDirectInviteRelevant(invite)) return false;
    if (invite.targetUid !== userId || invite.createdByUid === userId) return false;
    if (isGameStarted(data)) return false;
    return !window.lobbyHandledDirectInvites?.has?.(roomId);
}

function hasRoomBecameActiveForUser(previousData, currentData, userId) {
    const previousCard = previousData ? buildLobbyGameCardData('', previousData, userId) : null;
    const currentCard = buildLobbyGameCardData('', currentData, userId);

    if (!currentCard || currentCard.isOver || currentCard.isWaitingForOpponent) {
        return false;
    }

    if (!previousCard) return true;
    return previousCard.isOver || previousCard.isWaitingForOpponent;
}

function buildLobbyGameCardData(id, data, userId) {
    if (!data || typeof data !== 'object') return null;
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
    const rematchInvite = window.getRematchInvitationForUser(id, data, userId);
    const isDirectInvite = Boolean(invite);
    const hasStarted = isGameStarted(data);
    const isDirectInviteForMe = isDirectInvitePendingForRoom(id, data, userId);
    const isRematchInviteForMe = Boolean(rematchInvite);
    const isInviteForMe = isDirectInviteForMe || isRematchInviteForMe;
    const shouldSurfaceRematchInActive = isOver && isRematchInviteForMe;
    const showInviteStatus = isDirectInviteForMe || (isDirectInvite && !isOver && !hasStarted && isWaitingForOpponent);
    const showRematchInviteStatus = isRematchInviteForMe && isOver;
    const statusText = isOver
        ? resultState.label
        : (isWaitingForOpponent
            ? 'Ожидание'
            : (showInviteStatus
                ? (isInviteForMe ? 'Приглашение' : 'Приглашение отправлено')
                : ''));
    const effectiveStatusText = showRematchInviteStatus ? 'Реванш' : statusText;
    const stateClass = isOver ? 'finished' : (isWaitingForOpponent ? 'waiting' : 'active');
    const displaySection = shouldSurfaceRematchInActive ? 'active' : (isOver ? 'finished' : 'active');
    const resultComment = isOver ? window.getFinishedGameTerminationLabel(data) : '';
    const presenceSnapshot = getLobbyPresenceSnapshot(opponentUid, { isWaitingForOpponent });

    return {
        id,
        isOver,
        isWaitingForOpponent,
        isMyTurn,
        stateClass,
        myColor,
        opponentUid,
        opponent,
        opponentAvatar,
        opponentPresenceText: presenceSnapshot.text,
        opponentPresenceVariant: presenceSnapshot.variant,
        statusText: effectiveStatusText,
        isInviteForMe,
        isDirectInviteForMe,
        isRematchInviteForMe,
        displaySection,
        rematchInviteId: rematchInvite?.id || '',
        resultComment,
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
    item.className = `game-item ${cardData.stateClass} ${cardData.isMyTurn ? 'my-turn-focus' : ''} ${cardData.isInviteForMe ? 'invite-focus' : ''} ${cardData.resultClass || ''}`.trim();
    if (cardData.opponentUid) {
        item.dataset.opponentUid = cardData.opponentUid;
    }
    item.innerHTML = `
        <div class="game-accent" aria-hidden="true"></div>
        <div class="game-info">
            <div class="game-title-row">
                <div class="game-opponent-wrap">
                    ${getAvatarMarkup(cardData.opponent, cardData.opponentAvatar)}
                    <p class="game-opponent">${cardData.opponent}</p>
                </div>
                ${cardData.statusText ? `<span class="game-status-pill ${cardData.isInviteForMe ? 'invite' : cardData.stateClass} ${cardData.resultClass}">${cardData.statusText}</span>` : ''}
            </div>
            <div class="game-opponent-presence-line">
                <span class="game-opponent-presence-dot status-indicator-${cardData.opponentPresenceVariant || 'offline'}" aria-hidden="true"></span>
                <span class="game-opponent-presence-text" title="${cardData.opponentPresenceText}">${cardData.opponentPresenceText}</span>
            </div>
            <div class="game-meta">
                ${cardData.isInviteForMe ? '<span class="game-invite-dot" aria-hidden="true"></span><span class="game-turn-pill opponent-turn">Вас пригласили</span>' : ''}
                ${cardData.isMyTurn ? '<span class="game-my-turn-dot" aria-hidden="true"></span>' : ''}
                ${cardData.turnLabel ? `<span class="game-turn-pill ${cardData.turnClass}">${cardData.turnLabel}</span>` : ''}
                ${cardData.resultComment ? `<span class="game-finish-note">${cardData.resultComment}</span>` : ''}
                <span class="game-side">Вы ${cardData.myColor === 'white' ? 'белыми' : 'чёрными'}</span>
                <span class="game-dot" aria-hidden="true">•</span>
                <span class="game-time">${cardData.timeAgo}</span>
            </div>
        </div>
        <div class="game-actions">
            <button class="btn btn-sm play-btn">${cardData.isOver ? 'Смотреть' : 'Играть'}</button>
            <button class="btn btn-primary btn-sm rematch-btn ${cardData.isOver ? '' : 'hidden'}">Реванш</button>
            <button class="btn btn-sm delete-btn ${cardData.canDeleteFromLobby ? '' : 'hidden'}" data-game-id="${cardData.id}">Удалить</button>
        </div>
    `;

    item.querySelector('.play-btn').onclick = (event) => {
        event.stopPropagation();
        if (cardData.isDirectInviteForMe) {
            markDirectInviteAsHandled(cardData.id);
        } else if (cardData.isRematchInviteForMe && cardData.rematchInviteId) {
            markRematchInviteAsSeen(cardData.id, { id: cardData.rematchInviteId });
        }
        const viewParam = cardData.isOver ? '&view=finished' : '';
        location.href = `${location.origin}${location.pathname}?room=${cardData.id}${viewParam}`;
    };

    const rematchBtn = item.querySelector('.rematch-btn');
    if (rematchBtn && cardData.isOver) {
        rematchBtn.onclick = async (event) => {
            event.stopPropagation();
            const requesterUid = window.currentUser?.uid;
            if (!requesterUid) return;
            const result = await window.requestRematchFromRoom(cardData.id, requesterUid);
            if (!result) {
                window.notify('Не удалось отправить запрос реванша', 'error', 2800);
                return;
            }
            window.notify('Запрос реванша отправлен', 'success', 2600);
        };
    }

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

function clearLobbyGameCardState() {
    window.lobbyGameCardRegistry = new Map();
    window.lobbyRenderedCardSignatureByRoom = new Map();
}

function clearLobbyPlayerCardState() {
    window.lobbyPlayerCardRegistry = new Map();
    window.lobbyRenderedPlayerSignatureByUid = new Map();
}

function getLobbyCardSignature(cardData) {
    if (!cardData) return '';
    const signatureParts = [
        cardData.id || '',
        cardData.isOver ? '1' : '0',
        cardData.isWaitingForOpponent ? '1' : '0',
        cardData.isMyTurn ? '1' : '0',
        cardData.stateClass || '',
        cardData.myColor || '',
        cardData.opponentUid || '',
        cardData.opponent || '',
        cardData.opponentAvatar || '',
        cardData.opponentPresenceText || '',
        cardData.opponentPresenceVariant || '',
        cardData.statusText || '',
        cardData.isInviteForMe ? '1' : '0',
        cardData.resultComment || '',
        cardData.resultClass || '',
        cardData.turnLabel || '',
        cardData.turnClass || '',
        cardData.canDeleteFromLobby ? '1' : '0',
        cardData.timeAgo || ''
    ];
    return signatureParts.join('|');
}

function removeLobbySectionEmptyState(container) {
    if (!container) return;
    const emptyNode = container.querySelector(':scope > .empty-lobby');
    if (emptyNode) {
        emptyNode.remove();
    }
}

function renderActiveLobbyEmptyState(gamesList, createGameBtn) {
    if (!gamesList) return;
    gamesList.innerHTML = buildLobbyEmptyState().activeGames;
    bindLobbyEmptyStateActions(gamesList, createGameBtn);
}

function renderFinishedLobbyEmptyState(finishedGamesList) {
    if (!finishedGamesList) return;
    finishedGamesList.innerHTML = buildLobbyEmptyState().finishedGames;
}

function renderPlayersLobbyEmptyState(playersList) {
    if (!playersList) return;
    playersList.innerHTML = '<div class="empty-lobby">Нет соперников<br><small>Завершите или начните партию с игроком</small></div>';
}

function removeLobbyCardByRoomId(roomId) {
    if (!roomId) return;
    const existing = window.lobbyGameCardRegistry.get(roomId);
    if (existing?.node?.parentNode) {
        existing.node.parentNode.removeChild(existing.node);
    }
    window.lobbyGameCardRegistry.delete(roomId);
    window.lobbyRenderedCardSignatureByRoom.delete(roomId);
}

function removeLobbyPlayerCardByUid(uid) {
    if (!uid) return;
    const existing = window.lobbyPlayerCardRegistry.get(uid);
    if (existing?.node?.parentNode) {
        existing.node.parentNode.removeChild(existing.node);
    }
    window.lobbyPlayerCardRegistry.delete(uid);
    window.lobbyRenderedPlayerSignatureByUid.delete(uid);
}

function buildPlayerLobbyCardData(player) {
    const selectedFilter = window.playersExpandedResultFilter?.[player.uid] || '';
    const selectedGames = selectedFilter ? (player.finishedGames?.[selectedFilter] || []) : [];
    const selectedGamesSorted = selectedGames
        .slice()
        .sort((a, b) => (b.data.lastMoveTime || b.data.createdAt || 0) - (a.data.lastMoveTime || a.data.createdAt || 0));

    const selectedGameCards = selectedGamesSorted
        .map((gameEntry) => {
            const cardData = buildLobbyGameCardData(gameEntry.id, gameEntry.data, window.currentUser?.uid || '');
            if (!cardData) return null;
            return { id: gameEntry.id, cardData };
        })
        .filter(Boolean);

    return {
        ...player,
        selectedFilter,
        selectedGameCards
    };
}

function getPlayerLobbyCardSignature(playerCardData) {
    if (!playerCardData) return '';
    const finishedCardsSignature = playerCardData.selectedGameCards
        .map((entry) => getLobbyCardSignature(entry.cardData))
        .join('||');
    const signatureParts = [
        playerCardData.uid || '',
        playerCardData.name || '',
        playerCardData.avatarUrl || '',
        String(playerCardData.wins || 0),
        String(playerCardData.losses || 0),
        String(playerCardData.draws || 0),
        playerCardData.selectedFilter || '',
        finishedCardsSignature
    ];
    return signatureParts.join('|');
}

function createPlayersLobbyElement(container, player) {
    const playerItem = document.createElement('div');
    playerItem.className = 'player-item';
    playerItem.dataset.playerUid = player.uid;
    const presenceText = window.getPresenceText?.(player.uid) || 'не в сети';

    playerItem.innerHTML = `
        <div class="player-item-header">
            <div class="player-info">
                <div class="player-name-row">${getAvatarMarkup(player.name, player.avatarUrl)} <b>${player.name}</b></div>
                <div class="player-presence-line">${presenceText}</div>
                <div class="player-stats">
                    <button class="player-stat-pill player-stat-pill-win ${player.selectedFilter === 'wins' ? 'is-active' : ''}" type="button" data-result-filter="wins">Выиграно: ${player.wins}</button>
                    <button class="player-stat-pill player-stat-pill-loss ${player.selectedFilter === 'losses' ? 'is-active' : ''}" type="button" data-result-filter="losses">Проиграно: ${player.losses}</button>
                    <button class="player-stat-pill player-stat-pill-draw ${player.selectedFilter === 'draws' ? 'is-active' : ''}" type="button" data-result-filter="draws">Ничьи: ${player.draws}</button>
                </div>
            </div>
            <div class="game-actions">
                <button class="btn btn-sm play-btn player-play-btn">Играть</button>
            </div>
        </div>
        ${player.selectedFilter ? `
            <div class="player-finished-list">
                ${player.selectedGameCards.length ? '' : '<div class="empty-lobby">Подходящих завершённых партий пока нет</div>'}
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
            window.playersExpandedResultFilter[player.uid] = player.selectedFilter === nextFilter ? '' : nextFilter;
            incrementalUpdatePlayersLobby(container, window.lobbyLastPlayersAggregate || []);
        };
    });

    if (player.selectedFilter && player.selectedGameCards.length) {
        const listNode = playerItem.querySelector('.player-finished-list');
        player.selectedGameCards.forEach((entry) => {
            const cardNode = createLobbyGameElement(entry.cardData, window.currentUser?.uid || '');
            cardNode.classList.add('player-finished-card');
            listNode.appendChild(cardNode);
        });
    }

    bindAvatarFallbackHandlers(playerItem);
    return playerItem;
}

function createOrUpdatePlayerLobbyCardNode({ container, playerCardData }) {
    if (!container || !playerCardData?.uid) return null;

    const uid = playerCardData.uid;
    const nextSignature = getPlayerLobbyCardSignature(playerCardData);
    const existing = window.lobbyPlayerCardRegistry.get(uid);
    const previousSignature = window.lobbyRenderedPlayerSignatureByUid.get(uid);
    const hasChanged = previousSignature !== nextSignature;

    let node = existing?.node || null;
    if (!node || hasChanged) {
        const nextNode = createPlayersLobbyElement(container, playerCardData);
        if (node?.parentNode) {
            node.parentNode.replaceChild(nextNode, node);
        }
        node = nextNode;
    }

    container.appendChild(node);
    window.lobbyPlayerCardRegistry.set(uid, { node });
    window.lobbyRenderedPlayerSignatureByUid.set(uid, nextSignature);
    return node;
}

function incrementalUpdatePlayersLobby(container, players) {
    if (!container) return;
    const safePlayers = Array.isArray(players) ? players : [];

    if (!safePlayers.length) {
        clearLobbyPlayerCardState();
        renderPlayersLobbyEmptyState(container);
        return;
    }

    const seenUids = new Set();
    const playersWithViewState = safePlayers.map((player) => buildPlayerLobbyCardData(player));
    playersWithViewState.forEach((playerCardData) => {
        seenUids.add(playerCardData.uid);
        removeLobbySectionEmptyState(container);
        createOrUpdatePlayerLobbyCardNode({
            container,
            playerCardData
        });
    });

    Array.from(window.lobbyPlayerCardRegistry.keys()).forEach((uid) => {
        if (seenUids.has(uid)) return;
        removeLobbyPlayerCardByUid(uid);
    });
}

function createOrUpdateLobbyCardNode({ roomId, cardData, userId, targetList, targetSection }) {
    if (!roomId || !cardData || !targetList) return null;

    const nextSignature = getLobbyCardSignature(cardData);
    const existing = window.lobbyGameCardRegistry.get(roomId);
    const previousSignature = window.lobbyRenderedCardSignatureByRoom.get(roomId);
    const hasChanged = previousSignature !== nextSignature;
    const hasSectionChanged = existing?.section && existing.section !== targetSection;

    let node = existing?.node || null;
    if (!node || hasChanged || hasSectionChanged) {
        const nextNode = createLobbyGameElement(cardData, userId);
        if (node?.parentNode) {
            node.parentNode.replaceChild(nextNode, node);
        }
        node = nextNode;
    }

    targetList.appendChild(node);
    window.lobbyGameCardRegistry.set(roomId, { node, section: targetSection });
    window.lobbyRenderedCardSignatureByRoom.set(roomId, nextSignature);
    return node;
}

function fullRebuildLobbyGames({ sortedGames, userId, gamesList, finishedGamesList, createGameBtn }) {
    if (!gamesList) return { pendingInvitesCount: 0 };

    gamesList.innerHTML = '';
    if (finishedGamesList) finishedGamesList.innerHTML = '';
    clearLobbyGameCardState();

    let hasActiveGames = false;
    let hasFinishedGames = false;
    let pendingInvitesCount = 0;

    sortedGames.forEach(([id, data]) => {
        const cardData = buildLobbyGameCardData(id, data, userId);
        if (!cardData) return;
        if (cardData.isInviteForMe) pendingInvitesCount += 1;

        const targetSection = cardData.displaySection || (cardData.isOver ? 'finished' : 'active');
        const targetList = targetSection === 'finished' ? finishedGamesList : gamesList;
        if (!targetList) return;
        createOrUpdateLobbyCardNode({
            roomId: id,
            cardData,
            userId,
            targetList,
            targetSection
        });

        if (targetSection === 'finished') {
            hasFinishedGames = true;
        } else {
            hasActiveGames = true;
        }
    });

    if (!hasActiveGames) {
        renderActiveLobbyEmptyState(gamesList, createGameBtn);
    }
    if (!hasFinishedGames) {
        renderFinishedLobbyEmptyState(finishedGamesList);
    }

    return { pendingInvitesCount };
}

function incrementalUpdateLobbyGames({ sortedGames, userId, gamesList, finishedGamesList, createGameBtn }) {
    if (!gamesList) return { pendingInvitesCount: 0 };

    const seenRoomIds = new Set();
    let hasActiveGames = false;
    let hasFinishedGames = false;
    let pendingInvitesCount = 0;

    sortedGames.forEach(([id, data]) => {
        const cardData = buildLobbyGameCardData(id, data, userId);
        if (!cardData) return;
        seenRoomIds.add(id);
        if (cardData.isInviteForMe) pendingInvitesCount += 1;

        const targetSection = cardData.displaySection || (cardData.isOver ? 'finished' : 'active');
        const targetList = targetSection === 'finished' ? finishedGamesList : gamesList;
        if (!targetList) return;
        removeLobbySectionEmptyState(targetList);
        createOrUpdateLobbyCardNode({
            roomId: id,
            cardData,
            userId,
            targetList,
            targetSection
        });

        if (targetSection === 'finished') {
            hasFinishedGames = true;
        } else {
            hasActiveGames = true;
        }
    });

    Array.from(window.lobbyGameCardRegistry.keys()).forEach((roomId) => {
        if (seenRoomIds.has(roomId)) return;
        removeLobbyCardByRoomId(roomId);
    });

    if (!hasActiveGames) {
        renderActiveLobbyEmptyState(gamesList, createGameBtn);
    }
    if (!hasFinishedGames) {
        renderFinishedLobbyEmptyState(finishedGamesList);
    }

    return { pendingInvitesCount };
}

function flushLobbyDomUpdate() {
    const payload = window.__lobbyDomFlushPayload;
    if (!payload) return;
    window.__lobbyDomFlushPayload = null;

    const {
        games,
        nodes,
        gamesList,
        finishedGamesList,
        playersList,
        userId,
        wasFirstSnapshot,
        nextSnapshotByGame
    } = payload;

    try {
        if (!games) {
            window.lobbyLastSnapshotByGame = new Map();
            clearLobbyGameCardState();
            clearLobbyPlayerCardState();
            const empty = buildLobbyEmptyState();
            if (gamesList) {
                gamesList.innerHTML = empty.activeGames;
                bindLobbyEmptyStateActions(gamesList, nodes.createGameBtn);
            }
            if (finishedGamesList) finishedGamesList.innerHTML = empty.finishedGames;
            if (playersList) playersList.innerHTML = empty.players;
            window.lobbyLastPlayersAggregate = [];
            updateGamesHubInviteIndicator(nodes, 0);
            return;
        }

        const sortedGames = sortLobbyGames(games);
        let pendingInvitesCount = 0;
        try {
            const updateResult = wasFirstSnapshot
                ? fullRebuildLobbyGames({
                    sortedGames,
                    userId,
                    gamesList,
                    finishedGamesList,
                    createGameBtn: nodes.createGameBtn
                })
                : incrementalUpdateLobbyGames({
                    sortedGames,
                    userId,
                    gamesList,
                    finishedGamesList,
                    createGameBtn: nodes.createGameBtn
                });

            pendingInvitesCount = updateResult.pendingInvitesCount || 0;
        } catch (error) {
            console.error('Ошибка точечного обновления DOM лобби, выполняем fallback rebuild:', error);
            const rebuildResult = fullRebuildLobbyGames({
                sortedGames,
                userId,
                gamesList,
                finishedGamesList,
                createGameBtn: nodes.createGameBtn
            });
            pendingInvitesCount = rebuildResult.pendingInvitesCount || 0;
        }

        syncLobbyGamesFilterVisibility(nodes, gamesList, finishedGamesList);
        updateGamesHubInviteIndicator(nodes, pendingInvitesCount);

        const playersAggregate = window.buildPlayersAggregate(sortedGames, userId);
        window.lobbyLastPlayersAggregate = playersAggregate;
        incrementalUpdatePlayersLobby(playersList, playersAggregate);
        const visiblePresenceUids = window.collectVisiblePresenceUids?.() || [];
        window.setTrackedPresenceUids?.(visiblePresenceUids);
        window.ensurePresenceForUsers?.(visiblePresenceUids);
        window.refreshLobbyPresenceLabels?.();
        window.lobbyLastSnapshotByGame = nextSnapshotByGame;
    } catch (error) {
        console.error('flushLobbyDomUpdate: критическая ошибка рендера лобби', error);
    } finally {
        if (!window.lobbyHasProcessedFirstSnapshot) {
            window.markLobbyReady?.();
        }
        window.lobbyHasProcessedFirstSnapshot = true;
    }
}

function scheduleLobbyDomUpdate(payload) {
    window.__lobbyDomFlushPayload = payload;
    if (window.__lobbyDomFlushTimer) return;

    window.__lobbyDomFlushTimer = setTimeout(() => {
        window.__lobbyDomFlushTimer = null;
        flushLobbyDomUpdate();
    }, window.LOBBY_DOM_FLUSH_DEBOUNCE_MS || 140);
}

window.clearPendingLobbyDomFlush = function() {
    window.__lobbyDomFlushPayload = null;
    if (window.__lobbyDomFlushTimer) {
        clearTimeout(window.__lobbyDomFlushTimer);
        window.__lobbyDomFlushTimer = null;
    }
};

function bindLobbyEmptyStateActions(container, createGameBtn) {
    const emptyActionBtn = container.querySelector('[data-empty-action="create-game"]');
    if (!emptyActionBtn || !createGameBtn) return;
    emptyActionBtn.onclick = () => createGameBtn.click();
}

window.initLobby = function() {
    const nodes = getLobbyNodes();
    window.bindTopBrandHomeAction?.();
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
    if (nodes.hubOpenBotGamesBtn) {
        nodes.hubOpenBotGamesBtn.onclick = () => {
            window.setLobbyScreen('bot-games');
            window.renderBotGamesLobby?.();
        };
    }
    if (nodes.hubOpenTrainingBtn) {
        nodes.hubOpenTrainingBtn.onclick = () => {
            nodes.trainingModeModal?.classList.remove('hidden');
        };
    }
    if (nodes.hubOpenPassAndPlayBtn) {
        nodes.hubOpenPassAndPlayBtn.onclick = () => {
            syncPassAndPlayModeModalState(nodes);
            nodes.passAndPlayModeModal?.classList.remove('hidden');
        };
    }
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
    if (nodes.botGameCancelBtn) {
        nodes.botGameCancelBtn.onclick = () => closeBotGameModal(nodes.botGameModal);
    }
    if (nodes.trainingModeCancelBtn) {
        nodes.trainingModeCancelBtn.onclick = () => closeTrainingModeModal(nodes.trainingModeModal);
    }
    if (nodes.passAndPlayModeCancelBtn) {
        nodes.passAndPlayModeCancelBtn.onclick = () => closePassAndPlayModeModal(nodes.passAndPlayModeModal);
    }
    if (nodes.botGameStartBtn) {
        nodes.botGameStartBtn.onclick = () => {
            const color = nodes.botColorSelect?.value || 'random';
            const level = nodes.botLevelSelect?.value || 'medium';
            closeBotGameModal(nodes.botGameModal);
            window.initBotGame({ color, level });
        };
    }
    if (nodes.trainingModeSelfBtn) {
        nodes.trainingModeSelfBtn.onclick = () => {
            closeTrainingModeModal(nodes.trainingModeModal);
            window.initTrainingGame({ mode: 'self' });
        };
    }
    if (nodes.passAndPlayModeStandardBtn) {
        nodes.passAndPlayModeStandardBtn.onclick = () => {
            closePassAndPlayModeModal(nodes.passAndPlayModeModal);
            window.clearPassAndPlayGameSnapshot?.();
            window.initPassAndPlayGame({ variant: 'standard' });
        };
    }
    if (nodes.passAndPlayModeResumeBtn) {
        nodes.passAndPlayModeResumeBtn.onclick = () => {
            closePassAndPlayModeModal(nodes.passAndPlayModeModal);
            const hasResumed = window.resumePassAndPlayGame?.();
            if (!hasResumed) {
                window.notify('Не удалось загрузить сохранённую партию. Запускаю новую.', 'warning', 2600);
                window.clearPassAndPlayGameSnapshot?.();
                window.initPassAndPlayGame({ variant: 'standard' });
            }
        };
    }
    if (nodes.passAndPlayModeNewGameBtn) {
        nodes.passAndPlayModeNewGameBtn.onclick = () => {
            closePassAndPlayModeModal(nodes.passAndPlayModeModal);
            window.clearPassAndPlayGameSnapshot?.();
            window.initPassAndPlayGame({ variant: 'standard' });
        };
    }
    nodes.createGameModal.onclick = (event) => {
        if (event.target === nodes.createGameModal) closeCreateGameModal(nodes.createGameModal);
    };
    if (nodes.botGameModal) {
        nodes.botGameModal.onclick = (event) => {
            if (event.target === nodes.botGameModal) closeBotGameModal(nodes.botGameModal);
        };
    }
    if (nodes.trainingModeModal) {
        nodes.trainingModeModal.onclick = (event) => {
            if (event.target === nodes.trainingModeModal) closeTrainingModeModal(nodes.trainingModeModal);
        };
    }
    if (nodes.passAndPlayModeModal) {
        nodes.passAndPlayModeModal.onclick = (event) => {
            if (event.target === nodes.passAndPlayModeModal) closePassAndPlayModeModal(nodes.passAndPlayModeModal);
        };
    }
    window.lobbyShowFinished = false;
    const gamesListNode = document.getElementById('games-list');
    syncLobbyGamesFilterVisibility(nodes, gamesListNode, nodes.finishedGamesList);

    if (nodes.showActiveGamesBtn) {
        nodes.showActiveGamesBtn.onclick = () => {
            window.lobbyShowFinished = false;
            syncLobbyGamesFilterVisibility(nodes, gamesListNode, nodes.finishedGamesList);
        };
    }
    if (nodes.showFinishedGamesBtn) {
        nodes.showFinishedGamesBtn.onclick = () => {
            window.lobbyShowFinished = true;
            syncLobbyGamesFilterVisibility(nodes, gamesListNode, nodes.finishedGamesList);
        };
    }

    if (nodes.botGamesNewBtn) {
        nodes.botGamesNewBtn.onclick = () => {
            if (nodes.botColorSelect) nodes.botColorSelect.value = 'random';
            if (nodes.botLevelSelect) nodes.botLevelSelect.value = 'medium';
            nodes.botGameModal?.classList.remove('hidden');
        };
    }

    const bindBotFilter = (btn, value) => {
        if (!btn) return;
        btn.onclick = () => {
            window.botGamesLevelFilter = value;
            window.renderBotGamesLobby?.();
        };
    };
    bindBotFilter(nodes.botGamesFilterAllBtn, 'all');
    bindBotFilter(nodes.botGamesFilterEasyBtn, 'easy');
    bindBotFilter(nodes.botGamesFilterMediumBtn, 'medium');
    bindBotFilter(nodes.botGamesFilterHardBtn, 'hard');

    window.setLobbyScreen('hub');
    window.renderBotGamesLobby?.();
    if (!window.__lobbyPresenceWatcherBound) {
        window.watchPresenceLayer?.((changedUid) => window.refreshLobbyPresenceLabels?.(changedUid));
        window.__lobbyPresenceWatcherBound = true;
    }
};

// Загрузка игр в лобби
window.loadLobby = function(user) {
    window.setAppAuthView?.(true);
    window.renderBotGamesLobby?.();
    window.lobbyNotifiedDirectChallenges = getSeenDirectChallengeIds();
    window.lobbyNotifiedRematchInvites = getSeenRematchInviteIds();
    window.lobbyHandledDirectInvites = getHandledDirectInviteIds();
    window.lobbyLastSnapshotByGame = new Map();
    window.lobbyLastEventSnapshotByGame = new Map();
    window.lobbyLastPlayersAggregate = [];
    clearLobbyGameCardState();
    clearLobbyPlayerCardState();
    window.lobbyHasProcessedFirstSnapshot = false;
    window.clearPendingLobbyDomFlush?.();
    if (typeof window.__lobbyWatchUnsubscribe === 'function') {
        window.__lobbyWatchUnsubscribe();
        window.__lobbyWatchUnsubscribe = null;
    }

    const nodes = getLobbyNodes();
    const gamesList = document.getElementById('games-list');
    const finishedGamesList = nodes.finishedGamesList;
    const playersList = document.getElementById('players-list');
    window.__lobbyWatchUnsubscribe = window.watchGames((snap) => {
        const games = snap.val();
        const wasFirstSnapshot = !window.lobbyHasProcessedFirstSnapshot;
        const nextSnapshotByGame = new Map();
        let shouldPersistSeenIds = false;
        let shouldPersistRematchSeenIds = false;

        Object.entries(games || {}).forEach(([id, data]) => {
            const previousData = window.lobbyLastEventSnapshotByGame.get(id) || null;
            nextSnapshotByGame.set(id, data);
            const cardData = buildLobbyGameCardData(id, data, user.uid);
            if (!cardData) return;

            const rematchInvite = window.getRematchInvitationForUser(id, data, user.uid);
            const previousRematchInvite = window.getRematchInvitationForUser(id, previousData, user.uid);
            const rematchInviteKey = rematchInvite?.id ? `${id}:${rematchInvite.id}` : '';

            if (wasFirstSnapshot && isDirectInvitePendingForRoom(id, data, user.uid) && !window.lobbyNotifiedDirectChallenges.has(id)) {
                window.lobbyNotifiedDirectChallenges.add(id);
                shouldPersistSeenIds = true;
            }

            if (wasFirstSnapshot && rematchInviteKey && !window.lobbyNotifiedRematchInvites.has(rematchInviteKey)) {
                window.lobbyNotifiedRematchInvites.add(rematchInviteKey);
                shouldPersistRematchSeenIds = true;
            }

            const isNewDirectInviteAfterInit = !wasFirstSnapshot
                && shouldNotifyDirectInvite(data, user.uid)
                && !extractDirectInvite(previousData);
            if (isNewDirectInviteAfterInit && !window.lobbyNotifiedDirectChallenges.has(id)) {
                const invite = extractDirectInvite(data);
                window.lobbyNotifiedDirectChallenges.add(id);
                shouldPersistSeenIds = true;
                window.notify(`${invite.createdByName || 'Игрок'} приглашает вас в новую партию`, 'info', 4200);
                window.SoundManager?.play?.('modal_open');
            }

            const isNewRematchInviteAfterInit = !wasFirstSnapshot
                && Boolean(rematchInvite)
                && !previousRematchInvite;
            if (isNewRematchInviteAfterInit && rematchInviteKey && !window.lobbyNotifiedRematchInvites.has(rematchInviteKey)) {
                window.lobbyNotifiedRematchInvites.add(rematchInviteKey);
                shouldPersistRematchSeenIds = true;
                window.notify(`${cardData.opponent} приглашает на реванш`, 'info', 4200);
                window.SoundManager?.play?.('modal_open');
            }

            if (!wasFirstSnapshot && hasRoomBecameActiveForUser(previousData, data, user.uid)) {
                window.notify(`Новая активная партия с ${cardData.opponent}`, 'success', 3200);
            }
        });
        if (shouldPersistSeenIds) {
            persistSeenDirectChallengeIds(window.lobbyNotifiedDirectChallenges);
        }
        if (shouldPersistRematchSeenIds) {
            persistSeenRematchInviteIds(window.lobbyNotifiedRematchInvites);
        }
        window.lobbyLastEventSnapshotByGame = nextSnapshotByGame;

        scheduleLobbyDomUpdate({
            games,
            nodes,
            gamesList,
            finishedGamesList,
            playersList,
            userId: user.uid,
            wasFirstSnapshot,
            nextSnapshotByGame
        });
    });
};

window.collectVisiblePresenceUids = function() {
    const uids = new Set();
    document.querySelectorAll('[data-opponent-uid]').forEach((node) => {
        const uid = String(node.dataset.opponentUid || '').trim();
        if (uid) uids.add(uid);
    });
    document.querySelectorAll('[data-player-uid]').forEach((node) => {
        const uid = String(node.dataset.playerUid || '').trim();
        if (uid) uids.add(uid);
    });
    if (window.currentUser?.uid) uids.add(window.currentUser.uid);
    return Array.from(uids);
};

window.buildPlayersAggregate = function(sortedGames, userId) {
    const opponentsMap = new Map();

    sortedGames.forEach(([gameId, data]) => {
        if (!data || typeof data !== 'object') return;
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
    incrementalUpdatePlayersLobby(container, players);
};

window.refreshLobbyPresenceLabels = function(changedUid = null) {
    const targetUid = typeof changedUid === 'string' && changedUid.trim() ? changedUid : null;

    document.querySelectorAll('[data-opponent-uid]').forEach((node) => {
        const uid = node.dataset.opponentUid;
        if (targetUid && uid !== targetUid) return;
        const presenceTextNode = node.querySelector('.game-opponent-presence-text');
        const presenceDotNode = node.querySelector('.game-opponent-presence-dot');
        if (!uid || !presenceTextNode || !presenceDotNode) return;
        const presenceSnapshot = getLobbyPresenceSnapshot(uid);
        presenceTextNode.textContent = presenceSnapshot.text;
        presenceTextNode.title = presenceSnapshot.text;
        if (typeof window.applyStatusIndicatorClass === 'function') {
            window.applyStatusIndicatorClass(presenceDotNode, presenceSnapshot.variant || 'offline');
        }
    });

    document.querySelectorAll('[data-player-uid]').forEach((node) => {
        const uid = node.dataset.playerUid;
        if (targetUid && uid !== targetUid) return;
        const presenceNode = node.querySelector('.player-presence-line');
        if (!uid || !presenceNode) return;
        presenceNode.textContent = window.getPresenceText?.(uid) || 'не в сети';
    });
};

// Инициализация игры
window.setGameSectionVisibility = function() {
    document.getElementById('game-section').classList.remove('hidden');
    document.getElementById('lobby-section').classList.add('hidden');
    window.updateTopLobbyBrandVisibility?.();
};

function initLocalGameState() {
    if (typeof window.__gameWatchUnsubscribe === 'function') {
        window.__gameWatchUnsubscribe();
        window.__gameWatchUnsubscribe = null;
    }
    window.stopBotGame?.();
    window.game = new Chess();
    window.currentRoomId = null;
    window.isBotMode = false;
    window.isTrainingMode = false;
    window.trainingModeType = null;
    window.isPassAndPlayMode = false;
    window.passAndPlayVariant = null;
    window.botColor = null;
    window.botLevel = 'medium';
    window.botEngine = null;
    window.isBotThinking = false;
    window.isBotHistoryViewer = false;
    window.currentBotSessionId = null;
    window.isArchivedFinishedView = false;
    window.pendingDraw = null;
    window.pendingTakeback = null;
    window.pendingRematch = null;
    document.getElementById('rematch-request-box')?.classList.add('hidden');
    document.getElementById('promotion-choice-box')?.classList.add('hidden');
    window.playerColor = null;
    // Для каждой новой/переоткрытой партии первый remote PGN sync должен считаться initial (без звука).
    window.hasInitializedRemotePgnSync = false;
    window.lastKnownGameState = null;
    window.lastPlayedGameOverSoundKey = null;
    window.lastMoveSequenceEndgameMarker = null;
    window.lastRenderedMoveHistoryLength = 0;
    window.resetGameSoundFlags?.();
    window.syncReviewStateFromCurrentGame();
    window.activeReactions = [];
    window.reactionRateLimitState = { cycleKey: window.getReactionCycleKey(), count: 0 };
    window.activeQuickPhrase = null;
    window.quickPhraseRateLimitState = { cycleKey: window.getQuickPhraseCycleKey(), count: 0 };
    window.resetQuickPhraseUiState?.();
    window.shouldAutoEnterFinishedReview = false;
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
    if (typeof window.__gameWatchUnsubscribe === 'function') {
        window.__gameWatchUnsubscribe();
    }
    window.__gameWatchUnsubscribe = window.watchGame(gameRef, (snap) => {
        const data = snap.val();
        if (!data) return;
        window.setActiveReactionsFromState(data.reactions || []);
        window.setActiveQuickPhraseFromState(data.quickPhrase || null);
        window.applyRemotePgnUpdate(data.pgn);
        window.updateUI(data);
        const startedRematchRoomId = data?.rematchRequest?.startedRoomId;
        if (
            startedRematchRoomId &&
            window.resolveRematchStatus?.(data.rematchRequest) === 'resolved' &&
            startedRematchRoomId !== window.currentRoomId
        ) {
            location.href = `${location.origin}${location.pathname}?room=${startedRematchRoomId}`;
            return;
        }
        if (data.gameState === 'game_over') {
            const alreadyHandledByMoveSequence = window.wasCurrentEndgameHandledByMoveSequence?.();
            if (!alreadyHandledByMoveSequence) {
                window.playGameOverSoundForCurrentClient?.(data);
            }
        }
        if (window.shouldAutoEnterFinishedReview && data.gameState === 'game_over' && typeof window.enterReviewMode === 'function') {
            const maxPly = window.game?.history?.().length || 0;
            window.enterReviewMode(maxPly);
            window.shouldAutoEnterFinishedReview = false;
        }
    });
}


window.stopBotGame = function() {
    if (window.botEngine && typeof window.botEngine.destroy === 'function') {
        window.botEngine.destroy();
    }
    window.botEngine = null;
    window.isBotThinking = false;
};

window.initBotGame = function({ color = 'random', level = 'medium' } = {}) {
    const normalizedColor = color === 'w' || color === 'b'
        ? color
        : (Math.random() < 0.5 ? 'w' : 'b');
    const normalizedLevel = window.BOT_LEVELS?.[level] ? level : 'medium';

    window.stopBotGame();
    initLocalGameState();

    window.isBotMode = true;
    window.currentBotSessionId = `bot_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    window.playerColor = normalizedColor;
    window.botColor = normalizedColor === 'w' ? 'b' : 'w';
    window.botLevel = normalizedLevel;

    window.setGameSectionVisibility();
    window.currentRoomId = null;

    const roomLink = document.getElementById('room-link');
    if (roomLink) {
        roomLink.value = '';
    }

    const params = new URLSearchParams(window.location.search);
    params.set('bot', '1');
    params.set('color', normalizedColor);
    params.set('level', normalizedLevel);
    params.delete('training');
    params.delete('local');
    params.delete('variant');
    params.delete('mode');
    params.delete('room');
    params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    if (window.playerColor === 'b') {
        window.board.orientation('black');
    }

    document.getElementById('game-modal')?.classList.add('hidden');
    document.getElementById('takeback-request-box')?.classList.add('hidden');
    document.getElementById('draw-request-box')?.classList.add('hidden');
    document.getElementById('rematch-request-box')?.classList.add('hidden');
    document.getElementById('promotion-choice-box')?.classList.add('hidden');

    window.setupGameControls(null, null);
    window.syncReviewStateFromCurrentGame();
    window.lastKnownGameState = 'active';
    window.updateUI({ gameState: 'active', mode: 'bot' });
    window.refreshPresenceUI?.();

    window.botEngine = window.createBotEngine ? window.createBotEngine(normalizedLevel) : null;

    if (!window.botEngine) {
        window.notify('Не удалось запустить движок. Проверьте файлы Stockfish.', 'error', 3600);
    }

    if (window.game.turn() === window.botColor) {
        window.requestBotMove?.();
    }

    window.markGameReady?.();
};

window.initTrainingGame = function({ mode = 'self' } = {}) {
    const normalizedMode = mode === 'self' ? 'self' : 'self';

    window.stopBotGame();
    initLocalGameState();

    window.isTrainingMode = true;
    window.trainingModeType = normalizedMode;
    window.playerColor = 'w';

    window.setGameSectionVisibility();
    window.currentRoomId = null;

    const roomLink = document.getElementById('room-link');
    if (roomLink) {
        roomLink.value = '';
    }

    const params = new URLSearchParams(window.location.search);
    params.set('training', '1');
    params.set('mode', normalizedMode);
    params.delete('local');
    params.delete('variant');
    params.delete('room');
    params.delete('bot');
    params.delete('color');
    params.delete('level');
    params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    window.board?.orientation?.('white');

    document.getElementById('game-modal')?.classList.add('hidden');
    document.getElementById('takeback-request-box')?.classList.add('hidden');
    document.getElementById('draw-request-box')?.classList.add('hidden');
    document.getElementById('rematch-request-box')?.classList.add('hidden');
    document.getElementById('promotion-choice-box')?.classList.add('hidden');

    window.setupGameControls(null, null);
    window.syncReviewStateFromCurrentGame();
    window.lastKnownGameState = 'active';
    window.updateUI({ gameState: 'active', mode: 'training', trainingMode: normalizedMode });
    window.refreshPresenceUI?.();
    window.markGameReady?.();
};

window.syncPassAndPlayBoardOrientation = function() {
    if (!window.isPassAndPlayStandardMode?.() || !window.board || !window.game) return;
    const orientation = window.game.turn() === 'b' ? 'black' : 'white';
    window.board.orientation(orientation);
    window.reapplyPersistentBoardHighlights?.(window.game.fen());
};

function applyPassAndPlayCommonUi(normalizedVariant) {
    window.updatePlayerBadge();
    window.initBoard(window.playerColor);
    window.syncPassAndPlayBoardOrientation?.();

    document.getElementById('game-modal')?.classList.add('hidden');
    document.getElementById('takeback-request-box')?.classList.add('hidden');
    document.getElementById('draw-request-box')?.classList.add('hidden');
    document.getElementById('rematch-request-box')?.classList.add('hidden');
    document.getElementById('promotion-choice-box')?.classList.add('hidden');

    window.setupGameControls(null, null);
    window.syncReviewStateFromCurrentGame();
    const nextState = window.game?.game_over?.() ? 'game_over' : 'active';
    window.lastKnownGameState = nextState;
    window.updateUI({ gameState: nextState, mode: 'pass', variant: normalizedVariant });
    window.refreshPresenceUI?.();
    window.markGameReady?.();
}

window.resumePassAndPlayGame = function() {
    const snapshot = window.loadPassAndPlayGameSnapshot?.();
    if (!snapshot) return false;

    const normalizedVariant = 'standard';
    window.stopBotGame();
    initLocalGameState();

    window.isPassAndPlayMode = true;
    window.passAndPlayVariant = normalizedVariant;
    window.currentRoomId = null;

    const restoredGame = new Chess();
    let restored = false;
    if (typeof snapshot.pgn === 'string' && snapshot.pgn.trim()) {
        restored = restoredGame.load_pgn(snapshot.pgn);
    }
    if (!restored && Array.isArray(snapshot.history) && snapshot.history.length > 0) {
        restored = snapshot.history.every((sanMove) => restoredGame.move(sanMove));
    }
    if (!restored && typeof snapshot.fen === 'string' && snapshot.fen.trim()) {
        restored = restoredGame.load(snapshot.fen);
    }
    if (!restored) return false;

    window.game = restoredGame;
    window.playerColor = window.game.turn();
    window.setGameSectionVisibility();

    const roomLink = document.getElementById('room-link');
    if (roomLink) {
        roomLink.value = '';
    }

    const params = new URLSearchParams(window.location.search);
    params.set('local', '1');
    params.set('mode', 'pass');
    params.set('variant', normalizedVariant);
    params.delete('room');
    params.delete('bot');
    params.delete('color');
    params.delete('level');
    params.delete('training');
    params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    applyPassAndPlayCommonUi(normalizedVariant);
    window.savePassAndPlayGameSnapshot?.({
        gameState: getPassAndPlaySnapshotGameState(snapshot, window.game),
        orientation: snapshot.orientation || (window.game.turn() === 'b' ? 'black' : 'white')
    });
    return true;
};

window.initPassAndPlayGame = function({ variant = 'standard' } = {}) {
    const normalizedVariant = variant === 'standard' ? 'standard' : 'standard';

    window.stopBotGame();
    initLocalGameState();

    window.isPassAndPlayMode = true;
    window.passAndPlayVariant = normalizedVariant;
    window.playerColor = 'w';

    window.setGameSectionVisibility();
    window.currentRoomId = null;

    const roomLink = document.getElementById('room-link');
    if (roomLink) {
        roomLink.value = '';
    }

    const params = new URLSearchParams(window.location.search);
    params.set('local', '1');
    params.set('mode', 'pass');
    params.set('variant', normalizedVariant);
    params.delete('room');
    params.delete('bot');
    params.delete('color');
    params.delete('level');
    params.delete('training');
    params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    applyPassAndPlayCommonUi(normalizedVariant);
    window.savePassAndPlayGameSnapshot?.({ gameState: 'active' });
};


window.addEventListener('beforeunload', () => {
    window.stopBotGame?.();
});

window.initGame = async function(roomId) {
    try {
        const user = await window.requireAuthForGame();
        if (!user) {
            location.href = location.origin + location.pathname;
            return;
        }

        window.setGameSectionVisibility();
        document.getElementById('room-link').value = window.location.href;
        
        const uid = window.getUserId(user);
        const uName = window.getUserName(user);
        const gameRef = window.getGameRef(roomId);
        const playersRef = window.getPlayersRef(roomId);
        const requestedJoinColor = window.getRequestedJoinColor();
        const openMode = new URLSearchParams(window.location.search).get('view');
        
        window.hasInitializedRemotePgnSync = false;
        initLocalGameState();
        window.shouldAutoEnterFinishedReview = openMode === 'finished';
        await ensureGameExists(gameRef, roomId);
        await window.addPlayerToGame(playersRef, uid, uName, requestedJoinColor);
        
        const p = (await get(playersRef)).val() || {};
        const gameSnapshot = await get(gameRef);
        const initialGameData = gameSnapshot.val() || null;
        window.isArchivedFinishedView = initialGameData?.gameState === 'game_over';
        if (isDirectInvitePendingForRoom(roomId, initialGameData, uid)) {
            markDirectInviteAsHandled(roomId);
        }
        window.playerColor = resolveAssignedColor(p, uid);
        applyAssignedColorToBoard();
        subscribeToGameUpdates(gameRef);
        
        window.setupGameControls(gameRef, roomId);
        window.currentRoomId = roomId;
        window.refreshPresenceUI?.();
        window.markGameReady?.();
    } catch (error) {
        console.error('Ошибка инициализации партии:', error);
        window.setAppLoadingFlag?.('lobby', false);
        window.notify?.('Не удалось загрузить партию. Попробуйте обновить страницу.', 'error', 3600);
    }
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
        pgn: window.game.pgn(),
        drawRequest: null
    };
    window.applyImmediateGameOverState({
        ...updateData,
        players
    });
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
