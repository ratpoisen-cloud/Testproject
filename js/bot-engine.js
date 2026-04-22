// ==================== BOT ENGINE (Stockfish Web Worker) ====================
// Ожидаемый путь к движку: js/engine/stockfish-18-lite-single.js
// Если движок требует .wasm, положите соответствующий .wasm файл вручную рядом с этим .js.

window.BOT_ENGINE_PATH = 'js/engine/stockfish-18-lite-single.js';
window.BOT_LEVELS = {
    easy: {
        label: 'Очень лёгкий',
        skill: 0,
        depth: 3,
        movetime: 50
    },
    medium: {
        label: 'Лёгкий',
        skill: 2,
        depth: 5,
        movetime: 100
    },
    hard: {
        label: 'Средний',
        skill: 4,
        depth: 8,
        movetime: 220
    }
};

window.createBotEngine = function(level = 'medium') {
    const profile = window.BOT_LEVELS[level] || window.BOT_LEVELS.medium;
    let worker = null;
    let activeResolver = null;
    let activeRejector = null;

    const clearPendingRequest = () => {
        activeResolver = null;
        activeRejector = null;
    };

    const onWorkerMessage = (event) => {
        const line = String(event?.data || '').trim();
        if (!line) return;

        if (line.startsWith('bestmove')) {
            const bestMove = line.split(/\s+/)[1] || null;
            if (activeResolver) {
                activeResolver(bestMove);
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
            if (activeRejector) {
                activeRejector(error);
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
        async getBestMove(fen) {
            ensureInitialized();
            if (!fen) return null;

            if (activeRejector) {
                activeRejector(new Error('Bot search interrupted by newer request'));
                clearPendingRequest();
            }

            return new Promise((resolve, reject) => {
                activeResolver = resolve;
                activeRejector = reject;

                send('stop');
                send(`position fen ${fen}`);
                send(`go depth ${profile.depth} movetime ${profile.movetime}`);
            });
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
