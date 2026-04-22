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
        if (isPassAndPlayMode()) {
            window.initPassAndPlayGame({ variant: 'standard' });
            return;
        }
        if (window.isSelfTrainingMode?.()) {
            window.initTrainingGame({ mode: 'self' });
            return;
        }
        if (window.isBotMode) {
            window.initBotGame({ color: window.playerColor, level: window.botLevel || 'medium' });
            return;
        }
        if (window.isPassAndPlayStandardMode?.()) {
            window.initPassAndPlayGame({ variant: 'standard' });
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
    const isSelfTrainingMode = () => Boolean(window.isSelfTrainingMode?.());
    const isPassAndPlayMode = () => Boolean(window.isPassAndPlayStandardMode?.());
    const isLocalMode = () => Boolean(window.isLocalGameMode?.());

    window.requestBotMove = async function() {
        if (!isBotMode() || !window.botEngine || !window.game || window.game.game_over()) return;
        if (window.game.turn() !== window.botColor) return;
        if (window.isBotThinking) return;

        window.isBotThinking = true;
        window.updateTurnIndicator(false);

        try {
            const botTurnSessionId = window.currentBotSessionId || null;
            const botTurnFen = window.game.fen();
            const engineSearchStartedAt = performance.now();
            const bestMove = await window.botEngine.getBestMove(botTurnFen);
            if (!bestMove || bestMove === '(none)' || !window.isBotMode) return;

            const engineSearchElapsedMs = performance.now() - engineSearchStartedAt;
            const legalMovesCount = window.game.moves?.().length || 0;
            const isFastEndgameHint = legalMovesCount <= 4 || Boolean(window.game.in_check?.());
            const visualDelayTargetMs = getBotVisualThinkingDelayMs({
                level: window.botLevel,
                isFastEndgameHint
            });
            const remainingVisualDelayMs = Math.max(0, visualDelayTargetMs - engineSearchElapsedMs);
            await waitForMs(remainingVisualDelayMs);

            if (!isBotMode() || !window.botEngine || !window.game || window.game.game_over()) return;
            if (window.game.turn() !== window.botColor) return;
            if ((window.currentBotSessionId || null) !== botTurnSessionId) return;
            if (window.game.fen() !== botTurnFen) return;

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
            const errorMessage = String(error?.message || error || '');
            if (errorMessage.includes('ready timeout')) {
                console.error('Ошибка хода бота: ready timeout', error);
            } else if (errorMessage.includes('search timeout')) {
                console.error('Ошибка хода бота: search timeout', error);
            } else if (errorMessage.includes('worker script not found')) {
                console.error('Ошибка хода бота: worker script not found', error);
            } else if (errorMessage.includes('wasm not found')) {
                console.error('Ошибка хода бота: wasm not found', error);
            } else if (errorMessage.includes('engine init failed')) {
                console.error('Ошибка хода бота: engine init failed', error);
            } else {
                console.error('Ошибка хода бота:', error);
            }
            window.notify('Не удалось получить ход бота', 'error', 2600);
        } finally {
            window.isBotThinking = false;
        }
    };


    const applyLocalModeUiRestrictions = () => {
        if (!isLocalMode()) return;
        document.querySelector('.game-share-box')?.classList.add('hidden');
        document.getElementById('draw-btn')?.classList.add('hidden');
        const drawBtn = document.getElementById('draw-btn');
        if (drawBtn) drawBtn.disabled = true;
        document.getElementById('quick-phrases-toggle')?.classList.add('hidden');
        document.getElementById('quick-phrases-menu')?.classList.add('hidden');
        const takebackBtn = document.getElementById('takeback-btn');
        if (takebackBtn && isBotMode()) {
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

            if (isBotMode() || isSelfTrainingMode() || isPassAndPlayMode()) {
                window.syncReviewStateFromCurrentGame?.();
                resetPendingMoveUI();
                if (isPassAndPlayMode()) {
                    window.syncPassAndPlayBoardOrientation?.();
                }
                window.updateUI({
                    gameState: window.game.game_over() ? 'game_over' : 'active',
                    mode: isBotMode() ? 'bot' : (isPassAndPlayMode() ? 'pass' : 'training'),
                    trainingMode: isSelfTrainingMode() ? 'self' : null,
                    variant: isPassAndPlayMode() ? 'standard' : null
                });
                if (isPassAndPlayMode()) {
                    window.savePassAndPlayGameSnapshot?.({
                        gameState: window.game.game_over() ? 'game_over' : 'active'
                    });
                }

                if (window.game.game_over()) {
                    const metadata = window.applyGameHeaders(window.game, {
                        gameState: 'game_over',
                        message: window.getGameResultMessage(window.game)
                    });
                    window.updateGameModal({ gameState: 'game_over', message: metadata.message });
                    document.getElementById('game-modal')?.classList.remove('hidden');
                    return;
                }

                if (isBotMode()) {
                    await window.requestBotMove?.();
                }
                return;
            }

            if (isPassAndPlayMode()) {
                window.playerColor = window.game.turn();
                window.syncReviewStateFromCurrentGame?.();
                resetPendingMoveUI();
                window.updateUI({ gameState: window.game.game_over() ? 'game_over' : 'active', mode: 'pass-and-play' });
                window.syncPassAndPlayOrientation?.();

                if (window.game.game_over()) {
                    const metadata = window.applyGameHeaders(window.game, {
                        gameState: 'game_over',
                        message: window.getGameResultMessage(window.game)
                    });
                    window.updateGameModal({ gameState: 'game_over', message: metadata.message, mode: 'pass-and-play' });
                }
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
                const resignColor = isSelfTrainingMode() ? window.game?.turn?.() : window.playerColor;
                const winner = resignColor === 'w' ? 'Черные' : 'Белые';
                const players = isLocalMode() ? null : await resolvePlayersForHeaders();
                const metadata = window.applyGameHeaders(window.game, {
                    players,
                    gameState: 'game_over',
                    message: `${winner} победили (сдача)`,
                    resign: resignColor
                });

                if (isLocalMode()) {
                    window.applyImmediateGameOverState?.({
                        gameState: 'game_over',
                        message: metadata.message,
                        resign: resignColor,
                        mode: isBotMode() ? 'bot' : 'training',
                        trainingMode: isSelfTrainingMode() ? 'self' : null
                    });
                    document.getElementById('game-modal')?.classList.remove('hidden');
                    return;
                }

                const updateData = {
                    gameState: 'game_over',
                    message: metadata.message,
                    pgn: window.game.pgn(),
                    resign: resignColor
                };
                window.applyImmediateGameOverState?.(updateData);
                await window.updateGame(gameRef, updateData);
            }
        });

        // Выход в лобби
        const goBackToLobby = async () => {
            const shouldExit = await window.confirmAction({
                title: "Выйти в лобби?",
                message: isPassAndPlayMode()
                    ? "Текущая локальная партия не сохранится."
                    : "Текущая партия останется сохранённой.",
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
            if (isLocalMode()) return;
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
        if (isSelfTrainingMode()) {
            setClickHandler('takeback-btn', () => {
                if (isFinishedGame()) {
                    window.notify("Игра уже окончена", "warning");
                    return;
                }
                const undoneMove = window.game?.undo?.();
                if (!undoneMove) {
                    window.notify("Нет ходов для отмены", "warning");
                    return;
                }
                resetPendingMoveUI();
                window.clearSelection();
                window.updateBoardPosition(window.game.fen(), true);
                window.syncReviewStateFromCurrentGame?.();
                window.updateUI({ gameState: 'active', mode: 'training', trainingMode: 'self' });
            });
            return;
        }
        if (isPassAndPlayMode()) {
            setClickHandler('takeback-btn', () => {
                const undoneMove = window.game?.undo?.();
                if (!undoneMove) {
                    window.notify("Нет ходов для отмены", "warning");
                    return;
                }
                resetPendingMoveUI();
                window.clearSelection();
                window.updateBoardPosition(window.game.fen(), true);
                window.syncPassAndPlayBoardOrientation?.();
                window.syncReviewStateFromCurrentGame?.();
                document.getElementById('game-modal')?.classList.add('hidden');
                const isStillFinished = Boolean(window.game?.game_over?.());
                if (!isStillFinished) {
                    window.lastKnownGameState = 'active';
                }
                window.updateUI({
                    gameState: isStillFinished ? 'game_over' : 'active',
                    mode: 'pass',
                    variant: 'standard'
                });
                window.savePassAndPlayGameSnapshot?.({
                    gameState: isStillFinished ? 'game_over' : 'active'
                });
            });
            return;
        }
        if (isBotMode()) return;
        if (isPassAndPlayMode()) {
            setClickHandler('takeback-btn', () => {
                if (window.game.history().length === 0) {
                    window.notify("Нет ходов для отмены", "warning");
                    return;
                }
                window.game.undo();
                window.updateBoardPosition(window.game.fen(), true);
                window.syncReviewStateFromCurrentGame?.();
                const history = window.game.history({ verbose: true });
                if (history.length > 0) {
                    window.highlightLastMove?.(history[history.length - 1]);
                } else {
                    window.removeHighlights?.();
                }
                window.clearSelection();
                window.syncPassAndPlayOrientation?.();
                if (!window.game.game_over()) {
                    window.lastKnownGameState = 'active';
                }
                document.getElementById('game-modal')?.classList.add('hidden');
                window.playerColor = window.game.turn();
                window.updateUI({ gameState: 'active', mode: 'pass-and-play' });
            });
            return;
        }
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
        if (isLocalMode()) return;
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
        if (isLocalMode()) return;
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

        setClickHandler('modal-analysis-btn', async () => {
            if (!window.postGameAnalysis?.supportedMode) return;
            const opened = await window.openPostGameAnalysis?.();
            if (opened) {
                document.getElementById('game-modal')?.classList.add('hidden');
            }
        });

        setClickHandler('inline-analysis-btn', async () => {
            if (!window.postGameAnalysis?.supportedMode) return;
            await window.openPostGameAnalysis?.();
        });

        bindPgnCopyButton('modal-copy-pgn');
        bindPgnCopyButton('inline-copy-pgn');
    };

    applyLocalModeUiRestrictions();

    bindPendingMoveControls();
    bindSessionControls();
    bindReviewControls();
    bindTakebackControls();
    bindDrawControls();
    bindRematchControls();
    bindGameOverControls();
};
