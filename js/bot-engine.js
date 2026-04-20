// ==================== BOT ENGINE (Stockfish Web Worker) ====================
// Ожидаемый путь к движку: js/engine/stockfish-18-lite-single.js
// Если движок требует .wasm, положите соответствующий .wasm файл вручную рядом с этим .js.

window.BOT_ENGINE_PATH = 'js/engine/stockfish-18-lite-single.js';
window.BOT_LEVELS = {
    easy: {
        label: 'Лёгкий',
        skill: 4,
        depth: 8,
        movetime: 220
    },
    medium: {
        label: 'Средний',
        skill: 10,
        depth: 12,
        movetime: 450
    },
    hard: {
        label: 'Сильный',
        skill: 16,
        depth: 16,
        movetime: 900
    }
};

window.createBotEngine = function(level = 'medium') {
    const profile = window.BOT_LEVELS[level] || window.BOT_LEVELS.medium;
    let worker = null;
    let activeRequest = null;

    const MATE_SCORE_PAWNS = 100;

    const clearPendingRequest = () => {
        activeRequest = null;
    };

    const parseScoreFromInfoLine = (line) => {
        const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/i);
        if (!match) return null;

        const scoreType = match[1]?.toLowerCase();
        const rawValue = Number(match[2]);
        if (!Number.isFinite(rawValue)) return null;

        if (scoreType === 'cp') {
            return {
                score: rawValue / 100,
                scoreType: 'cp',
                mateIn: null
            };
        }

        if (scoreType === 'mate') {
            return {
                score: rawValue === 0 ? 0 : (rawValue > 0 ? MATE_SCORE_PAWNS : -MATE_SCORE_PAWNS),
                scoreType: 'mate',
                mateIn: rawValue
            };
        }

        return null;
    };

    const onWorkerMessage = (event) => {
        const line = String(event?.data || '').trim();
        if (!line) return;

        if (activeRequest && line.startsWith('info')) {
            const scoreData = parseScoreFromInfoLine(line);
            if (scoreData !== null) {
                activeRequest.lastScore = scoreData.score;
                activeRequest.lastScoreType = scoreData.scoreType;
                activeRequest.lastMateIn = scoreData.mateIn;
            }
        }

        if (line.startsWith('bestmove')) {
            const bestMove = line.split(/\s+/)[1] || null;
            if (activeRequest?.resolve) {
                activeRequest.resolve({
                    bestMove,
                    score: Number.isFinite(activeRequest.lastScore) ? activeRequest.lastScore : 0,
                    scoreType: activeRequest.lastScoreType || 'cp',
                    mateIn: Number.isFinite(activeRequest.lastMateIn) ? activeRequest.lastMateIn : null
                });
            }
            clearPendingRequest();
        }
    };

    const send = (command) => {
        if (!worker) throw new Error('Bot worker is not initialized');
        worker.postMessage(command);
    };

    const ensureInitialized = () => {
        if (worker) return;
        worker = new Worker(window.BOT_ENGINE_PATH);
        worker.onmessage = onWorkerMessage;
        worker.onerror = (error) => {
            console.error('Stockfish worker error:', error);
            if (activeRequest?.reject) {
                activeRequest.reject(error);
            }
            clearPendingRequest();
        };

        send('uci');
        send('isready');
        send(`setoption name Skill Level value ${profile.skill}`);
    };

    return {
        level,
        profile,
        async getBestMoveWithEval(fen, options = {}) {
            ensureInitialized();
            if (!fen) return { bestMove: null, score: 0, scoreType: 'cp', mateIn: null };

            if (activeRequest?.reject) {
                activeRequest.reject(new Error('Bot search interrupted by newer request'));
                clearPendingRequest();
            }

            const depth = Number.isFinite(options.depth) ? options.depth : profile.depth;
            const movetime = Number.isFinite(options.movetime) ? options.movetime : profile.movetime;

            return new Promise((resolve, reject) => {
                activeRequest = {
                    resolve,
                    reject,
                    lastScore: null,
                    lastScoreType: null,
                    lastMateIn: null
                };

                send('stop');
                send(`position fen ${fen}`);
                send(`go depth ${depth} movetime ${movetime}`);
            });
        },
        async getBestMove(fen) {
            const result = await this.getBestMoveWithEval(fen);
            return result?.bestMove || null;
        },
        async analyzePositionForAdvice(fen, playedMove, options = {}) {
            if (!fen || !playedMove?.from || !playedMove?.to) {
                return {
                    bestMove: null,
                    bestEval: 0,
                    playedEval: 0,
                    delta: 0,
                    bestScoreType: 'cp',
                    bestMateIn: null,
                    playedScoreType: 'cp',
                    playedMateIn: null
                };
            }

            const beforeResult = await this.getBestMoveWithEval(fen, options);
            const bestEval = Number.isFinite(beforeResult?.score) ? beforeResult.score : 0;
            const bestMove = beforeResult?.bestMove || null;
            const bestScoreType = beforeResult?.scoreType === 'mate' ? 'mate' : 'cp';
            const bestMateIn = Number.isFinite(beforeResult?.mateIn) ? beforeResult.mateIn : null;

            const previewGame = new Chess(fen);
            const applied = previewGame.move({
                from: playedMove.from,
                to: playedMove.to,
                promotion: playedMove.promotion || 'q'
            });
            if (!applied) {
                return {
                    bestMove,
                    bestEval,
                    playedEval: bestEval,
                    delta: 0,
                    bestScoreType,
                    bestMateIn,
                    playedScoreType: bestScoreType,
                    playedMateIn: bestMateIn
                };
            }

            if (previewGame.in_checkmate?.()) {
                return {
                    bestMove,
                    bestEval,
                    playedEval: bestEval,
                    delta: 0,
                    bestScoreType,
                    bestMateIn,
                    playedScoreType: 'mate',
                    playedMateIn: 0
                };
            }

            const afterResult = await this.getBestMoveWithEval(previewGame.fen(), options);
            const playedEval = Number.isFinite(afterResult?.score) ? -afterResult.score : bestEval;
            const delta = Math.max(0, bestEval - playedEval);
            const playedScoreType = afterResult?.scoreType === 'mate' ? 'mate' : 'cp';
            const playedMateIn = Number.isFinite(afterResult?.mateIn) ? -afterResult.mateIn : null;

            return {
                bestMove,
                bestEval,
                playedEval,
                delta,
                bestScoreType,
                bestMateIn,
                playedScoreType,
                playedMateIn
            };
        },
        destroy() {
            try {
                if (worker) {
                    send('stop');
                    send('quit');
                    worker.terminate();
                }
            } catch (error) {
                console.warn('Bot worker termination warning:', error);
            } finally {
                worker = null;
                clearPendingRequest();
            }
        }
    };
};
