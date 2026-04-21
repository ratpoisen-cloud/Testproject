// ==================== BOT ENGINE (Stockfish Web Worker) ====================
// Ожидаемый путь к движку: js/engine/stockfish-18-lite-single.js
// Если движок требует .wasm, положите соответствующий .wasm файл вручную рядом с этим .js.

window.BOT_ENGINE_PATH = 'js/engine/stockfish-18-lite-single.js';
window.BOT_ENGINE_WASM_PATH = 'js/engine/stockfish-18-lite-single.wasm';
window.BOT_ANALYSIS_PROFILE = {
    skill: 9,
    depth: 11,
    movetime: 420
};
window.BOT_LEVELS = {
    easy: {
        label: 'Лёгкий',
        skill: 1,
        depth: 4,
        movetime: 120
    },
    medium: {
        label: 'Средний',
        skill: 3,
        depth: 6,
        movetime: 170
    },
    hard: {
        label: 'Сильный',
        skill: 4,
        depth: 8,
        movetime: 220
    }
};

window.createBotEngine = function(level = 'medium', options = {}) {
    const profile = options?.profile || window.BOT_LEVELS[level] || window.BOT_LEVELS.medium;
    let worker = null;
    let activeRequest = null;
    let readyPromise = null;
    let resolveReady = null;
    let rejectReady = null;
    let isReady = false;

    const MATE_SCORE_PAWNS = 100;
    const ENGINE_READY_TIMEOUT_MS = 5000;
    const SEARCH_TIMEOUT_MS = 12000;

    const clearPendingRequest = () => {
        if (activeRequest?.timeoutId) {
            clearTimeout(activeRequest.timeoutId);
        }
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

        if (line === 'readyok') {
            isReady = true;
            resolveReady?.();
            resolveReady = null;
            rejectReady = null;
            return;
        }

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

    const resolveEngineWorkerUrl = () => {
        const scriptUrl = new URL(window.BOT_ENGINE_PATH, window.location.href);
        const explicitWasmPath = window.BOT_ENGINE_WASM_PATH || scriptUrl.href.replace(/\.js(\?.*)?$/, '.wasm$1');
        const wasmUrl = new URL(explicitWasmPath, window.location.href);
        const workerHash = `${encodeURIComponent(wasmUrl.href)},worker`;
        return `${scriptUrl.href}#${workerHash}`;
    };

    const ensureInitialized = () => {
        if (worker) return;
        worker = new Worker(resolveEngineWorkerUrl());
        readyPromise = new Promise((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        worker.onmessage = onWorkerMessage;
        worker.onerror = (error) => {
            console.error('Stockfish worker error:', error);
            rejectReady?.(error);
            resolveReady = null;
            rejectReady = null;
            if (activeRequest?.reject) {
                activeRequest.reject(error);
            }
            clearPendingRequest();
        };

        send('uci');
        send(`setoption name Skill Level value ${profile.skill}`);
        send('isready');
    };

    const waitForEngineReady = async () => {
        ensureInitialized();
        if (isReady) return;

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Bot engine ready timeout')), ENGINE_READY_TIMEOUT_MS);
        });

        await Promise.race([readyPromise, timeoutPromise]);
    };

    return {
        level,
        profile,
        async getBestMoveWithEval(fen, options = {}) {
            await waitForEngineReady();
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
                    lastMateIn: null,
                    timeoutId: setTimeout(() => {
                        reject(new Error('Bot engine search timeout'));
                        clearPendingRequest();
                    }, SEARCH_TIMEOUT_MS)
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
            let bestContinuationSan = null;

            if (bestMove && bestScoreType === 'mate' && Number.isFinite(bestMateIn) && bestMateIn > 1 && bestMateIn <= 4) {
                try {
                    const previewDepth = Number.isFinite(options.depth) ? Math.max(8, options.depth - 2) : 8;
                    const previewMovetime = Number.isFinite(options.movetime) ? Math.min(options.movetime, 260) : 220;
                    const previewOptions = { depth: previewDepth, movetime: previewMovetime };
                    const bestLineGame = new Chess(fen);
                    const firstApplied = bestLineGame.move({
                        from: bestMove.slice(0, 2),
                        to: bestMove.slice(2, 4),
                        promotion: bestMove.slice(4, 5) || 'q'
                    });

                    if (firstApplied) {
                        const opponentReply = await this.getBestMoveWithEval(bestLineGame.fen(), previewOptions);
                        const opponentBestMove = opponentReply?.bestMove || null;
                        if (opponentBestMove) {
                            bestLineGame.move({
                                from: opponentBestMove.slice(0, 2),
                                to: opponentBestMove.slice(2, 4),
                                promotion: opponentBestMove.slice(4, 5) || 'q'
                            });
                        }

                        const followUp = await this.getBestMoveWithEval(bestLineGame.fen(), previewOptions);
                        const followUpMove = followUp?.bestMove || null;
                        if (followUpMove) {
                            const followUpApplied = bestLineGame.move({
                                from: followUpMove.slice(0, 2),
                                to: followUpMove.slice(2, 4),
                                promotion: followUpMove.slice(4, 5) || 'q'
                            });
                            if (followUpApplied?.san) {
                                bestContinuationSan = `${firstApplied.san} → ${followUpApplied.san}`;
                            }
                        }
                    }
                } catch (continuationError) {
                    bestContinuationSan = null;
                    console.warn('Не удалось построить короткую матовую идею:', continuationError);
                }
            }

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
                    playedMateIn: bestMateIn,
                    bestContinuationSan
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
                    playedMateIn: 0,
                    bestContinuationSan
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
                playedMateIn,
                bestContinuationSan
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

window.createBotAnalysisEngine = function() {
    return window.createBotEngine('medium', {
        profile: window.BOT_ANALYSIS_PROFILE
    });
};
