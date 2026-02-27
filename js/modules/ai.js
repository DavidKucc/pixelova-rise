console.log('[AI] ai.js loaded v=144');

import { gameState } from './state.js?v=144';
import { launchExpedition, buildStructure, captureStructure } from './game.js?v=144';
import * as C from './config.js?v=144';
import { isAreaClear } from './utils.js?v=144';

// Hlavní rozhodovací funkce pro AI
export function runAIDecision(playerId) {
    const aiPlayer = gameState.players[playerId];
    if (!aiPlayer) return;

    // 1. REKRUTOVÁNÍ JEDNOTEK
    // AI chce udržovat armádu úměrnou svému zlatu, ale nenechat se zruinovat.
    const desiredUnits = Math.min(200, Math.floor(aiPlayer.income * 10)); // Cíl: 10x příjem, max 200
    if (aiPlayer.units < desiredUnits && aiPlayer.gold >= C.UNIT_COST) {
        const unitsToBuy = Math.min(Math.floor(aiPlayer.gold / C.UNIT_COST), 5); // Max 5 zaráz
        aiPlayer.units += unitsToBuy;
        aiPlayer.gold -= unitsToBuy * C.UNIT_COST;
        // console.log(`AI ${playerId} bought ${unitsToBuy} units.`);
    }

    // 2. EXPEDICE (EXPANZE)
    // Pokud máme dost jednotek a málo expedic
    if (aiPlayer.units > 15 && aiPlayer.activeExpeditions.length < 3) {
        // Hledáme cíl: Ideálně neobsazená struktura, o které víme
        let targetX, targetY;
        const visibleStructures = findKnownFreeStructures(playerId);

        if (visibleStructures.length > 0) {
            const star = visibleStructures[Math.floor(Math.random() * visibleStructures.length)];
            targetX = star.x + Math.floor(star.w / 2); // Střed struktury
            targetY = star.y + Math.floor(star.h / 2);
        } else {
            // Náhodný průzkum
            targetX = Math.floor(Math.random() * C.GRID_SIZE);
            targetY = Math.floor(Math.random() * C.GRID_SIZE);
        }

        const unitsToSend = Math.min(aiPlayer.units - 5, 25); // Nech si doma aspoň 5, pošli max 25

        if (unitsToSend > 5) {
            launchExpeditionForAI(playerId, targetX, targetY, unitsToSend);
            // console.log(`AI ${playerId} launched expedition to [${targetX}, ${targetY}] with ${unitsToSend} units.`);
        }
    }

    // 3. STAVBA BUDOV
    // Pokud máme hodně surovin, stavíme.
    if (aiPlayer.gold > 400 && aiPlayer.crystals > 100) {
        // Co stavět? Doly > Vesnice > Kasárna
        let typeToBuild = null;
        if (Math.random() < 0.4) typeToBuild = 'mine';
        else if (Math.random() < 0.7) typeToBuild = 'village';
        else typeToBuild = 'barracks';

        const cost = C.BUILDINGS[typeToBuild].cost;
        if (aiPlayer.gold >= cost.gold && aiPlayer.crystals >= cost.crystals) {
            const spot = findBuildSpot(playerId, C.BUILDINGS[typeToBuild].size);
            if (spot) {
                buildStructure(playerId, typeToBuild, spot.x, spot.y);
                // console.log(`AI ${playerId} built ${typeToBuild} at [${spot.x}, ${spot.y}].`);
            }
        }
    }

    // 4. OBSAZOVÁNÍ (CAPTURE)
    // Pokud vidíme cizí strukturu a máme na ni, bereme ji.
    const captureTargets = findCaptureTargets(playerId);
    for (const target of captureTargets) {
        if (aiPlayer.gold >= target.data.cost) {
            captureStructure(playerId, target.id);
            // console.log(`AI ${playerId} captured ${target.type} at [${target.x}, ${target.y}].`);
            break; // Jednu za tick stačí
        }
    }
}

// Pomocná funkce pro AI expedice (nepoužívá UI slider)
function launchExpeditionForAI(playerId, targetX, targetY, unitsToSend) {
    const player = gameState.players[playerId];
    // if (player.units < unitsToSend) return; // Kontrolováno nahoře

    player.units -= unitsToSend;
    player.expeditionCounter++;
    const newExpedition = {
        id: `${playerId}-${player.expeditionCounter}`,
        ownerId: playerId,
        targetX, targetY,
        initialUnits: unitsToSend,
        unitsLeft: unitsToSend,
        attritionCounter: C.ATTRITION_RATE,
        isFinished: false,
    };
    player.activeExpeditions.push(newExpedition);
}

// Najde volné místo vedle existujícího území
function findBuildSpot(playerId, size) {
    // Projdeme herní pole a hledáme 'owned' buňky tohoto hráče
    // Je to drahé, takže to děláme jen občas (AI loop je co 3s)
    const candidates = [];

    for (let y = 1; y < C.GRID_SIZE - size - 1; y += 2) {
        for (let x = 1; x < C.GRID_SIZE - size - 1; x += 2) {
            // Rychlý check: Je toto místo blízko nějaké naší buňky? (zjednodušeno - kontrola vlastnictví)
            const cell = gameState.gameBoard[y][x];
            if (cell.ownerId === playerId) {
                // Zkusíme najít místo v okolí
                for (let dy = -5; dy <= 5; dy += 2) {
                    for (let dx = -5; dx <= 5; dx += 2) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (isAreaClear(nx, ny, size, size)) {
                            candidates.push({ x: nx, y: ny });
                            if (candidates.length > 5) break;
                        }
                    }
                    if (candidates.length > 5) break;
                }
            }
        }
        if (candidates.length > 5) break;
    }

    if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return null;
}

function findKnownFreeStructures(playerId) {
    const targets = [];
    gameState.structures.forEach(s => {
        // Pokud není naše (ownerId !== playerId)
        // A je viditelná (nějaká buňka pod ní je visibleTo playerId)
        // A NENÍ to 'owned_' (tj. je neutrální)
        if (s.ownerId !== playerId && !s.type.startsWith('owned_')) {
            const cell = gameState.gameBoard[s.y][s.x];
            if (cell.visibleTo.includes(playerId)) {
                targets.push(s);
            }
        }
    });
    return targets;
}

function findCaptureTargets(playerId) {
    const targets = [];
    gameState.structures.forEach(s => {
        // Cizí, viditelná, a NENÍ neutrální (pro jednoduchost AI zatím krade jen neutrální, ale pojďme povolit i kradení cizích pokud jsou Owned)
        // UPDATE: AI by měla brát hlavně ty, co sousedí s jejím územím nebo jsou vidět.
        if (s.ownerId !== playerId) {
            const cell = gameState.gameBoard[s.y][s.x];
            if (cell.visibleTo.includes(playerId)) {
                targets.push(s);
            }
        }
    });
    return targets;
}
