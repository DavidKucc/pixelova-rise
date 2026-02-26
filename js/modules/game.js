console.log('[DEBUG] game.js loaded v=131');

import * as C from './config.js?v=131';
import { gameState, viewportState } from './state.js?v=131';
import { ui, updateUI, updateExpeditionsPanel, updateActionPanel, logMessage, createContextMenu, removeContextMenu } from './ui.js?v=131';
import { getNeighbors, isAreaClear, createStructure, placeRandomStructure } from './utils.js?v=131';
import { attachEventListeners } from './input.js?v=131';
import { gameLoop } from './renderer.js?v=131';
import { runAIDecision } from './ai.js?v=131';
import { Logger } from './logger.js?v=131';

// Nový objekt pro definici hráčů a jejich barev
export const PLAYER_DEFINITIONS = {
    'human': { name: "Hráč", color: '#03A9F4', baseColor: '#29B6F6', borderColor: '#81D4FA', type: 'human' },
    'ai_1': { name: "Orkské Hordy", color: '#b71c1c', baseColor: '#d32f2f', borderColor: '#ef5350', type: 'ai' }
};

export function initGame() {
    console.log("[GAME] Inicializace hry v=131...");
    console.log("[GAME] Konfigurace:", { INITIAL_GOLD: C.INITIAL_GOLD, INITIAL_UNITS: C.INITIAL_UNITS });

    // Reset a inicializace stavu
    if (gameState.logicIntervals) {
        gameState.logicIntervals.forEach(clearInterval);
    }

    // Vyčištění logu přes UI modul
    const logEl = document.getElementById('log-container');
    if (logEl) logEl.innerHTML = '';

    removeContextMenu();

    // INICIALIZACE HRÁČŮ
    gameState.players = {};
    for (const id in PLAYER_DEFINITIONS) {
        gameState.players[id] = {
            id: id,
            ...PLAYER_DEFINITIONS[id],
            gold: C.INITIAL_GOLD,
            units: C.INITIAL_UNITS,
            income: C.BASE_INCOME,
            crystals: C.INITIAL_CRYSTALS,
            activeExpeditions: [],
            expeditionCounter: 0,
            fractionalUnits: 0,
        };
    }

    console.log("[GAME] Hráči inicializováni (v110):", gameState.players);

    gameState.gameBoard = [];
    gameState.structures.clear();
    gameState.selectedStructureId = null;
    gameState.selectedExpeditionIds = [];
    gameState.selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0, active: false };
    gameState.activeExpeditions = [];
    gameState.expeditionCounter = 0;
    gameState.fractionalUnits = 0;

    // Vytvoření herního pole
    for (let y = 0; y < C.GRID_SIZE; y++) {
        const row = [];
        for (let x = 0; x < C.GRID_SIZE; x++) {
            const cellData = { x, y, ownerId: null, structureId: null, terrain: 'none', visibleTo: [] };
            if (Math.random() < C.TERRAIN_DENSITY) {
                cellData.terrain = Math.random() < 0.6 ? 'forest' : 'road';
            }
            row.push(cellData);
        }
        gameState.gameBoard.push(row);
    }

    // Základny
    const baseSize = 6;
    const humanBaseX = 50;
    const humanBaseY = 50;
    createStructure('base', humanBaseX, humanBaseY, baseSize, baseSize, { name: 'Hlavní stan' }, 'human');

    const aiBaseX = C.GRID_SIZE - 50;
    const aiBaseY = C.GRID_SIZE - 50;
    createStructure('base', aiBaseX, aiBaseY, baseSize, baseSize, { name: 'Válečný tábor' }, 'ai_1');

    // Náhodné struktury
    for (let i = 0; i < C.NUM_STRUCTURES; i++) {
        const rand = Math.random();
        if (rand < 0.35) placeRandomStructure('mine', 2, { name: 'Důl', income: 5, cost: 100 });
        else if (rand < 0.70) placeRandomStructure('village', 3, { name: 'Vesnice', unit_bonus: 7, cost: 75 });
        else if (rand < 0.85) placeRandomStructure('crystal_mine', 2, { name: 'Krystalový důl', income: 1, cost: 300 });
        else if (rand < 0.95) placeRandomStructure('ancient_library', 4, { name: 'Prastará knihovna', reveal_radius: 15, cost: 250 });
        else placeRandomStructure('trading_post', 3, { name: 'Tržiště', cost: 150 });
    }

    // Viewport
    viewportState.scale = 0.5;
    const vp = document.getElementById('game-viewport');
    if (vp) {
        viewportState.gridPos.x = vp.clientWidth / 2 - (humanBaseX * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
        viewportState.gridPos.y = vp.clientHeight / 2 - (humanBaseY * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
    }

    attachEventListeners(initGame);

    // Smyčky
    gameState.logicIntervals = [];
    gameState.logicIntervals.push(setInterval(gameTick, 1000));
    gameState.logicIntervals.push(setInterval(aiDecisionLoop, 3000));

    // POJISTKA UI
    gameState.logicIntervals.push(setInterval(updateUI, 500));

    updateUI();
    updateExpeditionsPanel();
    logMessage('Vítej v Pixelové Říši! Verze 110 aktivní.', 'win');

    gameState.needsRedraw = true;
    requestAnimationFrame(gameLoop);
}

// --- HERNÍ SMYČKY ---

function gameTick() {
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player) continue;

        // Příjem zlata
        player.gold += player.income;

        // Údržba budov
        gameState.structures.forEach(s => {
            if (s.ownerId === playerId && s.data.upkeep) {
                player.gold -= s.data.upkeep.gold;
            }
        });

        // Produkce krystalů z dolů
        gameState.structures.forEach(s => {
            if (s.ownerId === playerId && s.type === 'owned_crystal_mine') {
                player.crystals += (s.data.income || 0) / 15; // Krystaly jsou pomalejší
            }
        });

        // Pohyb expedic
        if (player.activeExpeditions) {
            for (let i = player.activeExpeditions.length - 1; i >= 0; i--) {
                const exp = player.activeExpeditions[i];

                if (exp.isHolding) continue;

                if (!exp.arrived) {
                    exp.progress += C.EXPEDITION_SPEED;
                    if (exp.progress >= 1) {
                        exp.progress = 1;
                        exp.arrived = true;
                        handleExpeditionArrival(playerId, exp);
                    }
                } else {
                    // Už dorazila, jen odhalujeme mapu kolem cíle (pro jistotu, kdyby se mrak hýbal lehce)
                    revealMapAround(exp.targetX, exp.targetY, Math.max(5, 2 + Math.floor(Math.sqrt(exp.unitsLeft) / 2)));
                }

                if (!exp.arrived) {
                    const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
                    const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);
                    const moveRevealRadius = Math.max(5, 2 + Math.floor(Math.sqrt(exp.unitsLeft) / 2));
                    revealMapAround(curX, curY, moveRevealRadius);
                }

                gameState.needsRedraw = true;
            }

            // MERGE PASS (Liquid Merge): Pokud se k sobě armády přiblíží, sloučí se
            for (let i = player.activeExpeditions.length - 1; i >= 0; i--) {
                for (let j = i - 1; j >= 0; j--) {
                    const e1 = player.activeExpeditions[i];
                    const e2 = player.activeExpeditions[j];

                    const p1X = e1.startX + (e1.targetX - e1.startX) * e1.progress;
                    const p1Y = e1.startY + (e1.targetY - e1.startY) * e1.progress;
                    const p2X = e2.startX + (e2.targetX - e2.startX) * e2.progress;
                    const p2Y = e2.startY + (e2.targetY - e2.startY) * e2.progress;

                    const dist = Math.hypot(p1X - p2X, p1Y - p2Y);

                    // Pokud jsou blíž než 0.8 buňky, sloučíme je
                    if (dist < 0.8) {
                        // Sjednocení e1 do e2
                        e2.unitsLeft += e1.unitsLeft;
                        e2.initialUnits += e1.unitsLeft; // Zvětšení vizuálního mraku

                        // Přenos výběru
                        if (gameState.selectedExpeditionIds.includes(e1.id)) {
                            gameState.selectedExpeditionIds = gameState.selectedExpeditionIds.filter(id => id !== e1.id);
                            if (!gameState.selectedExpeditionIds.includes(e2.id)) {
                                gameState.selectedExpeditionIds.push(e2.id);
                            }
                        }

                        // e1 zaniká
                        player.activeExpeditions.splice(i, 1);
                        logMessage(`Armády se plynule spojily v silnější oddíl o ${e2.unitsLeft} mužích.`, 'win');
                        break; // i-tá expedice zmizela, jdeme na další i
                    }
                }
            }
        }
    }
    updateUI();
    updateExpeditionsPanel();
}

function handleExpeditionArrival(playerId, exp) {
    const tx = exp.targetX;
    const ty = exp.targetY;
    const cell = gameState.gameBoard[ty][tx];
    const player = gameState.players[playerId];
    if (!player) return;

    // Dynamický rádius odhalení a záboru v cíli (výraznější pro větší armády)
    // Dynamický rádius odhalení a záboru v cíli (výraznější pro větší armády)
    const arrivalRevealRadius = Math.max(7, 4 + Math.floor(Math.sqrt(exp.unitsLeft) / 2));
    const claimRadius = Math.max(1, Math.floor(Math.sqrt(exp.unitsLeft) / 2.5));

    revealMapAround(tx, ty, arrivalRevealRadius);

    const struct = cell.structureId ? gameState.structures.get(cell.structureId) : null;

    if (struct) {
        if (struct.ownerId === playerId) {
            // Posílení vlastní budovy (zatím jen log)
            logMessage(`Expedice #${exp.id} dorazila k vlastní budově ${struct.data.name}.`, 'info');
        } else {
            // Boj o budovu
            const defenderId = struct.ownerId;
            if (defenderId) {
                // TODO: Skutečný souboj, zatím automatické obsazení
                logMessage(`Expedice #${exp.id} dobyla ${struct.data.name} pro ${player.name} !`, 'win');
                struct.ownerId = playerId;
                struct.type = 'owned_' + struct.type.replace('visible_', '').replace('hidden_', '');
            } else {
                // Obsazení prázdné budovy
                logMessage(`Expedice #${exp.id} obsadila opuštěný ${struct.data.name}.`, 'win');
                struct.ownerId = playerId;
                struct.type = 'owned_' + struct.type.replace('visible_', '').replace('hidden_', '');
            }
        }
    } else {
        // Pouze odhalujeme mapu, už nezabíráme území "flekem"
        logMessage(`Expedice #${exp.id} dorazila na pozici [${tx}, ${ty}].`, 'info');
    }

    recalculatePlayerIncome(playerId);
    updateUI();
    updateActionPanel();
}

function claimAreaAround(cx, cy, units, playerId) {
    const cloudOffsets = [
        { x: 0, y: 0 },
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
        { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 },
        { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 },
        { x: 1, y: 2 }, { x: -1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: -2 }
    ];

    const claimCount = Math.min(Math.ceil(units / 2), cloudOffsets.length);

    for (let i = 0; i < claimCount; i++) {
        const off = cloudOffsets[i];
        const x = cx + off.x;
        const y = cy + off.y;

        if (gameState.gameBoard[y]?.[x]) {
            const cell = gameState.gameBoard[y][x];
            if (!cell.structureId) {
                cell.ownerId = playerId;
            }
        }
    }
}

function recalculatePlayerIncome(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;

    let totalIncome = C.BASE_INCOME;
    gameState.structures.forEach(s => {
        if (s.ownerId === playerId) {
            // Každý důl přidává příjem definovaný v datech
            if (s.type.includes('mine')) {
                totalIncome += (s.data.income || 0);
            }
        }
    });

    player.income = totalIncome;
}

function aiDecisionLoop() {
    for (const pid in gameState.players) {
        if (gameState.players[pid].type === 'ai') {
            runAIDecision(pid);
        }
    }
}

// --- AKCE HRÁČE ---

export function handleCellClick(cell) {
    if (!cell) return;
    gameState.selectedStructureId = cell.structureId;
    updateActionPanel();
    gameState.needsRedraw = true;
}

export function showExpeditionMenu(playerId, targetX, targetY, event) {
    const menu = createContextMenu(event.clientX, event.clientY);
    const player = gameState.players[playerId];
    if (!player) return;

    const sliderPercent = document.getElementById('expedition-slider').value;
    const units = Math.max(1, Math.ceil(player.units * (sliderPercent / 100)));

    const btn = document.createElement('button');
    btn.textContent = `Vyslat expedici(${units} ⚔️)`;
    btn.onclick = () => {
        launchExpedition(playerId, targetX, targetY, units);
        removeContextMenu();
    };
    menu.appendChild(btn);
}

export function showBuildMenu(playerId, x, y, event) {
    const menu = createContextMenu(event.clientX, event.clientY);
    const types = ['mine', 'barracks', 'watchtower'];

    types.forEach(type => {
        const def = C.BUILDINGS[type];
        if (!def) return;
        const btn = document.createElement('button');
        btn.textContent = `Postavit ${def.name} (${def.cost.gold}💰)`;
        btn.onclick = () => {
            buildStructure(playerId, x, y, type);
            removeContextMenu();
        };
        const player = gameState.players[playerId];
        if (player && player.gold < (def.cost.gold || 0)) btn.disabled = true;
        menu.appendChild(btn);
    });
}

export function showCaptureMenu(playerId, struct, event) {
    const menu = createContextMenu(event.clientX, event.clientY);
    const player = gameState.players[playerId];
    if (!player) return;

    const btn = document.createElement('button');
    btn.textContent = `Obsadit ${struct.data.name} (${struct.data.cost}💰)`;
    btn.onclick = () => {
        captureStructure(playerId, struct.id);
        removeContextMenu();
    };
    if (player.gold < (struct.data.cost || 0)) btn.disabled = true;
    menu.appendChild(btn);
}


export function launchExpedition(playerId, targetX, targetY, units, sourceX = 50, sourceY = 50) {
    const player = gameState.players[playerId];
    if (!player || player.units < units) return;

    player.units -= units;
    const exp = {
        id: ++player.expeditionCounter,
        startX: sourceX,
        startY: sourceY,
        targetX,
        targetY,
        unitsLeft: units,
        initialUnits: units,
        progress: 0,
        isHolding: false,
        arrived: false
    };
    player.activeExpeditions.push(exp);
    updateExpeditionsPanel();
    updateUI();
    logMessage(`Expedice #${exp.id} vyslána na[${targetX}, ${targetY}] s ${units} jednotkami.`);
}

export function redirectExpedition(playerId, expId, targetX, targetY) {
    const player = gameState.players[playerId];
    if (!player) return;
    const exp = player.activeExpeditions.find(e => e.id === expId);
    if (!exp) return;

    // Aktuální pozice se stává novým startem
    const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
    const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

    exp.startX = curX;
    exp.startY = curY;
    exp.targetX = targetX;
    exp.targetY = targetY;
    exp.progress = 0;
    exp.arrived = false;
    exp.isHolding = false;
    gameState.needsRedraw = true;

    logMessage(`Expedice #${exp.id} přesměrována na [${targetX}, ${targetY}].`);
}

export function splitExpedition(playerId, expId, targetX, targetY, percent) {
    const player = gameState.players[playerId];
    if (!player) return;
    const exp = player.activeExpeditions.find(e => e.id === expId);
    if (!exp || exp.unitsLeft < 2) return;

    const splitUnits = Math.max(1, Math.floor(exp.unitsLeft * (percent / 100)));
    exp.unitsLeft -= splitUnits;
    exp.initialUnits = exp.unitsLeft; // Reset vizuálu pro zbytek

    const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
    const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

    // Vytvoření nové expedice z odštěpených jednotek
    const newExp = {
        id: ++player.expeditionCounter,
        startX: curX,
        startY: curY,
        targetX,
        targetY,
        unitsLeft: splitUnits,
        initialUnits: splitUnits,
        progress: 0,
        isHolding: false
    };
    player.activeExpeditions.push(newExp);
    logMessage(`Expedice #${exp.id} rozdělena! Nová expedice #${newExp.id} vyslána s ${splitUnits} jednotkami.`);
}

export function gatherExpeditions(playerId, targetX, targetY) {
    const player = gameState.players[playerId];
    if (!player) return;

    const selectedIds = gameState.selectedExpeditionIds;
    if (selectedIds.length === 0) return;

    // Tato funkce nově pouze nasměruje jednotky k sobě. 
    // Fyzické sloučení proběhne plynule v gameTick (Merge Pass), až se k sobě armády přiblíží.
    selectedIds.forEach(id => {
        redirectExpedition(playerId, id, targetX, targetY);
    });

    logMessage(`Vydán rozkaz ke sjednocení u [${targetX}, ${targetY}].`, 'info');
}

export function buildStructure(playerId, x, y, type) {
    const structDef = C.BUILDINGS[type];
    const player = gameState.players[playerId];
    if (!structDef || !player || player.gold < structDef.cost.gold) return;

    player.gold -= structDef.cost.gold;
    createStructure('owned_' + type, x, y, structDef.size, structDef.size, structDef, playerId);
    updateUI();
}

export function captureStructure(playerId, structId) {
    const struct = gameState.structures.get(structId);
    const player = gameState.players[playerId];
    if (!struct || !player || player.gold < struct.data.cost) return;

    player.gold -= struct.data.cost;
    struct.ownerId = playerId;
    struct.type = 'owned_' + struct.type.replace('visible_', '').replace('hidden_', '');

    if (struct.type === 'owned_village') player.units += struct.data.unit_bonus;
    if (struct.type === 'owned_ancient_library') revealMapAround(struct.x, struct.y, struct.data.reveal_radius);

    updateUI();
    updateActionPanel();
    recalculatePlayerIncome(playerId);
    logMessage(`Budova ${struct.data.name} byla obsazena!`, 'win');
}

function revealMapAround(cx, cy, radius) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(C.GRID_SIZE - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(C.GRID_SIZE - 1, cx + radius); x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (dist <= radius) {
                const cell = gameState.gameBoard[y][x];
                if (!cell.visibleTo.includes('human')) {
                    cell.visibleTo.push('human');
                }
            }
        }
    }
    gameState.needsRedraw = true;
}

export function revealMap() {
    for (let y = 0; y < C.GRID_SIZE; y++) {
        for (let x = 0; x < C.GRID_SIZE; x++) {
            if (!gameState.gameBoard[y][x].visibleTo.includes('human')) {
                gameState.gameBoard[y][x].visibleTo.push('human');
            }
        }
    }
    gameState.needsRedraw = true;
    logMessage('Mapa byla odhalena (Debug v110).');
}

// Export pro onclick v HTML
window.captureStructure = captureStructure;
window.revealMap = revealMap;
window.initGame = initGame;