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
    let initPromise = null;
    let enginePaths = null;
    let isReady = false;

    const MATE_SCORE_PAWNS = 100;
    const ENGINE_READY_TIMEOUT_MS = 20000;
    const SEARCH_TIMEOUT_MS = 12000;

    const clearPendingRequest = () => {
        if (activeRequest?.timeoutId) {
            clearTimeout(activeRequest.timeoutId);
        }
        activeRequest = null;
    };

    const createReadyPromise = () => {
        readyPromise = new Promise((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
    };

    const rejectEngineReady = (error) => {
        if (rejectReady) {
            rejectReady(error);
        }
        resolveReady = null;
        rejectReady = null;
    };

    const hardResetEngineState = ({ error = null, terminateWorker = true } = {}) => {
        const normalizedError = error instanceof Error ? error : (error ? new Error(String(error)) : new Error('engine reset'));

        if (activeRequest?.reject) {
            activeRequest.reject(normalizedError);
        }
        clearPendingRequest();

        if (terminateWorker && worker) {
            try {
                worker.terminate();
            } catch (terminateError) {
                console.warn('Bot worker termination warning:', terminateError);
            }
        }

        rejectEngineReady(normalizedError);
        readyPromise = null;
        resolveReady = null;
        rejectReady = null;
        worker = null;
        initPromise = null;
        enginePaths = null;
        isReady = false;
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

    const uniqueResolvedUrls = (pathCandidates) => {
        const urls = [];
        const visited = new Set();

        pathCandidates
            .filter(Boolean)
            .forEach((candidate) => {
                try {
                    const href = new URL(candidate, window.location.href).href;
                    if (!visited.has(href)) {
                        visited.add(href);
                        urls.push(href);
                    }
                } catch (urlError) {
                    console.warn('bot engine init failed: invalid URL candidate:', candidate, urlError);
                }
            });

        return urls;
    };

    const probeUrlExists = async (url) => {
        const fetchOptions = { cache: 'no-store' };
        try {
            const headResponse = await fetch(url, { ...fetchOptions, method: 'HEAD' });
            if (headResponse.ok) return true;
        } catch (headError) {
            // Some static hosts do not support HEAD correctly; fallback to GET below.
        }

        try {
            const getResponse = await fetch(url, { ...fetchOptions, method: 'GET' });
            return getResponse.ok;
        } catch (error) {
            return false;
        }
    };

    const pickFirstExistingUrl = async (urls, errorLabel) => {
        for (const url of urls) {
            // eslint-disable-next-line no-await-in-loop
            const exists = await probeUrlExists(url);
            if (exists) return url;
        }
        console.error(errorLabel, urls);
        return null;
    };

    const pickUrlWithFallback = async (urls, missingLabel) => {
        const foundUrl = await pickFirstExistingUrl(urls, missingLabel);
        if (foundUrl) return foundUrl;

        const fallbackUrl = urls[0] || null;
        if (fallbackUrl) {
            console.warn(`${missingLabel}: using unchecked fallback`, fallbackUrl);
        }
        return fallbackUrl;
    };
    const resolveEnginePaths = async () => {
        const scriptCandidates = uniqueResolvedUrls([
            window.BOT_ENGINE_PATH,
            'js/engine/stockfish-18-lite-single.js',
            'js/stockfish-18-lite-single.js',
            'stockfish-18-lite-single.js'
        ]);
        const scriptUrl = await pickUrlWithFallback(scriptCandidates, 'worker script not found');
        if (!scriptUrl) {
            throw new Error('worker script not found');
        }

        const scriptUrlObject = new URL(scriptUrl);
        const scriptBaseName = scriptUrlObject.pathname.split('/').pop() || 'stockfish-18-lite-single.js';
        const scriptDirectory = scriptUrl.slice(0, scriptUrl.lastIndexOf('/') + 1);
        const derivedWasmName = scriptBaseName.replace(/\.js(\?.*)?$/, '.wasm$1');
        const wasmCandidates = uniqueResolvedUrls([
            window.BOT_ENGINE_WASM_PATH,
            scriptUrl.replace(/\.js(\?.*)?$/, '.wasm$1'),
            `${scriptDirectory}${derivedWasmName}`,
            'js/engine/stockfish-18-lite-single.wasm',
            'js/stockfish-18-lite-single.wasm',
            'stockfish-18-lite-single.wasm'
        ]);
        const wasmUrl = await pickUrlWithFallback(wasmCandidates, 'wasm not found');
        if (!wasmUrl) {
            throw new Error('wasm not found');
        }

        return { scriptUrl, wasmUrl };
    };

    const buildWorkerUrl = (paths) => {
        const workerHash = `${encodeURIComponent(paths.wasmUrl)},worker`;
        return `${paths.scriptUrl}#${workerHash}`;
    };

    const ensureInitialized = async () => {
        if (isReady && worker) return;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            enginePaths = await resolveEnginePaths();
            createReadyPromise();
            worker = new Worker(buildWorkerUrl(enginePaths));
            worker.onmessage = onWorkerMessage;
            worker.onerror = (error) => {
                const workerError = error instanceof Error ? error : new Error('engine init failed: worker error');
                console.error('engine init failed: worker error', {
                    error,
                    scriptUrl: enginePaths?.scriptUrl || null,
                    wasmUrl: enginePaths?.wasmUrl || null
                });
                hardResetEngineState({ error: workerError });
            };

            send('uci');
            send(`setoption name Skill Level value ${profile.skill}`);
            send('isready');
        })().catch((error) => {
            console.error('engine init failed', error);
            hardResetEngineState({ error, terminateWorker: false });
            throw error;
        });

        return initPromise;
    };

    const waitForEngineReady = async () => {
        await ensureInitialized();
        if (isReady) return;

        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                const timeoutError = new Error('ready timeout');
                console.error('ready timeout', {
                    timeoutMs: ENGINE_READY_TIMEOUT_MS,
                    scriptUrl: enginePaths?.scriptUrl || null,
                    wasmUrl: enginePaths?.wasmUrl || null
                });
                hardResetEngineState({ error: timeoutError });
                reject(timeoutError);
            }, ENGINE_READY_TIMEOUT_MS);
        });

        try {
            await Promise.race([readyPromise, timeoutPromise]);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
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
                        console.error('search timeout', {
                            timeoutMs: SEARCH_TIMEOUT_MS,
                            fen
                        });
                        reject(new Error('search timeout'));
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
                }
            } catch (error) {
                console.warn('Bot worker termination warning:', error);
            } finally {
                hardResetEngineState();
            }
        }
    };
};

window.createBotAnalysisEngine = function() {
    return window.createBotEngine('medium', {
        profile: window.BOT_ANALYSIS_PROFILE
    });
};
