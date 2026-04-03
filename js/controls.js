// ==================== КНОПКИ УПРАВЛЕНИЯ ====================

window.setupGameControls = function(gameRef, roomId) {
    const resolvePlayersForHeaders = async () => {
        const snap = await get(window.getPlayersRef(roomId));
        return snap.val() || null;
    };

    // Подтверждение хода
    document.getElementById('confirm-btn').onclick = async () => {
    if (!window.pendingMove) return;
    
    const moveResult = window.game.move({
        from: window.pendingMove.from,
        to: window.pendingMove.to,
        promotion: window.pendingMove.promotion || 'q'
    });
    
    if (!moveResult) {
        window.pendingMove = null;
        document.getElementById('confirm-move-box')?.classList.add('hidden');
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
        lastMoveTime: now  // Добавляем время последнего хода для сортировки
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
    
    window.pendingMove = null;
    document.getElementById('confirm-move-box')?.classList.add('hidden');
    window.clearSelection();
};
    
    // Отмена неподтвержденного хода - ПЛАВНЫЙ ВОЗВРАТ ФИГУРЫ
    document.getElementById('cancel-move-btn').onclick = () => {
        if (window.pendingMove) {
            window.pendingMove = null;
            document.getElementById('confirm-move-box')?.classList.add('hidden');
            
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
    };
    
    // Сдача
    document.getElementById('resign-btn').onclick = async () => {
        if (window.game.game_over()) {
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
    };
    
    // Выход в лобби
    document.getElementById('exit-btn').onclick = async () => {
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
    
    // Поделиться ссылкой
    document.getElementById('share-btn').onclick = async () => {
        const link = document.getElementById('room-link').value;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Шахматная партия', url: link });
            } catch {}
        } else {
            navigator.clipboard.writeText(link);
            window.notify('Ссылка скопирована!', 'success');
        }
    };

    // Review controls
    document.getElementById('review-first-btn').onclick = () => {
        if (!window.game) return;
        window.enterReviewMode(0);
    };

    document.getElementById('review-prev-btn').onclick = () => {
        if (!window.game) return;
        if (!window.reviewMode) {
            window.enterReviewMode();
        }
        window.stepReview(-1);
    };

    document.getElementById('review-next-btn').onclick = () => {
        if (!window.game) return;
        if (!window.reviewMode) {
            window.enterReviewMode();
        }
        window.stepReview(1);
    };

    document.getElementById('review-last-btn').onclick = () => {
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
    };
    
    // Запрос отмены хода
    document.getElementById('takeback-btn').onclick = () => {
        if (window.game.history().length === 0) {
            window.notify("Нет ходов для отмены", "warning");
            return;
        }
        if (window.game.game_over()) {
            window.notify("Игра уже окончена", "warning");
            return;
        }
        window.updateGame(gameRef, { takebackRequest: { from: window.playerColor, timestamp: Date.now() } });
        window.notify("Запрос отправлен сопернику", "success");
    };
    
    // Слушатель запроса отмены
    const takebackRef = window.getTakebackRef(roomId);
    if (typeof onValue !== 'undefined') {
        onValue(takebackRef, (snap) => {
            const request = snap.val();
            if (!request) {
                document.getElementById('takeback-request-box').classList.add('hidden');
                window.pendingTakeback = null;
                return;
            }
            
            if (request.from !== window.playerColor && !request.answered) {
                document.getElementById('takeback-request-box').classList.remove('hidden');
                window.pendingTakeback = request;
            }
        });
    }
    
    // Принять отмену
    document.getElementById('takeback-accept').onclick = () => {
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
    };
    
    // Отклонить отмену
    document.getElementById('takeback-reject').onclick = () => {
        window.updateGame(gameRef, { takebackRequest: null });
        document.getElementById('takeback-request-box').classList.add('hidden');
        window.pendingTakeback = null;
    };
    // ===== ЛОГИКА ПРЕДЛОЖЕНИЯ НИЧЬЕЙ =====

// Кнопка "Предложить ничью"
document.getElementById('draw-btn').onclick = () => {
    if (window.game.game_over()) {
        window.notify("Игра уже окончена", "warning");
        return;
    }
    if (window.pendingDraw) {
        window.notify("Запрос уже отправлен", "warning");
        return;
    }
    window.sendDrawRequest(gameRef, roomId);
};

// Слушатель запроса на ничью
const drawRef = window.getDrawRef(roomId);
if (typeof onValue !== 'undefined') {
    onValue(drawRef, (snap) => {
        const request = snap.val();
        if (!request) {
            document.getElementById('draw-request-box').classList.add('hidden');
            window.pendingDraw = null;
            return;
        }
        
        if (request.from !== window.playerColor && !request.answered) {
            document.getElementById('draw-request-text').innerHTML = 
                `${request.fromName || 'Соперник'} предлагает ничью`;
            document.getElementById('draw-request-box').classList.remove('hidden');
            window.pendingDraw = request;
        }
    });
}

// Принять ничью
document.getElementById('draw-accept').onclick = () => {
    if (window.pendingDraw) {
        window.acceptDraw(gameRef, roomId);
    }
};

// Отклонить ничью
document.getElementById('draw-reject').onclick = () => {
    if (window.pendingDraw) {
        window.rejectDraw(gameRef, roomId);
    }
};
    // Реванш
    document.getElementById('modal-rematch-btn').onclick = async () => {
        const modal = document.getElementById('game-modal');
        modal.classList.add('hidden');
        
        const playersData = (await get(window.getPlayersRef(roomId))).val();
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
    
    // Выход из модального окна
    document.getElementById('modal-exit-btn').onclick = () => {
        document.getElementById('game-modal').classList.add('hidden');
        location.href = location.origin + location.pathname;
    };

    // Открыть просмотр из модалки окончания игры
    document.getElementById('modal-review-btn').onclick = () => {
        document.getElementById('game-modal').classList.add('hidden');
        if (!window.game) return;
        const maxPly = window.game.history().length;
        window.enterReviewMode(maxPly);
    };

    // --- Логика копирования PGN из модалки ---
    const modalCopyBtn = document.getElementById('modal-copy-pgn');
    if (modalCopyBtn) {
        modalCopyBtn.onclick = () => {
            const pgn = window.game.pgn();
            if (!pgn) {
                window.notify("Нет данных партии", "warning");
                return;
            }

            navigator.clipboard.writeText(pgn).then(() => {
                const originalText = modalCopyBtn.innerText;
                modalCopyBtn.innerText = '✅ Ок!';
                setTimeout(() => modalCopyBtn.innerText = originalText, 2000);
            });
        };
    }

    // --- Логика скачивания PGN из модалки ---
    const modalDownloadBtn = document.getElementById('modal-download-pgn');
    if (modalDownloadBtn) {
        modalDownloadBtn.onclick = () => {
            const pgn = window.game.pgn();
            if (!pgn) return;

            const blob = new Blob([pgn], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `game_${roomId || 'chess'}.pgn`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        };
    }

};
