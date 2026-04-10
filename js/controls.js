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

        const playersData = (await get(window.getPlayersRef(roomId))).val();
        if (!playersData?.white || !playersData?.black) {
            window.notify("Не удалось создать реванш: данные игроков недоступны", "error");
            return;
        }
        const newId = window.generateRoomId();

        await set(window.getGameRef(newId), {
            players: {
                white: playersData.black,
                whiteName: playersData.blackName,
                black: playersData.white,
                blackName: playersData.whiteName
            },
            pgn: new Chess().pgn(),
            fen: 'start',
            gameState: 'active',
            createdAt: Date.now()
        });

        location.href = location.origin + location.pathname + `?room=${newId}`;
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
        hideElement('confirm-move-box');
        window.clearSelection();
    };

    const isFinishedGame = () => {
        if (typeof window.isGameFinished === 'function') {
            return window.isGameFinished();
        }
        return Boolean(window.game?.game_over?.() || window.lastKnownGameState === 'game_over');
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

            window.updateBoardPosition(window.game.fen(), true);

            const now = Date.now();
            const updateData = {
                pgn: window.game.pgn(),
                fen: window.game.fen(),
                turn: window.game.turn(),
                lastMove: now,
                lastMoveTime: now // Добавляем время последнего хода для сортировки
            };

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
                const winner = window.playerColor === 'w' ? 'Черные' : 'Белые';
                const players = await resolvePlayersForHeaders();
                const metadata = window.applyGameHeaders(window.game, {
                    players,
                    gameState: 'game_over',
                    message: `${winner} победили (сдача)`,
                    resign: window.playerColor
                });
                window.updateGame(gameRef, {
                    gameState: 'game_over',
                    message: metadata.message,
                    pgn: window.game.pgn(),
                    resign: window.playerColor
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
                    requestBox?.classList.remove('hidden');
                    window.pendingTakeback = request;
                }
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

    bindPendingMoveControls();
    bindSessionControls();
    bindReviewControls();
    bindTakebackControls();
    bindDrawControls();
    bindGameOverControls();
};
