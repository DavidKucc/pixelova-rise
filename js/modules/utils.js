// js/modules/utils.js
// Pomocné, znovupoužitelné funkce, které nejsou přímo vázané na herní logiku.
console.log('[DEBUG] utils.js loaded v=181');

import * as C from './config.js?v=181';
import { gameState } from './state.js?v=181';

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
    const id = externalId !== null ? externalId : (gameState.structures.size + Date.now() + Math.round(Math.random() * 10000));
    const newStructure = { id, type, x, y, w, h, data, ownerId: ownerId, upkeep: data.upkeep || null };

    if (type.includes('base')) {
        console.log(`[DEBUG] createStructure: VYTVÁŘÍM ZÁKLADNU! ID=${id}, type=${type}, owner=${ownerId}, pos=[${x},${y}]`);
    }

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

// v179: Jednoduchý A* pro dělníky (nekráčí tmou)
export function findPath(sx, sy, tx, ty, playerId) {
    sx = Math.round(sx); sy = Math.round(sy);
    tx = Math.round(tx); ty = Math.round(ty);

    if (sx === tx && sy === ty) return [{ x: tx, y: ty }];

    const openSet = [{ x: sx, y: sy, g: 0, f: Math.hypot(tx - sx, ty - sy), parent: null }];
    const closedSet = new Set();
    const openSetMap = new Map(); // Pro rychlé hledání
    openSetMap.set(`${sx},${sy}`, openSet[0]);

    let iterations = 0;
    const MAX_ITERATIONS = 1000; // Ochrana výkonu

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        // Najít uzel s nejnižším F
        let currentIndex = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[currentIndex].f) currentIndex = i;
        }
        const current = openSet.splice(currentIndex, 1)[0];
        openSetMap.delete(`${current.x},${current.y}`);
        closedSet.add(`${current.x},${current.y}`);

        // Cíl nalezen
        if (Math.hypot(current.x - tx, current.y - ty) < 1.5) {
            const path = [];
            let temp = current;
            while (temp) {
                path.push({ x: temp.x, y: temp.y });
                temp = temp.parent;
            }
            return path.reverse();
        }

        // Sousedé (4-směrní pro jednoduchost a rychlost)
        const neighbors = [
            { x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
            { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }
        ];

        for (const neighbor of neighbors) {
            if (neighbor.x < 0 || neighbor.x >= C.GRID_SIZE || neighbor.y < 0 || neighbor.y >= C.GRID_SIZE) continue;
            if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;

            const cell = gameState.gameBoard[neighbor.y][neighbor.x];
            // PODMÍNKA v179: Pouze objevená mapa (nebo vlastní území)
            if (!cell.visibleTo.includes(playerId)) continue;

            const gScore = current.g + 1;
            let neighborNode = openSetMap.get(`${neighbor.x},${neighbor.y}`);

            if (!neighborNode) {
                neighborNode = {
                    x: neighbor.x,
                    y: neighbor.y,
                    g: gScore,
                    f: gScore + Math.hypot(tx - neighbor.x, ty - neighbor.y),
                    parent: current
                };
                openSet.push(neighborNode);
                openSetMap.set(`${neighbor.x},${neighbor.y}`, neighborNode);
            } else if (gScore < neighborNode.g) {
                neighborNode.g = gScore;
                neighborNode.f = gScore + Math.hypot(tx - neighbor.x, ty - neighbor.y);
                neighborNode.parent = current;
            }
        }
    }

    // Fallback: Pokud cesta nenalezena (např. v179 gap), vrátíme aspoň přímou linku k cíli
    // ale v179 požadavek je "go around", takže pokud to nejde, dělník aspoň počká na další pokus.
    return iterations >= MAX_ITERATIONS ? null : [{ x: tx, y: ty }];
}