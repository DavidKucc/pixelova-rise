// js/modules/logger.js
// Rozšířený logovací systém pro lepší debugging.
console.log('[DEBUG] logger.js loaded v=142');

const LOG_PREFIX = '[GAME]';

export const Logger = {
    log: (msg, data = null) => {
        if (data) {
            console.log(`${LOG_PREFIX} [INFO] ${msg}`, data);
        } else {
            console.log(`${LOG_PREFIX} [INFO] ${msg}`);
        }
    },

    warn: (msg, data = null) => {
        if (data) {
            console.warn(`${LOG_PREFIX} [WARN] ${msg}`, data);
        } else {
            console.warn(`${LOG_PREFIX} [WARN] ${msg}`);
        }
    },

    error: (msg, data = null) => {
        if (data) {
            console.error(`${LOG_PREFIX} [ERROR] ${msg}`, data);
        } else {
            console.error(`${LOG_PREFIX} [ERROR] ${msg}`);
        }
    },

    // Speciální metoda pro debug (může být v budoucnu vypnuta)
    debug: (msg, data = null) => {
        // Odkomentuj pro zapnutí debug logů
        // console.debug(`${LOG_PREFIX} [DEBUG] ${msg}`, data ? data : '');
    }
};
