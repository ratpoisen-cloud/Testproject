// ==================== КНОПКИ УПРАВЛЕНИЯ ====================

window.setupGameControls = function(gameRef, roomId) {
    if (typeof window.__rematchWatchUnsubscribe === 'function') {
        window.__rematchWatchUnsubscribe();
        window.__rematchWatchUnsubscribe = null;
    }

    const setClickHandler = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.onclick = handler;
    };

    const hideElement = (id) => {
        document.getElementById(id)?.classList.add('hidden');
    };

    const resolvePlayersForHeaders = async () => {
        const snap = await get(window.getPlayersRef(roomId));
        return snap.val() || null;
    };

    const runRematch = async () => {
        hideElement('game-modal');
        if (window.isLocalVersusMode) {
            window.initLocalVersusGame?.();
            return;
        }
        if (window.isBotMode) {
            window.initBotGame({ color: window.playerColor, level: window.botLevel || 'medium' });
            return;
        }
        const requesterUid = window.currentUser?.uid;
        if (!requesterUid) return;
        const result = await window.requestRematchFromRoom(roomId, requesterUid);
        if (!result) {
            window.notify('Не удалось отправить запрос реванша', 'error', 2800);
            return;
        }
        if (result.startedRoomId) {
            location.href = `${location.origin}${location.pathname}?room=${result.startedRoomId}`;
            return;
        }
        window.notify('Запрос реванша отправлен', 'success', 2600);
    };

    const bindPgnCopyButton = (buttonId) => {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.onclick = async () => {
            const pgn = window.game?.pgn?.();
            if (!pgn) {
                window.notify("Нет данных партии", "warning");
                return;
            }
            try {
                await navigator.clipboard.writeText(pgn);
                const originalText = button.innerText;
                button.innerText = '✅ Ок!';
                setTimeout(() => {
                    button.innerText = originalText;
                }, 2000);
            } catch (error) {
                console.error(error);
                window.notify("Не удалось скопировать PGN", "error");
            }
        };
    };

    const resetPendingMoveUI = () => {
        window.pendingMove = null;
        window.pendingPromotionSelection = null;
        hideElement('confirm-move-box');
        hideElement('promotion-choice-box');
        window.clearSelection();
    };

    const invalidatePendingConfirmFlow = ({ syncFen = null, skipBoardSync = false } = {}) => {
        resetPendingMoveUI();
        if (skipBoardSync) return;
        if (typeof syncFen === 'string' && syncFen) {
            window.updateBoardPosition(syncFen, true);
            return;
        }
        if (window.game?.fen) {
            window.updateBoardPosition(window.game.fen(), true);
        }
    };

    const syncRoleFromRemoteAssignment = ({ assignedColor = null, remoteData = null } = {}) => {
        if (isBotMode()) return;
        window.playerColor = assignedColor === 'w' || assignedColor === 'b' ? assignedColor : null;
        window.updatePlayerBadge?.();

        if (typeof window.rebuildBoardWithCurrentState === 'function') {
            window.rebuildBoardWithCurrentState();
        } else if (window.board?.orientation) {
            window.board.orientation(window.playerColor === 'b' ? 'black' : 'white');
            if (window.game?.fen) {
                window.updateBoardPosition(window.game.fen(), true);
            }
        }

        const isMyTurn = Boolean(window.playerColor && window.game?.turn?.() === window.playerColor);
        window.updateTurnIndicator?.(isMyTurn);
        if (remoteData) {
            window.updateUI?.(remoteData);
        } else {
            window.updateUI?.(window.lastGameUiSnapshot || { gameState: 'active' });
        }
        if (typeof window.refreshPresenceUI === 'function') {
            window.refreshPresenceUI();
        }
    };

    const isFinishedGame = () => {
        if (typeof window.isGameFinished === 'function') {
            return window.isGameFinished();
        }
        return Boolean(window.game?.game_over?.() || window.lastKnownGameState === 'game_over');
    };

    const isBotMode = () => Boolean(window.isBotMode);
    const isLocalVersusMode = () => Boolean(window.isLocalVersusMode);

    window.requestBotMove = async function() {
        if (!isBotMode() || !window.botEngine || !window.game || window.game.game_over()) return;
        if (window.game.turn() !== window.botColor) return;
        if (window.isBotThinking) return;

        window.isBotThinking = true;
        window.updateTurnIndicator(false);

        try {
            const bestMove = await window.botEngine.getBestMove(window.game.fen());
            if (!bestMove || bestMove === '(none)' || !window.isBotMode) return;

            const botMove = window.game.move({
                from: bestMove.slice(0, 2),
                to: bestMove.slice(2, 4),
                promotion: bestMove.slice(4, 5) || 'q'
            });

            if (!botMove) return;

            window.playMoveSoundSequence?.(botMove, { allowVoiceLine: false });

            window.updateBoardPosition(window.game.fen(), true);
            window.highlightLastMove?.(botMove);
            window.syncReviewStateFromCurrentGame?.();
            window.updateUI({ gameState: window.game.game_over() ? 'game_over' : 'active', mode: 'bot' });

            if (window.game.game_over()) {
                const metadata = window.applyGameHeaders(window.game, {
                    gameState: 'game_over',
                    message: window.getGameResultMessage(window.game)
                });
                window.updateGameModal({ gameState: 'game_over', message: metadata.message });
            }
        } catch (error) {
            console.error('Ошибка хода бота:', error);
            window.notify('Не удалось получить ход бота', 'error', 2600);
        } finally {
            window.isBotThinking = false;
        }
    };


    const applyBotModeUiRestrictions = () => {
        if (!isBotMode() && !isLocalVersusMode()) return;
        document.querySelector('.game-share-box')?.classList.add('hidden');
        document.getElementById('draw-btn')?.classList.add('hidden');
        const drawBtn = document.getElementById('draw-btn');
        if (drawBtn) drawBtn.disabled = true;
        const takebackBtn = document.getElementById('takeback-btn');
        if (takebackBtn) {
            takebackBtn.classList.add('hidden');
            takebackBtn.disabled = true;
        }
        document.getElementById('takeback-request-box')?.classList.add('hidden');
        document.getElementById('draw-request-box')?.classList.add('hidden');
        document.getElementById('rematch-request-box')?.classList.add('hidden');
        document.getElementById('promotion-choice-box')?.classList.add('hidden');
    };

    const hasOpponentJoined = async () => {
        const players = (await get(window.getPlayersRef(roomId))).val() || {};
        return Boolean(players.white && players.black);
    };

    // ===== Confirm / Cancel move =====
    const bindPendingMoveControls = () => {
        // Подтверждение хода
        setClickHandler('confirm-btn', async () => {
            if (!window.pendingMove) return;
            const pendingMove = window.pendingMove;
            const expectedBasePgn = pendingMove.basePgn ?? window.game.pgn();
            const expectedBaseFen = pendingMove.baseFen ?? window.game.fen();
            const expectedBaseTurn = pendingMove.baseTurn ?? window.game.turn();

            if (!isBotMode() && !isLocalVersusMode()) {
                if (!window.playerColor || (window.playerColor !== 'w' && window.playerColor !== 'b')) {
                    invalidatePendingConfirmFlow();
                    return;
                }

                if (window.game.turn() !== window.playerColor || expectedBaseTurn !== window.playerColor) {
                    window.notify('Сейчас не ваш ход', 'info', 2200);
                    invalidatePendingConfirmFlow();
                    return;
                }

                const remoteSnapshot = await get(gameRef);
                const remoteData = remoteSnapshot.val() || null;
                if (!remoteData || remoteData.gameState === 'game_over') {
                    window.notify('Партия уже завершена', 'info', 2200);
                    invalidatePendingConfirmFlow();
                    return;
                }

                const remotePlayers = remoteData.players || {};
                const currentUid = window.currentUser?.uid || window.currentUser?.id || '';
                if (currentUid) {
                    const remoteAssignedColor = remotePlayers.white === currentUid
                        ? 'w'
                        : (remotePlayers.black === currentUid ? 'b' : null);
                    if (remoteAssignedColor !== window.playerColor) {
                        syncRoleFromRemoteAssignment({ assignedColor: remoteAssignedColor, remoteData });
                        window.notify(remoteAssignedColor ? 'Синхронизировали ваш цвет в комнате' : 'Режим наблюдателя', 'info', 2200);
                        invalidatePendingConfirmFlow();
                        return;
                    }
                }

                const remoteTurn = window.resolveTurnColorCode?.(remoteData);
                if (remoteTurn && remoteTurn !== window.playerColor) {
                    if (remoteData.pgn) {
                        window.applyRemotePgnUpdate?.(remoteData.pgn);
                        invalidatePendingConfirmFlow({ skipBoardSync: true });
                    } else {
                        invalidatePendingConfirmFlow({
                            syncFen: (typeof remoteData.fen === 'string' && remoteData.fen) ? remoteData.fen : null
                        });
                    }
                    window.notify('Ход соперника уже получен, обновили позицию', 'info', 2600);
                    return;
                }

                const remotePgn = typeof remoteData.pgn === 'string' ? remoteData.pgn : '';
                const remoteFen = typeof remoteData.fen === 'string' ? remoteData.fen : '';
                const baseMismatch = remotePgn
                    ? remotePgn !== expectedBasePgn
                    : (remoteFen ? remoteFen !== expectedBaseFen : false);

                if (baseMismatch) {
                    if (remotePgn) {
                        window.applyRemotePgnUpdate?.(remotePgn);
                        invalidatePendingConfirmFlow({ skipBoardSync: true });
                    } else {
                        invalidatePendingConfirmFlow({ syncFen: remoteFen || null });
                    }
                    window.notify('Позиция устарела, ход отменён', 'warning', 2600);
                    return;
                }
            }

            const moveResult = window.game.move({
                from: pendingMove.from,
                to: pendingMove.to,
                promotion: pendingMove.promotion || 'q'
            });

            if (!moveResult) {
                window.pendingMove = null;
                hideElement('confirm-move-box');
                window.updateBoardPosition(window.game.fen(), true);
                window.clearSelection();
                return;
            }

            if (window.highlightLastMove) {
                window.highlightLastMove(moveResult);
            }

            window.playMoveSoundSequence?.(moveResult, { allowVoiceLine: true });

            window.updateBoardPosition(window.game.fen(), true);
            if (isLocalVersusMode()) {
                window.syncLocalVersusBoardOrientation?.();
            }

            const now = Date.now();
            const updateData = {
                pgn: window.game.pgn(),
                fen: window.game.fen(),
                turn: window.game.turn(),
                lastMove: now,
                lastMoveTime: now // Добавляем время последнего хода для сортировки
            };

            if (isBotMode()) {
                window.syncReviewStateFromCurrentGame?.();
                resetPendingMoveUI();
                window.updateUI({ gameState: window.game.game_over() ? 'game_over' : 'active', mode: 'bot' });

                if (window.game.game_over()) {
                    const metadata = window.applyGameHeaders(window.game, {
                        gameState: 'game_over',
                        message: window.getGameResultMessage(window.game)
                    });
                    window.updateGameModal({ gameState: 'game_over', message: metadata.message });
                    return;
                }

                await window.requestBotMove?.();
                return;
            }

            if (isLocalVersusMode()) {
                if (window.game.game_over()) {
                    const metadata = window.applyGameHeaders(window.game, {
                        gameState: 'game_over',
                        message: window.getGameResultMessage(window.game)
                    });
                    resetPendingMoveUI();
                    window.updateUI({ gameState: 'game_over', message: metadata.message, mode: 'local_versus' });
                    return;
                }
                resetPendingMoveUI();
                window.updateUI({ gameState: 'active', mode: 'local_versus' });
                return;
            }

            if (window.game.game_over()) {
                const players = await resolvePlayersForHeaders();
                const metadata = window.applyGameHeaders(window.game, {
                    players,
                    gameState: 'game_over',
                    message: window.getGameResultMessage(window.game)
                });
                updateData.gameState = 'game_over';
                updateData.message = metadata.message;
                updateData.pgn = window.game.pgn();
            }

            window.updateGame(gameRef, updateData);
            resetPendingMoveUI();
        });

        // Отмена неподтвержденного хода - ПЛАВНЫЙ ВОЗВРАТ ФИГУРЫ
        setClickHandler('cancel-move-btn', () => {
            if (window.pendingMove) {
                window.pendingMove = null;
                hideElement('confirm-move-box');

                // Плавно возвращаем доску в исходное состояние
                if (window.isMobile) {
                    // На мобиле просто обновляем позицию
                    window.updateBoardPosition(window.game.fen(), true);
                } else {
                    // На десктопе возвращаем с анимацией
                    window.board.position(window.game.fen(), true);
                }

                window.clearSelection();
            }
        });
    };

    // ===== Resign / Exit / Share =====
    const bindSessionControls = () => {
        // Сдача
        setClickHandler('resign-btn', async () => {
            if (isFinishedGame()) {
                window.notify("Игра уже окончена", "warning");
                return;
            }
            const shouldResign = await window.confirmAction({
                title: "Сдаться?",
                message: "Вы уверены, что хотите сдаться?",
                confirmText: "Сдаться",
                cancelText: "Отмена",
                danger: true
            });
            if (shouldResign) {
                const resignColor = isLocalVersusMode() ? window.game.turn() : window.playerColor;
                const winner = resignColor === 'w' ? 'Черные' : 'Белые';
                const players = isBotMode() ? null : await resolvePlayersForHeaders();
                const metadata = window.applyGameHeaders(window.game, {
                    players,
                    gameState: 'game_over',
                    message: `${winner} победили (сдача)`,
                    resign: resignColor
                });

                if (isBotMode()) {
                    window.applyImmediateGameOverState?.({
                        gameState: 'game_over',
                        message: metadata.message,
                        resign: resignColor,
                        mode: 'bot'
                    });
                    return;
                }

                const updateData = {
                    gameState: 'game_over',
                    message: metadata.message,
                    pgn: window.game.pgn(),
                    resign: resignColor
                };
                window.applyImmediateGameOverState?.(updateData);
                if (!isLocalVersusMode()) {
                    await window.updateGame(gameRef, updateData);
                }
            }
        });

        // Выход в лобби
        const goBackToLobby = async () => {
            const shouldExit = await window.confirmAction({
                title: "Выйти в лобби?",
                message: "Текущая партия останется сохранённой.",
                confirmText: "Выйти",
                cancelText: "Остаться"
            });
            if (shouldExit) {
                location.href = location.origin + location.pathname;
            }
        };

        const bindBackToLobbyButton = (buttonId) => {
            const button = document.getElementById(buttonId);
            if (!button) return;
            button.onclick = goBackToLobby;
        };

        const exitBtn = document.getElementById('exit-btn');
        if (exitBtn) {
            exitBtn.onclick = goBackToLobby;
        }
        bindBackToLobbyButton('back-to-lobby-btn');

        // Поделиться ссылкой
        setClickHandler('share-btn', async () => {
            if (isBotMode() || isLocalVersusMode()) return;
            const link = document.getElementById('room-link').value;
            if (navigator.share) {
                try {
                    await navigator.share({ title: 'Шахматная партия', url: link });
                } catch {}
            } else {
                navigator.clipboard.writeText(link);
                window.notify('Ссылка скопирована!', 'success');
            }
        });
    };

    // ===== Review controls =====
    const bindReviewControls = () => {
        setClickHandler('review-first-btn', () => {
            if (!window.game) return;
            window.enterReviewMode(0);
        });

        setClickHandler('review-prev-btn', () => {
            if (!window.game) return;
            if (!window.reviewMode) {
                window.enterReviewMode();
            }
            window.stepReview(-1);
        });

        setClickHandler('review-next-btn', () => {
            if (!window.game) return;
            if (!window.reviewMode) {
                window.enterReviewMode();
            }
            window.stepReview(1);
        });

        setClickHandler('review-last-btn', () => {
            if (!window.game) return;
            const maxPly = window.game.history().length;
            if (!window.reviewMode) {
                return;
            }
            const isLiveGame = !window.game.game_over();

            if (isLiveGame) {
                window.exitReviewMode();
                return;
            }

            window.goToReviewPly(maxPly);
        });

        setClickHandler('review-live-btn', () => {
            if (!window.game || !window.reviewMode) return;
            if (window.game.game_over()) return;
            window.exitReviewMode();
        });
    };

    // ===== Takeback =====
    const bindTakebackControls = () => {
        if (isBotMode() || isLocalVersusMode()) return;
        let lastIncomingTakebackKey = '';
        // Запрос отмены хода
        setClickHandler('takeback-btn', () => {
            if (isFinishedGame()) {
                document.getElementById('takeback-request-box')?.classList.add('hidden');
                window.pendingTakeback = null;
                window.notify("Игра уже окончена", "warning");
                return;
            }
            if (window.game.history().length === 0) {
                window.notify("Нет ходов для отмены", "warning");
                return;
            }
            window.updateGame(gameRef, { takebackRequest: { from: window.playerColor, timestamp: Date.now() } });
            window.notify("Запрос отправлен сопернику", "success");
        });

        // Слушатель запроса отмены
        const takebackRef = window.getTakebackRef(roomId);
        if (typeof onValue !== 'undefined') {
            onValue(takebackRef, (snap) => {
                const request = snap.val();
                const requestBox = document.getElementById('takeback-request-box');

                if (isFinishedGame()) {
                    requestBox?.classList.add('hidden');
                    window.pendingTakeback = null;
                    return;
                }

                if (!request) {
                    requestBox?.classList.add('hidden');
                    window.pendingTakeback = null;
                    return;
                }

                if (request.from !== window.playerColor && !request.answered) {
                    const requestKey = `${request.timestamp || ''}:${request.from || ''}`;
                    if (requestKey && requestKey !== lastIncomingTakebackKey) {
                        window.SoundManager?.play?.('modal_open');
                        lastIncomingTakebackKey = requestKey;
                    }
                    requestBox?.classList.remove('hidden');
                    window.pendingTakeback = request;
                    return;
                }
                requestBox?.classList.add('hidden');
                window.pendingTakeback = null;
            });
        }

        // Принять отмену
        setClickHandler('takeback-accept', () => {
            if (isFinishedGame()) {
                document.getElementById('takeback-request-box')?.classList.add('hidden');
                window.pendingTakeback = null;
                window.notify("Игра уже окончена", "warning");
                return;
            }
            if (window.pendingTakeback) {
                window.game.undo();
                window.updateGame(gameRef, {
                    pgn: window.game.pgn(),
                    fen: window.game.fen(),
                    takebackRequest: null
                });
                document.getElementById('takeback-request-box').classList.add('hidden');
                window.pendingTakeback = null;
                window.clearSelection();
                window.updateBoardPosition(window.game.fen(), true);
            }
        });

        // Отклонить отмену
        setClickHandler('takeback-reject', () => {
            if (isFinishedGame()) {
                document.getElementById('takeback-request-box')?.classList.add('hidden');
                window.pendingTakeback = null;
                window.notify("Игра уже окончена", "warning");
                return;
            }
            window.updateGame(gameRef, { takebackRequest: null });
            document.getElementById('takeback-request-box').classList.add('hidden');
            window.pendingTakeback = null;
        });
    };

    // ===== Draw =====
    const bindDrawControls = () => {
        if (isBotMode() || isLocalVersusMode()) return;
        let lastIncomingDrawKey = '';
        // Кнопка "Предложить ничью"
        setClickHandler('draw-btn', () => {
            if (isFinishedGame()) {
                window.notify("Игра уже окончена", "warning");
                return;
            }
            if (window.pendingDraw) {
                window.notify("Запрос уже отправлен", "warning");
                return;
            }
            hasOpponentJoined()
                .then((joined) => {
                    if (!joined) {
                        window.notify("Невозможно предложить ничью до подключения соперника", "warning");
                        return;
                    }
                    window.sendDrawRequest(gameRef, roomId);
                })
                .catch((error) => {
                    console.error(error);
                    window.notify("Не удалось проверить состав игроков", "error");
                });
        });

        // Слушатель запроса на ничью
        const drawRef = window.getDrawRef(roomId);
        if (typeof onValue !== 'undefined') {
            onValue(drawRef, (snap) => {
                const request = snap.val();
                const drawRequestBox = document.getElementById('draw-request-box');
                if (isFinishedGame()) {
                    drawRequestBox?.classList.add('hidden');
                    window.pendingDraw = null;
                    return;
                }
                if (!request) {
                    drawRequestBox?.classList.add('hidden');
                    window.pendingDraw = null;
                    return;
                }

                window.pendingDraw = request;
                if (request.from !== window.playerColor && !request.answered) {
                    const requestKey = `${request.timestamp || ''}:${request.from || ''}`;
                    if (requestKey && requestKey !== lastIncomingDrawKey) {
                        window.SoundManager?.play?.('modal_open');
                        lastIncomingDrawKey = requestKey;
                    }
                    document.getElementById('draw-request-text').innerHTML =
                        `${request.fromName || 'Соперник'} предлагает ничью`;
                    drawRequestBox?.classList.remove('hidden');
                    return;
                }

                drawRequestBox?.classList.add('hidden');
            });
        }

        // Принять ничью
        setClickHandler('draw-accept', () => {
            if (isFinishedGame()) {
                document.getElementById('draw-request-box')?.classList.add('hidden');
                window.pendingDraw = null;
                window.notify("Игра уже окончена", "warning");
                return;
            }
            if (window.pendingDraw) {
                window.acceptDraw(gameRef, roomId);
            }
        });

        // Отклонить ничью
        setClickHandler('draw-reject', () => {
            if (isFinishedGame()) {
                document.getElementById('draw-request-box')?.classList.add('hidden');
                window.pendingDraw = null;
                window.notify("Игра уже окончена", "warning");
                return;
            }
            if (window.pendingDraw) {
                window.rejectDraw(gameRef, roomId);
            }
        });
    };

    const bindRematchControls = () => {
        const requestBox = document.getElementById('rematch-request-box');
        const resetRematchRequestUi = () => {
            requestBox?.classList.add('hidden');
            window.pendingRematch = null;
        };
        const isOnlineRematchContext = () => Boolean(
            roomId
            && window.currentRoomId === roomId
            && !isBotMode()
            && !isLocalVersusMode()
            && (window.playerColor === 'w' || window.playerColor === 'b')
            && window.currentUser?.uid
        );
        const isCurrentRoomFinished = () => (
            window.currentRoomId === roomId
            && window.lastGameUiSnapshot?.gameState === 'game_over'
        );

        if (!isOnlineRematchContext()) {
            resetRematchRequestUi();
            return;
        }
        let lastIncomingRematchKey = '';

        const rematchRef = window.getRematchRef?.(roomId);
        if (typeof onValue !== 'undefined' && rematchRef) {
            window.__rematchWatchUnsubscribe = onValue(rematchRef, (snap) => {
                const request = snap.val();
                if (!isOnlineRematchContext()) {
                    resetRematchRequestUi();
                    return;
                }
                if (!request || !window.isRematchRequestRelevant?.(request) || !isCurrentRoomFinished()) {
                    resetRematchRequestUi();
                    return;
                }

                const currentUid = window.currentUser?.uid || '';
                const isIncoming = request.createdByUid
                    && request.createdByUid !== currentUid
                    && request.targetUid === currentUid
                    && !request.confirmedBy?.[window.playerColor];

                if (isIncoming) {
                    const requestKey = `${request.id || ''}:${request.updatedAt || ''}`;
                    if (requestKey && requestKey !== lastIncomingRematchKey) {
                        window.SoundManager?.play?.('modal_open');
                        lastIncomingRematchKey = requestKey;
                    }
                    document.getElementById('rematch-request-text').textContent =
                        `${request.createdByName || 'Соперник'} предлагает реванш`;
                    requestBox?.classList.remove('hidden');
                    window.pendingRematch = request;
                    return;
                }

                resetRematchRequestUi();
            });
        }

        setClickHandler('rematch-accept', async () => {
            if (!isOnlineRematchContext() || !window.pendingRematch || !window.currentUser?.uid) {
                resetRematchRequestUi();
                return;
            }
            const newId = await window.confirmRematchForRoom(roomId, window.currentUser.uid);
            document.getElementById('rematch-request-box')?.classList.add('hidden');
            if (newId) {
                location.href = `${location.origin}${location.pathname}?room=${newId}`;
            }
        });

        setClickHandler('rematch-reject', async () => {
            if (!isOnlineRematchContext() || !window.currentUser?.uid) {
                resetRematchRequestUi();
                return;
            }
            await window.declineRematchForRoom(roomId, window.currentUser.uid);
            document.getElementById('rematch-request-box')?.classList.add('hidden');
            window.pendingRematch = null;
        });
    };

    // ===== Game-over modal + PGN =====
    const bindGameOverControls = () => {
        // Реванш
        const modalRematchBtn = document.getElementById('modal-rematch-btn');
        if (modalRematchBtn) {
            modalRematchBtn.onclick = runRematch;
        }

        const inlineRematchBtn = document.getElementById('inline-rematch-btn');
        if (inlineRematchBtn) {
            inlineRematchBtn.onclick = runRematch;
        }

        const inlineIchiAnalysisBtn = document.getElementById('inline-ichi-analysis-btn');
        if (inlineIchiAnalysisBtn) {
            inlineIchiAnalysisBtn.onclick = () => {
                window.notify('Разбор с ИЧИ скоро появится', 'info', 2200);
            };
        }

        // Выход из модального окна
        setClickHandler('modal-exit-btn', () => {
            document.getElementById('game-modal').classList.add('hidden');
            location.href = location.origin + location.pathname;
        });

        // Открыть просмотр из модалки окончания игры
        setClickHandler('modal-review-btn', () => {
            document.getElementById('game-modal').classList.add('hidden');
            if (!window.game) return;
            const maxPly = window.game.history().length;
            window.enterReviewMode(maxPly);
        });

        bindPgnCopyButton('modal-copy-pgn');
        bindPgnCopyButton('inline-copy-pgn');
    };

    applyBotModeUiRestrictions();

    bindPendingMoveControls();
    bindSessionControls();
    bindReviewControls();
    bindTakebackControls();
    bindDrawControls();
    bindRematchControls();
    bindGameOverControls();
};
