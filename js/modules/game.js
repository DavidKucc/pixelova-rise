console.log('[DEBUG] game.js loaded v=174');

import * as C from './config.js?v=174';
import { gameState, viewportState } from './state.js?v=174';
import { ui, updateUI, updateExpeditionsPanel, updateActionPanel, logMessage, createContextMenu, removeContextMenu } from './ui.js?v=174';
import { getNeighbors, isAreaClear, createStructure, placeRandomStructure } from './utils.js?v=174';
import { gameLoop } from './renderer.js?v=174';
import { runAIDecision } from './ai.js?v=174';
import { Logger } from './logger.js?v=174';

// --- MULTIPLAYER SYNC ---
import { ref, push, set, onValue, onDisconnect, remove, onChildAdded } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from '../firebase-config.js?v=174';

export async function initGame(hostStatus = false, playerId = 'local_player', lobbyId = null, playersData = null) {
    console.log(`[GAME] Inicializace hry v=172 (Role: ${hostStatus ? 'Host' : 'Client'}, ID: ${playerId})...`);

    // Ulo�en� parametr� do glob�ln�ho stavu (D�LE�IT�!)
    gameState.isHost = hostStatus;
    gameState.myPlayerId = playerId;
    gameState.currentLobbyId = lobbyId;
    console.log("[GAME] Konfigurace:", { INITIAL_GOLD: C.INITIAL_GOLD, INITIAL_UNITS: C.INITIAL_UNITS });

    // Reset a inicializace stavu
    if (gameState.logicIntervals) {
        gameState.logicIntervals.forEach(clearInterval);
    }

    // Vy�i�t�n� logu p�es UI modul
    const logEl = document.getElementById('log-container');
    if (logEl) logEl.innerHTML = '';

    removeContextMenu();

    // INICIALIZACE HR��� Z LOBBY DATA (ROZD�V�N� KARET)
    gameState.players = {};

    if (playersData) {
        // Se�adit hr��e konzistentn� (nap��klad abecedn� podle kl��e = po�ad� p�ipojen� do Firebase)
        const playerIds = Object.keys(playersData).sort();

        playerIds.forEach((id, index) => {
            if (index >= C.MAX_PLAYERS) return; // Z�chrana proti p�epln�n� mapy
            if (index >= C.MAX_PLAYERS) return; // Záchrana proti přeplnění mapy

            const colorCard = C.PLAYER_COLORS[index];
            const pData = playersData[id];

            gameState.players[id] = {
                id: id,
                name: pData.name || `Hráč ${index + 1}`,
                color: colorCard.color,
                baseColor: colorCard.baseColor,
                borderColor: colorCard.borderColor,
                type: 'human', // Prozatím všichni reální lidé z lobby
                index: index, // Pořadí slouží pro výpočet rohů základny

                // Ekonomické "karty"
                gold: C.INITIAL_GOLD,
                units: C.INITIAL_UNITS,
                income: C.BASE_INCOME,
                crystals: C.INITIAL_CRYSTALS,
                activeExpeditions: [],
                expeditionCounter: 0,
                fractionalUnits: 0,
            };
        });
    }

    console.log("[GAME] Hráči inicializováni (v170):", gameState.players);

    gameState.gameBoard = [];
    gameState.structures.clear();
    gameState.selectedStructureId = null;
    gameState.selectedExpeditionIds = [];
    gameState.selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0, active: false };
    gameState.activeExpeditions = [];
    gameState.expeditionCounter = 0;
    gameState.fractionalUnits = 0;

    // Vracíme Promise, která se vyřeší, až se dokončí finishInit
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
        console.log("[WORLD] Nahrávám data světa a budov na server (bezpečné stringifikace)...");
        const structureArray = Array.from(gameState.structures.values());

        await set(worldRef, {
            terrainStr: terrainString,
            structuresJSON: JSON.stringify(structureArray),
            seed: Math.random(),
            sessionToken: gameState.sessionToken || 'legacy'
        });
        console.log("[WORLD] Data světa nahrána.");
        finishInit(resolve);
    } else {
        console.log(`[WORLD] Klient (${gameState.myPlayerId}) čeká na data světa pro session ${gameState.sessionToken}...`);

        let unsubWORLD;
        let isResolvedWORLD = false;

        unsubWORLD = onValue(worldRef, (snapshot) => {
            if (isResolvedWORLD) return;

            const data = snapshot.val();
            if (snapshot.exists() && data && data.terrainStr && data.structuresJSON) {
                // Skutečně checkneme token, abychom nenatáhli starou mapu z minulé relace!
                if (data.sessionToken === gameState.sessionToken || gameState.sessionToken === 'legacy') {
                    console.log("[WORLD] Aktuální Data světa dorazila! (v170)");
                    const tStr = data.terrainStr;
                    const remoteStructures = JSON.parse(data.structuresJSON);

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
                    console.log(`[DEBUG] syncWorldGeneration: Rekonstruuji ${remoteStructures.length} budov ze serveru.`);

                    remoteStructures.forEach((s, idx) => {
                        // Musíme použít typ bez "owned_", protože createStructure si ho tam přidá, pokud má ownerId
                        const cleanType = s.type.replace('owned_', '').replace('visible_', '').replace('hidden_', '');
                        createStructure(cleanType, s.x, s.y, s.w, s.h, s.data, s.ownerId, s.id);

                        if (s.type.includes('base')) {
                            const isMine = (s.ownerId === gameState.myPlayerId);
                            console.log(`[DEBUG]   [${idx}] Budova type=${s.type}, owner=${s.ownerId}, IS_MINE=${isMine}, pos=[${s.x},${s.y}]`);
                        }
                    });

                    isResolvedWORLD = true;
                    if (unsubWORLD) unsubWORLD();

                    finishInit(resolve); // Svět a budovy už máme stažené z Firebase, spouštíme klienta!
                } else {
                    console.log("[WORLD] Ignoruji starý svět z minulé session...");
                }
            }
        });
    }
}

function generateStructures() {
    console.log(`[DEBUG] generateStructures: Generuji základny pro ${Object.keys(gameState.players).length} hráčů.`);

    Object.values(gameState.players).forEach((p) => {
        const basePos = C.BASE_POSITIONS[p.index];
        console.log(`[DEBUG] - Hráč ${p.id} (index: ${p.index}, jméno: ${p.name}) -> pozice: ${JSON.stringify(basePos)}`);

        if (basePos) {
            const baseSize = 6;
            createStructure('base', basePos.x, basePos.y, baseSize, baseSize, { name: 'Hlavní stan - ' + p.name, income: 10 }, p.id);
            console.log(`[DEBUG]   -> Základna vytvořena pro ${p.id}`);
        } else {
            console.error(`[CRITICAL] Pro hráče ${p.id} s indexem ${p.index} nebyla nalezena startovní pozice!`);
        }
    });

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
    // MULTIPLAYER SYNC: Připojit se k odběru cizích expedic
    if (gameState.currentLobbyId) {
        setupMultiplayerSync();
    }

    // ÚVODNÍ ODHALENÍ MAPY (aby nebyla černá obrazovka!)
    // Objevíme mapy všech aktivních hráčů okolo jejich základen, ale jen do jejich pohledu
    Object.values(gameState.players).forEach((p) => {
        const basePos = C.BASE_POSITIONS[p.index];
        if (basePos) {
            revealMapAround(basePos.x, basePos.y, 20, p.id);
        }
    });

    // Viewport: Zacílit kameru hráče na JEHO základnu
    viewportState.scale = 0.5;
    const vp = document.getElementById('game-viewport');
    if (vp) {
        const myIndex = gameState.players[gameState.myPlayerId]?.index || 0;
        const basePos = C.BASE_POSITIONS[myIndex];

        if (basePos) {
            viewportState.gridPos.x = vp.clientWidth / 2 - (basePos.x * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
            viewportState.gridPos.y = vp.clientHeight / 2 - (basePos.y * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale);
            console.log(`[GAME] Kamera vycentrovaná na: [${basePos.x}, ${basePos.y}] pro ${gameState.myPlayerId}`);
        }
    }

    // attachEventListeners(initGame); // VOLÁ MAIN.JS kvuli závislostem

    // Smyčky
    gameState.logicIntervals = [];
    gameState.logicIntervals.push(setInterval(gameTick, 1000));
    gameState.logicIntervals.push(setInterval(aiDecisionLoop, 3000));

    // POJISTKA UI
    gameState.logicIntervals.push(setInterval(updateUI, 500));

    // Inicializujeme příjem, aby hráči začali správně
    Object.keys(gameState.players).forEach(pId => {
        recalculatePlayerIncome(pId);
    });

    updateUI();
    updateExpeditionsPanel();
    logMessage(`Vítej v Pixelové říši! Verze 174 aktivní. Hraješ jako ${gameState.players[gameState.myPlayerId]?.name || gameState.myPlayerId}.`, 'win');

    gameState.needsRedraw = true;
    requestAnimationFrame(gameLoop);
    requestAnimationFrame(physicsLoop);

    // NYNÍ JE HRA KOMPLETNĚ PŘIPRAVENÁ A MŮŽEME ODKRÝT UI
    window.showScreen('game-ui');

    // Zapojení vstupních listenerů (mouse/keyboard events)
    import('../main.js?v=174').then(m => {
        if (window.attachEventListeners) window.attachEventListeners(); // v main.js attach fn wrapper
    });

    // Pojistka překreslení plátna přesně poté, co dom odryl CSS vrstvu DIVu
    setTimeout(() => {
        const vp = document.getElementById('game-viewport');
        const canvas = document.getElementById('game-canvas');
        if (vp && canvas) {
            canvas.width = vp.clientWidth;
            canvas.height = vp.clientHeight;
        }
        if (gameState) gameState.needsRedraw = true;
        if (resolveCallback) resolveCallback();
    }, 100);
}

export function recalculatePlayerIncome(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;

    let income = C.BASE_INCOME;
    gameState.structures.forEach(s => {
        if (s && s.ownerId === playerId && s.data && s.data.income) {
            income += s.data.income;
        }
    });
    player.income = income;
}

// --- HERNÍ SMYČKY ---
let lastPhysicsTime = performance.now();

export function physicsLoop(timestamp) {
    const dt = (timestamp - lastPhysicsTime) / 1000; // vteřiny uběhlé od minulého framu
    lastPhysicsTime = timestamp;

    let movedAny = false;

    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player || !player.activeExpeditions) continue;

        for (let i = player.activeExpeditions.length - 1; i >= 0; i--) {
            const exp = player.activeExpeditions[i];

            if (exp.isHolding) continue;

            if (!exp.arrived) {
                const dist = Math.hypot(exp.targetX - exp.startX, exp.targetY - exp.startY);

                if (exp.isRemote && exp.startTime && exp.duration) {
                    // SYNCHRONIZOVANÝ POHYB: Progress počítáme z reálného času
                    const elapsed = Date.now() - exp.startTime;
                    exp.progress = Math.min(1, elapsed / exp.duration);
                } else {
                    // LOKÁLNÍ POHYB (nebo fallback): Klasický dt přírůstek
                    const progressDelta = dist > 0 ? ((C.EXPEDITION_SPEED * dt) / dist) : 1;
                    exp.progress += progressDelta;
                }

                if (exp.progress >= 1) {
                    exp.progress = 1;
                    exp.arrived = true;
                    handleExpeditionArrival(playerId, exp);
                }
            } else {
                // Už dorazila
                if (playerId === gameState.myPlayerId && gameState.logicIntervals) {
                    revealMapAround(exp.targetX, exp.targetY, Math.max(5, 2 + Math.floor(Math.sqrt(exp.unitsLeft) / 2)), playerId);
                }
            }

            if (!exp.arrived) {
                const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
                const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;

                // FOG OF WAR: Lokální odhaluje mapu pouze moje vlastní expedice!
                if (playerId === gameState.myPlayerId) {
                    const moveRevealRadius = Math.max(5, 2 + Math.floor(Math.sqrt(exp.unitsLeft) / 2));
                    revealMapAround(Math.round(curX), Math.round(curY), moveRevealRadius, playerId);
                }
                movedAny = true;
            }
        }
    }

    if (movedAny) gameState.needsRedraw = true;

    // Asynchronně točíme dokola jak blesk (cca 60-144x za sekundu v závislosti na monitoru)
    requestAnimationFrame(physicsLoop);
}

function gameTick() {
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player) continue;

        // Příjem zlata
        player.gold += player.income;

        // Údržba budov
        gameState.structures.forEach(s => {
            if (s && s.ownerId === playerId && s.data && s.data.upkeep) {
                player.gold -= s.data.upkeep.gold;
            }
        });

        // Produkce krystalů z dolů
        gameState.structures.forEach(s => {
            if (s && s.ownerId === playerId && s.type === 'owned_crystal_mine' && s.data) {
                player.crystals += (s.data.income || 0) / 15; // Krystaly jsou pomalejší
            }
        });

        // BOJOVÝ SYSTÉM (Meat Grinder)
        if (player.activeExpeditions) {
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

        // MULTIPLAYER SYNC: Pouze majitel maže z Firebase!
        if (playerId === gameState.myPlayerId && gameState.currentLobbyId) {
            import('../main.js?v=174').then(m => {
                m.removeFromFirebase(`lobbies/${gameState.currentLobbyId}/expeditions/${playerId}/${expId}`);
            });
        }

        logMessage(`Expedice #${expId} dorazila nebo byla zničena.`, 'info');
    }
}

function handleExpeditionArrival(playerId, exp) {
    const tx = exp.targetX;
    const ty = exp.targetY;
    const cell = gameState.gameBoard[ty][tx];
    const player = gameState.players[playerId];
    if (!player) return;

    // Dynamický rádius odhalení a záboru v cíli (výraznější pro větší armády)
    const arrivalRevealRadius = Math.max(7, 4 + Math.floor(Math.sqrt(exp.unitsLeft) / 2));
    const claimRadius = Math.max(1, Math.floor(Math.sqrt(exp.unitsLeft) / 2.5));

    if (playerId === gameState.myPlayerId) {
        revealMapAround(tx, ty, arrivalRevealRadius);
    }

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
                logMessage(`Expedice #${exp.id} obsadila opuštěnou ${struct.data.name}.`, 'win');
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
    btn.textContent = `Vyslat expedici (${units} jednotek)`;
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
        btn.textContent = `Postavit ${def.name} (${def.cost.gold} zlata)`;
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
    btn.textContent = `Obsadit ${struct.data.name} (${struct.data.cost} zlata)`;
    btn.onclick = () => {
        captureStructure(playerId, struct.id);
        removeContextMenu();
    };
    if (player.gold < (struct.data.cost || 0)) btn.disabled = true;
    menu.appendChild(btn);
}


export function launchExpedition(playerId, targetX, targetY, units, sourceX = null, sourceY = null) {
    const player = gameState.players[playerId];
    if (!player || player.units < units) return;

    // Dynamické určení startu - buď z parametru, nebo z hlavní základny hráče
    let finalSourceX = sourceX;
    let finalSourceY = sourceY;

    if (finalSourceX === null || finalSourceY === null) {
        // Hledáme základnu podle ID hráče
        const structures = Array.from(gameState.structures.values());
        console.log(`[DEBUG] launchExpedition: Hledám základnu pro ${playerId}. Celkem budov: ${structures.length}`);

        const base = structures.find(s => {
            const match = (s.ownerId === playerId && s.type.includes('base'));
            if (s.type.includes('base')) {
                console.log(`[DEBUG] - Kontrola budovy ${s.id}: type=${s.type}, owner=${s.ownerId}, match=${match}`);
            }
            return match;
        });

        if (base) {
            finalSourceX = base.x + Math.floor(base.w / 2);
            finalSourceY = base.y + Math.floor(base.h / 2);
        } else {
            console.error(`[CRITICAL] Hráč ${playerId} nemá na mapě žádnou základnu! Jednotky nevyslány.`);
            logMessage("Nemůžeš vyslat jednotky, tvoje základna byla zničena nebo chybí!", 'error');
            return;
        }
    }

    player.units -= units;
    const dist = Math.hypot(targetX - finalSourceX, targetY - finalSourceY);
    const duration = (dist / C.EXPEDITION_SPEED) * 1000; // ms

    const exp = {
        id: ++player.expeditionCounter,
        startX: finalSourceX,
        startY: finalSourceY,
        targetX,
        targetY,
        unitsLeft: units,
        initialUnits: units,
        progress: 0,
        startTime: Date.now(),
        duration: duration,
        isHolding: false,
        arrived: false
    };
    player.activeExpeditions.push(exp);
    updateExpeditionsPanel();
    updateUI();
    logMessage(`Expedice #${exp.id} vysl�na na [${targetX}, ${targetY}] s ${units} jednotkami.`);

    // MULTIPLAYER SYNC
    if (gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=174').then(m => {
            m.syncExpeditionToFirebase(playerId, exp);
        });
    }
}

export function setupMultiplayerSync() {
    if (!gameState.currentLobbyId) return;

    // Tady mus�me poslouchat V�ECHNY hr��e aktivn� ve h�e (krom� lok�ln�ho)
    Object.keys(gameState.players).forEach(otherPlayerId => {
        if (otherPlayerId === gameState.myPlayerId) return;

        const expeditionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/expeditions/${otherPlayerId}`);
        onValue(expeditionsRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            const otherPlayer = gameState.players[otherPlayerId];
            if (otherPlayer) {
                // Nam�sto tvrd�ho smaz�n� a vynulov�n� "progressu" prov�d�me merge:
                // Zachov�me st�vaj�c� jednotky (a jejich fyzick� progress pohybu) a p�id�me nov�
                const updatedExpeditions = [];

                for (const id in data) {
                    const remote = data[id];
                    const existingExp = otherPlayer.activeExpeditions.find(e => e.id === remote.id);

                    if (existingExp) {
                        // Aktualizace stavu u� existuj�c� jednotky
                        existingExp.unitsLeft = remote.units;
                        existingExp.isRemote = true;
                        existingExp.targetX = remote.targetX;
                        existingExp.targetY = remote.targetY;
                        updatedExpeditions.push(existingExp);
                    } else {
                        // Nov� expedice od nep��tele, kter� se pr�v� zrodila
                        updatedExpeditions.push({
                            id: remote.id,
                            startX: remote.startX,
                            startY: remote.startY,
                            targetX: remote.targetX,
                            targetY: remote.targetY,
                            initialUnits: remote.units,
                            unitsLeft: remote.units,
                            progress: 0,
                            startTime: remote.startTime,
                            duration: remote.duration,
                            arrived: false,
                            isRemote: true
                        });
                    }
                }

                otherPlayer.activeExpeditions = updatedExpeditions;
            }
        });
    });

    // 2. Sledov�n� ciz�ch akc� (nap�. obsazen� budov)
    const actionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/actions`);
    onChildAdded(actionsRef, (snapshot) => {
        const action = snapshot.val();
        if (!action) return;

        // Ciz� akce aplikujeme lok�ln�
        if (action.playerId !== gameState.myPlayerId) {
            console.log("[SYNC] P�ijata ciz� akce:", action);
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

    // Aktu�ln� pozice se st�v� nov�m startem
    const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
    const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

    exp.startX = curX;
    exp.startY = curY;
    exp.targetX = targetX;
    exp.targetY = targetY;
    exp.progress = 0;
    exp.arrived = false;
    exp.isHolding = false;

    // Přepočet času pro synchronizaci k pohybu
    const newDist = Math.hypot(targetX - curX, targetY - curY);
    exp.duration = (newDist / C.EXPEDITION_SPEED) * 1000;
    exp.startTime = Date.now();

    gameState.needsRedraw = true;

    logMessage(`Expedice #${exp.id} p�esm�rov�na na [${targetX}, ${targetY}].`);

    // MULTIPLAYER SYNC P�ESM�ROV�N�
    if (gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=174').then(m => {
            m.syncExpeditionToFirebase(playerId, exp);
        });
    }
}

export function splitExpedition(playerId, expId, targetX, targetY, percent) {
    const player = gameState.players[playerId];
    if (!player) return;
    const exp = player.activeExpeditions.find(e => e.id === expId);
    if (!exp || exp.unitsLeft < 2) return;

    const splitUnits = Math.max(1, Math.floor(exp.unitsLeft * (percent / 100)));
    exp.unitsLeft -= splitUnits;
    exp.initialUnits = exp.unitsLeft; // Reset vizu�lu pro zbytek

    const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
    const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

    // Vytvo�en� nov� expedice z od�t�pen�ch jednotek
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
    logMessage(`Expedice #${exp.id} rozd�lena! Nov� expedice #${newExp.id} vysl�na s ${splitUnits} jednotkami.`);

    // MULTIPLAYER SYNC ROZD�LEN� A ZMEN�EN� P�VODN�
    if (gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=174').then(m => {
            m.syncExpeditionToFirebase(playerId, exp);
            m.syncExpeditionToFirebase(playerId, newExp);
        });
    }
}

export function gatherExpeditions(playerId, targetX, targetY) {
    const player = gameState.players[playerId];
    if (!player) return;

    const selectedIds = gameState.selectedExpeditionIds;
    if (selectedIds.length === 0) return;

    // Tato funkce nov� pouze nasm�ruje jednotky k sob�. 
    // Fyzick� slou�en� prob�hne plynule v gameTick (Merge Pass), a� se k sob� arm�dy p�ibl��.
    selectedIds.forEach(id => {
        redirectExpedition(playerId, id, targetX, targetY);
    });

    logMessage(`Vyd�n rozkaz ke sjednocen� u [${targetX}, ${targetY}].`, 'info');
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
    if (struct.type === 'owned_ancient_library') revealMapAround(struct.x, struct.y, struct.data.reveal_radius, playerId);

    updateUI();
    updateActionPanel();
    recalculatePlayerIncome(playerId);
    logMessage(`Budova ${struct.data.name} byla obsazena ${player.name}!`, 'win');

    // MULTIPLAYER SYNC ACTIONS
    if (!isRemoteAction && gameState.currentLobbyId && playerId === gameState.myPlayerId) {
        import('../main.js?v=174').then(m => {
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

export function revealMap(playerId = gameState.myPlayerId) {
    for (let y = 0; y < C.GRID_SIZE; y++) {
        for (let x = 0; x < C.GRID_SIZE; x++) {
            if (!gameState.gameBoard[y][x].visibleTo.includes(playerId)) {
                gameState.gameBoard[y][x].visibleTo.push(playerId);
            }
        }
    }
    gameState.needsRedraw = true;
    logMessage('Mapa byla odhalena (Debug).');
}

// Export pro onclick v HTML
window.captureStructure = captureStructure;
window.revealMap = revealMap;
window.initGame = initGame;