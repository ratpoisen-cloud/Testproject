// ==================== КНОПКИ УПРАВЛЕНИЯ ====================

window.setupGameControls = function(gameRef, roomId) {
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

    const isFinishedGame = () => {
        if (typeof window.isGameFinished === 'function') {
            return window.isGameFinished();
        }
        return Boolean(window.game?.game_over?.() || window.lastKnownGameState === 'game_over');
    };

    const isBotMode = () => Boolean(window.isBotMode);

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
        if (!isBotMode()) return;
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
        setClickHandler('confirm-btn', () => {
            const confirmBtn = document.getElementById('confirm-btn');
            window.withUiActionLock('move-confirm', async () => {
                if (!window.pendingMove) return;

            const moveResult = window.game.move({
                from: window.pendingMove.from,
                to: window.pendingMove.to,
                promotion: window.pendingMove.promotion || 'q'
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

            try {
                await window.applyMoveAtomic(roomId, {
                    uid: window.currentUser?.uid,
                    expectedVersion: window.lastGameUiSnapshot?.version ?? 0,
                    pgn: updateData.pgn,
                    fen: updateData.fen,
                    turn: updateData.turn,
                    lastMove: updateData.lastMove,
                    gameOver: updateData.gameState === 'game_over',
                    message: updateData.message || null
                });

                resetPendingMoveUI();

            } catch (error) {
                console.error('[confirmMove] applyMoveAtomic failed:', error);

                // ОТКАТ ХОДА (КЛЮЧЕВОЙ МОМЕНТ)
                window.game.undo();

                window.pendingMove = null;
                window.pendingPromotionSelection = null;

                document.getElementById('confirm-move-box')?.classList.add('hidden');
                document.getElementById('promotion-choice-box')?.classList.add('hidden');

                window.clearSelection();
                window.updateBoardPosition(window.game.fen(), true);

                const msg = String(error.message || '');

                if (msg.includes('Version mismatch')) {
                    window.notify('Позиция устарела. Обновляем партию.', 'warning');
                } else if (msg.includes('Not your turn')) {
                    window.notify('Сейчас не ваш ход', 'warning');
                } else if (msg.includes('Game already finished')) {
                    window.notify('Игра уже завершена', 'warning');
                } else {
                    window.notify('Ошибка при отправке хода', 'error');
                }

                return;
            }
            }, {
                button: confirmBtn,
                loadingText: 'Ход...'
            });
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
                const resignBtn = document.getElementById('resign-btn');
                await window.withUiActionLock('resign-game', async () => {
                    const winner = window.playerColor === 'w' ? 'Черные' : 'Белые';
                    const players = isBotMode() ? null : await resolvePlayersForHeaders();
                    const metadata = window.applyGameHeaders(window.game, {
                        players,
                        gameState: 'game_over',
                        message: `${winner} победили (сдача)`,
                        resign: window.playerColor
                    });

                    if (isBotMode()) {
                        window.applyImmediateGameOverState?.({
                            gameState: 'game_over',
                            message: metadata.message,
                            resign: window.playerColor,
                            mode: 'bot'
                        });
                        return;
                    }

                const updateData = {
                    gameState: 'game_over',
                    message: metadata.message,
                    pgn: window.game.pgn(),
                    resign: window.playerColor
                };
                window.applyImmediateGameOverState?.(updateData);

                    try {
                        await window.resignGameAtomic(roomId, {
                            uid: window.currentUser?.uid,
                            playerColor: window.playerColor
                        });
                    } catch (error) {
                    console.error('[resign] resignGameAtomic failed:', error);

                    const msg = String(error.message || '');

                    if (msg.includes('Game already finished')) {
                        window.notify('Игра уже завершена', 'warning');
                    } else if (msg.includes('Not a player')) {
                        window.notify('Вы не участник партии', 'error');
                    } else if (msg.includes('Color mismatch')) {
                        window.notify('Ошибка цвета игрока', 'error');
                    } else if (msg.includes('Auth uid mismatch')) {
                        window.notify('Ошибка авторизации', 'error');
                    } else {
                        window.notify('Ошибка при сдаче партии', 'error');
                    }

                        return;
                    }
                }, {
                    button: resignBtn,
                    loadingText: 'Сдаюсь...'
                });
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
            if (isBotMode()) return;
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
        if (isBotMode()) return;
        let lastIncomingTakebackKey = '';
        // Запрос отмены хода
        setClickHandler('takeback-btn', async () => {
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
            try {
                await window.resolveTakebackAtomic(roomId, {
                    uid: window.currentUser?.uid,
                    action: 'request'
                });

                window.notify('Запрос отправлен сопернику', 'success');
            } catch (error) {
                console.error('[takeback] request failed:', error);

                const msg = String(error.message || '');
                if (msg.includes('Takeback already requested')) {
                    window.notify('Запрос на откат уже отправлен', 'warning');
                } else if (msg.includes('Game already finished')) {
                    window.notify('Игра уже завершена', 'warning');
                } else if (msg.includes('Not a player')) {
                    window.notify('Вы не участник партии', 'error');
                } else if (msg.includes('Auth uid mismatch')) {
                    window.notify('Ошибка авторизации', 'error');
                } else {
                    window.notify('Не удалось отправить запрос на откат', 'error');
                }

                return;
            }
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

                const isOwnTakebackRequest =
                    request.from === window.playerColor ||
                    request.fromUid === window.currentUser?.uid ||
                    request.from === window.currentUser?.uid;

                if (!isOwnTakebackRequest && !request.answered) {
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
            const acceptBtn = document.getElementById('takeback-accept');
            const rejectBtn = document.getElementById('takeback-reject');
            const pendingTakeback = window.pendingTakeback;
            document.getElementById('takeback-request-box')?.classList.add('hidden');
            window.withUiActionLock('takeback-accept', async () => {
                if (isFinishedGame()) {
                    window.pendingTakeback = null;
                    window.notify("Игра уже окончена", "warning");
                    return;
                }
                if (!pendingTakeback) return;

                window.pendingTakeback = pendingTakeback;
                const history = window.game.history();
                const previousFen = window.game.fen();

                const currentTurn = window.game.turn();
                const shouldUndoTwoMoves =
                    history.length >= 2 &&
                    currentTurn === window.playerColor;

                window.game.undo();
                if (shouldUndoTwoMoves) {
                    window.game.undo();
                }

                try {
                    await window.resolveTakebackAtomic(roomId, {
                        uid: window.currentUser?.uid,
                        action: 'accept',
                        fenAfterUndo: window.game.fen(),
                        pgnAfterUndo: window.game.pgn()
                    });

                    document.getElementById('takeback-request-box')?.classList.add('hidden');
                    window.pendingTakeback = null;
                    window.clearSelection();
                    window.updateBoardPosition(window.game.fen(), true);
                } catch (error) {
                    console.error('[takeback] accept failed:', error);

                    // rollback: вернуть локальный ход обратно, если RPC не принял откат
                    if (previousFen && typeof window.game.load === 'function') {
                        window.game.load(previousFen);
                    }
                    window.updateBoardPosition(window.game.fen(), true);

                    const msg = String(error.message || '');
                    if (msg.includes('No takeback request')) {
                        window.notify('Запрос на откат уже неактуален', 'warning');
                    } else if (msg.includes('Cannot accept own takeback request')) {
                        window.notify('Нельзя принять собственный запрос на откат', 'warning');
                    } else if (msg.includes('Missing undo state')) {
                        window.notify('Ошибка состояния отката', 'error');
                    } else if (msg.includes('Game already finished')) {
                        window.notify('Игра уже завершена', 'warning');
                    } else if (msg.includes('Not a player')) {
                        window.notify('Вы не участник партии', 'error');
                    } else if (msg.includes('Auth uid mismatch')) {
                        window.notify('Ошибка авторизации', 'error');
                    } else {
                        window.notify('Не удалось принять откат', 'error');
                    }

                    return;
                }
            }, {
                buttons: [acceptBtn, rejectBtn],
                loadingText: '...'
            });
        });

        // Отклонить отмену
        setClickHandler('takeback-reject', () => {
            const acceptBtn = document.getElementById('takeback-accept');
            const rejectBtn = document.getElementById('takeback-reject');
            const pendingTakeback = window.pendingTakeback;
            document.getElementById('takeback-request-box')?.classList.add('hidden');
            window.withUiActionLock('takeback-reject', async () => {
                if (isFinishedGame()) {
                    window.pendingTakeback = null;
                    window.notify("Игра уже окончена", "warning");
                    return;
                }
                if (!pendingTakeback) return;
                window.pendingTakeback = pendingTakeback;
                try {
                    await window.resolveTakebackAtomic(roomId, {
                        uid: window.currentUser?.uid,
                        action: 'reject'
                    });

                document.getElementById('takeback-request-box')?.classList.add('hidden');
                window.pendingTakeback = null;
            } catch (error) {
                console.error('[takeback] reject failed:', error);

                const msg = String(error.message || '');
                if (msg.includes('No takeback request')) {
                    window.notify('Запрос на откат уже неактуален', 'warning');
                } else if (msg.includes('Cannot reject own takeback request')) {
                    window.notify('Нельзя отклонить собственный запрос на откат', 'warning');
                } else if (msg.includes('Game already finished')) {
                    window.notify('Игра уже завершена', 'warning');
                } else if (msg.includes('Not a player')) {
                    window.notify('Вы не участник партии', 'error');
                } else if (msg.includes('Auth uid mismatch')) {
                    window.notify('Ошибка авторизации', 'error');
                } else {
                    window.notify('Не удалось отклонить откат', 'error');
                }

                    return;
                }
            }, {
                buttons: [acceptBtn, rejectBtn],
                loadingText: '...'
            });
        });
    };

    // ===== Draw =====
    const bindDrawControls = () => {
        if (isBotMode()) return;
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
            const acceptBtn = document.getElementById('draw-accept');
            const rejectBtn = document.getElementById('draw-reject');
            const pendingDraw = window.pendingDraw;
            document.getElementById('draw-request-box')?.classList.add('hidden');
            window.withUiActionLock('draw-accept', async () => {
                if (isFinishedGame()) {
                    window.pendingDraw = null;
                    window.notify("Игра уже окончена", "warning");
                    return;
                }
                if (!pendingDraw) return;
                window.pendingDraw = pendingDraw;
                await window.acceptDraw(gameRef, roomId);
            }, {
                buttons: [acceptBtn, rejectBtn],
                loadingText: '...'
            });
        });

        // Отклонить ничью
        setClickHandler('draw-reject', () => {
            const acceptBtn = document.getElementById('draw-accept');
            const rejectBtn = document.getElementById('draw-reject');
            const pendingDraw = window.pendingDraw;
            document.getElementById('draw-request-box')?.classList.add('hidden');
            window.withUiActionLock('draw-reject', async () => {
                if (isFinishedGame()) {
                    window.pendingDraw = null;
                    window.notify("Игра уже окончена", "warning");
                    return;
                }
                if (!pendingDraw) return;
                window.pendingDraw = pendingDraw;
                await window.rejectDraw(gameRef, roomId);
            }, {
                buttons: [acceptBtn, rejectBtn],
                loadingText: '...'
            });
        });
    };

    const bindRematchControls = () => {
        if (isBotMode()) return;
        let lastIncomingRematchKey = '';

        const rematchRef = window.getRematchRef?.(roomId);
        if (typeof onValue !== 'undefined' && rematchRef) {
            onValue(rematchRef, (snap) => {
                const request = snap.val();
                const requestBox = document.getElementById('rematch-request-box');
                if (!request || !window.isRematchRequestRelevant?.(request) || isFinishedGame() === false) {
                    requestBox?.classList.add('hidden');
                    window.pendingRematch = null;
                    return;
                }

                const isIncoming = request.createdByUid
                    && request.createdByUid !== window.currentUser?.uid
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

                requestBox?.classList.add('hidden');
                window.pendingRematch = request;
            });
        }

        setClickHandler('rematch-accept', async () => {
            if (!window.pendingRematch || !window.currentUser?.uid) return;
            const newId = await window.confirmRematchForRoom(roomId, window.currentUser.uid);
            document.getElementById('rematch-request-box')?.classList.add('hidden');
            if (newId) {
                location.href = `${location.origin}${location.pathname}?room=${newId}`;
            }
        });

        setClickHandler('rematch-reject', async () => {
            if (!window.currentUser?.uid) return;
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
