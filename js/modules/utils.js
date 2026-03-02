// js/modules/utils.js
// Pomocné, znovupoužitelné funkce, které nejsou přímo vázané na herní logiku.
console.log('[DEBUG] utils.js loaded v=158');

import * as C from './config.js?v=158';
import { gameState } from './state.js?v=158';

export function getNeighbors(x, y) {
    const n = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || !gameState.gameBoard[y + dy]?.[x + dx]) continue;
            n.push(gameState.gameBoard[y + dy][x + dx]);
        }
    }
    return n;
}

export function isAreaClear(x, y, w, h) {
    for (let i = y; i < y + h; i++) {
        for (let j = x; j < x + w; j++) {
            if (i >= C.GRID_SIZE || j >= C.GRID_SIZE || gameState.gameBoard[i]?.[j]?.structureId !== null) {
                return false;
            }
        }
    }
    return true;
}

export function createStructure(type, x, y, w, h, data, ownerId, externalId = null) {
    const id = externalId !== null ? externalId : (gameState.structures.size + Date.now() + Math.floor(Math.random() * 1000));
    const newStructure = { id, type, x, y, w, h, data, ownerId: ownerId, upkeep: data.upkeep || null };
    gameState.structures.set(id, newStructure);

    for (let i = y; i < y + h; i++) {
        for (let j = x; j < x + w; j++) {
            const cell = gameState.gameBoard[i]?.[j];
            if (cell) {
                // Toto je klíčové: každá buňka, kterou struktura zabírá,
                // musí dostat ID této struktury.
                cell.structureId = id;

                // Pokud je struktura vytvářena s vlastníkem (např. startovní základna),
                // rovnou mu přiřadíme i buňky pod ní.
                if (ownerId) {
                    cell.ownerId = ownerId;
                    if (!cell.visibleTo.includes(ownerId)) {
                        cell.visibleTo.push(ownerId);
                    }
                }
            }
        }
    }
    gameState.needsRedraw = true;
}

export function placeRandomStructure(type, size, data) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 500) {
        const x = Math.floor(Math.random() * (C.GRID_SIZE - size));
        const y = Math.floor(Math.random() * (C.GRID_SIZE - size));
        if (isAreaClear(x, y, size, size)) {
            createStructure(type, x, y, size, size, data, null);
            placed = true;
        }
        attempts++;
    }
}