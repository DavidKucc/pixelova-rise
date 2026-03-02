console.log('[DEBUG] game.js loaded v=155');

import * as C from './config.js?v=155';
import { gameState, viewportState } from './state.js?v=155';
import { ui, updateUI, updateExpeditionsPanel, updateActionPanel, logMessage, createContextMenu, removeContextMenu } from './ui.js?v=155';
import { getNeighbors, isAreaClear, createStructure, placeRandomStructure } from './utils.js?v=155';
import { gameLoop } from './renderer.js?v=155';
import { runAIDecision } from './ai.js?v=155';
import { Logger } from './logger.js?v=155';

// --- MULTIPLAYER SYNC ---
import { ref, push, set, onValue, onDisconnect, remove, onChildAdded } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from '../firebase-config.js?v=155';

export const PLAYER_DEFINITIONS = {
    'human': { name: "Hráč 1", color: '#03A9F4', baseColor: '#29B6F6', borderColor: '#81D4FA', type: 'human' },
    'enemy': { name: "Hráč 2", color: '#b71c1c', baseColor: '#d32f2f', borderColor: '#ef5350', type: 'human' }
};

export async function initGame(hostStatus = false, playerId = 'human', lobbyId = null) {
    console.log(`[GAME] Inicializace hry v=155 (Role: ${hostStatus ? 'Host' : 'Client'}, ID: ${playerId})...`);

    // Uložení parametrů do globálního stavu (DŮLEŽITÉ!)
    gameState.isHost = hostStatus;
    gameState.myPlayerId = playerId;
    gameState.currentLobbyId = lobbyId;
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

    console.log("[GAME] Hráči inicializováni (v155):", gameState.players);

    gameState.gameBoard = [];
    gameState.structures.clear();
    gameState.selectedStructureId = null;
    gameState.selectedExpeditionIds = [];
    gameState.selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0, active: false };
    gameState.activeExpeditions = [];
    gameState.expeditionCounter = 0;
    gameState.fractionalUnits = 0;

    // Vracíme Promise, který se vyřeší, až se dokončí finishInit
    return new Promise((resolve, reject) => {
        // Vytvoření herního pole - SYNCHRONIZOVANÉ
        if (gameState.currentLobbyId) {
            syncWorldGeneration(resolve).catch(reject);
        } else {
            generateLocalWorld(resolve);
        }
    });
}

function generateLocalWorld(resolve) {
    gameState.gameBoard = [];
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
    generateStructures();
    finishInit(resolve);
}

async function syncWorldGeneration(resolve) {
    const worldRef = ref(db, `lobbies/${gameState.currentLobbyId}/world`);

    if (gameState.isHost) {
        console.log("[WORLD] Hostitel generuje svět...");
        gameState.gameBoard = [];
        let terrainString = ''; // Base64 / String pro bezpečný přenos

        for (let y = 0; y < C.GRID_SIZE; y++) {
            const row = [];
            for (let x = 0; x < C.GRID_SIZE; x++) {
                let terrain = 'none';
                if (Math.random() < C.TERRAIN_DENSITY) {
                    terrain = Math.random() < 0.6 ? 'forest' : 'road';
                }
                row.push({ x, y, ownerId: null, structureId: null, terrain, visibleTo: [] });
                terrainString += (terrain === 'none' ? '0' : (terrain === 'forest' ? '1' : '2'));
            }
            gameState.gameBoard.push(row);
        }

        // VYGENEROVAT BUDOVY PRED ODESLANIM NA FIREBASE
        generateStructures();

        // Uložit do Firebase přes bezpečný JSON string
        console.log("[WORLD] Nahrávám data světa a budov na server (bezpečná stringifikace)...");
        const structureArray = Array.from(gameState.structures.values());

        await set(worldRef, {
            terrainStr: terrainString,
            structuresJSON: JSON.stringify(structureArray),
            seed: Math.random()
        });
        console.log("[WORLD] Data světa nahrána.");
        finishInit(resolve);
    } else {
        console.log(`[WORLD] Klient (${gameState.myPlayerId}) čeká na data světa v lobby ${gameState.currentLobbyId}...`);
        const unsub = onValue(worldRef, (snapshot) => {
            if (snapshot.exists() && snapshot.val().terrainStr && snapshot.val().structuresJSON) {
                console.log("[WORLD] Data světa dorazila! (v155)");
                const tStr = snapshot.val().terrainStr;
                const remoteStructures = JSON.parse(snapshot.val().structuresJSON);

                // 1. Rekonstrukce terénu
                gameState.gameBoard = [];
                let charIndex = 0;
                for (let y = 0; y < C.GRID_SIZE; y++) {
                    const row = [];
                    for (let x = 0; x < C.GRID_SIZE; x++) {
                        const char = tStr[charIndex++];
                        const terrain = char === '0' ? 'none' : (char === '1' ? 'forest' : 'road');
                        row.push({ x, y, ownerId: null, structureId: null, terrain, visibleTo: [] });
                    }
                    gameState.gameBoard.push(row);
                }

                // 2. Rekonstrukce budov
                gameState.structures.clear();
                remoteStructures.forEach(s => {
                    createStructure(s.type, s.x, s.y, s.w, s.h, s.data, s.ownerId, s.id);
                });

                unsub();
                finishInit(resolve); // Svět a budovy už máme stažené z Firebase, spouštíme klienta!
            }
        });
    }
}

function generateStructures() {
    const humanBaseX = 50;
    const humanBaseY = 50;
    const enemyBaseX = C.GRID_SIZE - 50;
    const enemyBaseY = C.GRID_SIZE - 50;

    const baseSize = 6;
    createStructure('base', humanBaseX, humanBaseY, baseSize, baseSize, { name: 'Hlavní stan' }, 'human');
    createStructure('base', enemyBaseX, enemyBaseY, baseSize, baseSize, { name: 'Válečný tábor' }, 'enemy');

    // Náhodné struktury
    for (let i = 0; i < C.NUM_STRUCTURES; i++) {
        const rand = Math.random();
        if (rand < 0.35) placeRandomStructure('mine', 2, { name: 'Důl', income: 5, cost: 100 });
        else if (rand < 0.70) placeRandomStructure('village', 3, { name: 'Vesnice', unit_bonus: 7, cost: 75 });
        else if (rand < 0.85) placeRandomStructure('crystal_mine', 2, { name: 'Krystalový důl', income: 1, cost: 300 });
        else if (rand < 0.95) placeRandomStructure('ancient_library', 4, { name: 'Prastará knihovna', reveal_radius: 15, cost: 250 });
        else placeRandomStructure('trading_post', 3, { name: 'Tržiště', cost: 150 });
    }
}

function finishInit(resolveCallback) {
    const humanBaseX = 50;
    const humanBaseY = 50;
    const enemyBaseX = C.GRID_SIZE - 50;
    const enemyBaseY = C.GRID_SIZE - 50;

    // MULTIPLAYER SYNC: Připojit se k odběru cizích expedic
    if (gameState.currentLobbyId) {
        setupMultiplayerSync();
    }

    // ÚVODNÍ ODHALENÍ MAPY (aby nebyla černá obrazovka!)
    // Oběma hráčům odhalíme jejich základny lokálně
    revealMapAround(humanBaseX, humanBaseY, 20, 'human');
    revealMapAround(enemyBaseX, enemyBaseY, 20, 'enemy');

    // Pro jistotu ještě jednou explicitně pro sebe
    if (gameState.myPlayerId === 'human') {
        revealMapAround(humanBaseX, humanBaseY, 20, 'human');
    } else {
        revealMapAround(enemyBaseX, enemyBaseY, 20, 'enemy');
    }

    // Viewport
    viewportState.scale = 0.5;
    const vp = document.getElementById('game-viewport');
    if (vp) {
        // Focus na vlastní základnu: Hostitel vlevo nahoře, Klient vpravo dole
        const focusX = (gameState.myPlayerId === 'human') ? humanBaseX : enemyBaseX;
        const focusY = (gameState.myPlayerId === 'human') ? humanBaseY : enemyBaseY;

        viewportState.gridPos.x = vp.clientWidth / 2 - (focusX * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
        viewportState.gridPos.y = vp.clientHeight / 2 - (focusY * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
        console.log(`[GAME] Kamera vycentrovaná na: [${focusX}, ${focusY}] pro ${gameState.myPlayerId}`);
    }

    // attachEventListeners(initGame); // VOLÁ MAIN.JS kvuli závislostem

    // Smyčky
    gameState.logicIntervals = [];
    gameState.logicIntervals.push(setInterval(gameTick, 1000));
    gameState.logicIntervals.push(setInterval(aiDecisionLoop, 3000));

    // POJISTKA UI
    gameState.logicIntervals.push(setInterval(updateUI, 500));

    // Inicializujeme příjem, aby hráči začali správně
    recalculatePlayerIncome('human');
    recalculatePlayerIncome('enemy');

    updateUI();
    updateExpeditionsPanel();
    logMessage(`Vítej v Pixelové Říši! Verze 155 aktivní. Hraješ jako ${gameState.myPlayerId === 'human' ? 'Modrý' : 'Červený'}.`, 'win');

    gameState.needsRedraw = true;
    requestAnimationFrame(gameLoop);

    // NYNÍ JE HRA KOMPLETNĚ PŘIPRAVENÁ A MŮŽEME ODKRÝT UI
    if (resolveCallback) resolveCallback();
}

export function recalculatePlayerIncome(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;

    let income = C.BASE_INCOME;
    gameState.structures.forEach(s => {
        if (s.ownerId === playerId && s.data.income) {
            income += s.data.income;
        }
    });
    player.income = income;
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
                    revealMapAround(curX, curY, moveRevealRadius, playerId);
                }

                gameState.needsRedraw = true;
            }

            // BOJOVÝ SYSTÉM (Meat Grinder)
            handleCombatBetweenExpeditions(playerId);
        }
    }
    updateUI();
    updateExpeditionsPanel();
}

function handleCombatBetweenExpeditions(p1Id) {
    const p1 = gameState.players[p1Id];
    if (!p1) return;

    for (const p2Id in gameState.players) {
        if (p1Id === p2Id) continue;
        const p2 = gameState.players[p2Id];

        p1.activeExpeditions.forEach(e1 => {
            p2.activeExpeditions.forEach(e2 => {
                const e1X = e1.startX + (e1.targetX - e1.startX) * e1.progress;
                const e1Y = e1.startY + (e1.targetY - e1.startY) * e1.progress;
                const e2X = e2.startX + (e2.targetX - e2.startX) * e2.progress;
                const e2Y = e2.startY + (e2.targetY - e2.startY) * e2.progress;

                const dist = Math.hypot(e1X - e2X, e1Y - e2Y);

                if (dist < 1.5) { // Dosah boje
                    const cell = gameState.gameBoard[Math.round(e1Y)]?.[Math.round(e1X)];
                    const terrainWidth = (cell?.terrain === 'forest') ? 0.2 : 1.0;

                    // Výpočet ztrát (zjednodušený Meat Grinder)
                    const baseLoss = 2 * terrainWidth;
                    e1.unitsLeft -= baseLoss;
                    e2.unitsLeft -= baseLoss;

                    // SYSTÉM PANIKY
                    if (e1.unitsLeft < e1.initialUnits * 0.5) {
                        e1.panic = true;
                        redirectExpeditionToHome(p1Id, e1);
                    }
                    if (e2.unitsLeft < e2.initialUnits * 0.5) {
                        e2.panic = true;
                        redirectExpeditionToHome(p2Id, e2);
                    }

                    if (e1.unitsLeft <= 0) removeExpedition(p1Id, e1.id);
                    if (e2.unitsLeft <= 0) removeExpedition(p2Id, e2.id);

                    gameState.needsRedraw = true;
                }
            });
        });
    }
}

function redirectExpeditionToHome(playerId, exp) {
    const base = Array.from(gameState.structures.values()).find(s => s.ownerId === playerId && s.type.includes('base'));
    if (base) {
        if (!exp.isReturning) {
            logMessage(`Expedice #${exp.id} panikaří a ustupuje k základně!`, 'warn');
            exp.isReturning = true;
            redirectExpedition(playerId, exp.id, base.x + base.w / 2, base.y + base.h / 2);
        }
    }
}

function removeExpedition(playerId, expId) {
    const player = gameState.players[playerId];
    if (player) {
        player.activeExpeditions = player.activeExpeditions.filter(e => e.id !== expId);
        logMessage(`Expedice #${expId} byla zničena v boji.`, 'error');
    }
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

export function recalculatePlayerIncome(playerId) {
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
    logMessage(`Expedice #${exp.id} vyslána na [${targetX}, ${targetY}] s ${units} jednotkami.`);

    // MULTIPLAYER SYNC
    if (gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=147').then(m => {
            m.syncExpeditionToFirebase(playerId, exp);
        });
    }
}

export function setupMultiplayerSync() {
    if (!gameState.currentLobbyId) return;

    // Dynamicky zjistit, koho máme poslouchat (toho druhého)
    const otherPlayerId = (gameState.myPlayerId === 'human') ? 'enemy' : 'human';
    console.log(`[SYNC] Zapínám sledování hráče: ${otherPlayerId}`);

    const expeditionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/expeditions/${otherPlayerId}`);
    onValue(expeditionsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Resetovat cizí expedice v lokálním stavu a nahrát nové
        const otherPlayer = gameState.players[otherPlayerId];
        if (otherPlayer) {
            otherPlayer.activeExpeditions = [];
            for (const id in data) {
                const remote = data[id];
                otherPlayer.activeExpeditions.push({
                    id: remote.id,
                    startX: remote.startX,
                    startY: remote.startY,
                    targetX: remote.targetX,
                    targetY: remote.targetY,
                    initialUnits: remote.units,
                    unitsLeft: remote.units,
                    progress: 0,
                    arrived: false,
                    isRemote: true // Příznak, že jde o cizí jednotku
                });
            }
        }
    });

    // 2. Sledování cizích akcí (např. obsazení budov)
    const actionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/actions`);
    onChildAdded(actionsRef, (snapshot) => {
        const action = snapshot.val();
        if (!action) return;

        // Cizí akce aplikujeme lokálně
        if (action.playerId !== gameState.myPlayerId) {
            console.log("[SYNC] Přijata cizí akce:", action);
            if (action.type === 'capture') {
                captureStructure(action.playerId, action.structureId, true);
            }
        }
    });
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

export function captureStructure(playerId, structId, isRemoteAction = false) {
    const struct = gameState.structures.get(structId);
    const player = gameState.players[playerId];
    if (!struct || !player || player.gold < (struct.data.cost || 0)) return;

    player.gold -= (struct.data.cost || 0);
    struct.ownerId = playerId;
    struct.type = 'owned_' + struct.type.replace('visible_', '').replace('hidden_', '');

    if (struct.type === 'owned_village') player.units += struct.data.unit_bonus;
    if (struct.type === 'owned_ancient_library') revealMapAround(struct.x, struct.y, struct.data.reveal_radius);

    updateUI();
    updateActionPanel();
    recalculatePlayerIncome(playerId);
    logMessage(`Budova ${struct.data.name} byla obsazena ${player.name}!`, 'win');

    // MULTIPLAYER SYNC ACTIONS
    if (!isRemoteAction && gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=152').then(m => {
            m.syncActionToFirebase({
                type: 'capture',
                playerId: playerId,
                structureId: structId,
                timestamp: Date.now()
            });
        });
    }
}

export function revealMapAround(cx, cy, radius, playerId = gameState.myPlayerId) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(C.GRID_SIZE - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(C.GRID_SIZE - 1, cx + radius); x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (dist <= radius) {
                const cell = gameState.gameBoard[y][x];
                if (!cell.visibleTo.includes(playerId)) {
                    cell.visibleTo.push(playerId);
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