console.log('[AI] ai.js loaded v=178');

import { gameState } from './state.js?v=178';
import { launchExpedition, buildStructure, captureStructure } from './game.js?v=178';
import * as C from './config.js?v=178';
import { isAreaClear } from './utils.js?v=178';

// Hlavn� rozhodovac� funkce pro AI
export function runAIDecision(playerId) {
    const aiPlayer = gameState.players[playerId];
    if (!aiPlayer) return;

    // 1. REKRUTOV�N� JEDNOTEK
    // AI chce udr�ovat arm�du �m�rnou sv�mu zlatu, ale nenechat se zruinovat.
    const desiredUnits = Math.min(200, Math.floor(aiPlayer.income * 10)); // C�l: 10x p��jem, max 200
    if (aiPlayer.units < desiredUnits && aiPlayer.gold >= C.UNIT_COST) {
        const unitsToBuy = Math.min(Math.floor(aiPlayer.gold / C.UNIT_COST), 5); // Max 5 zar�z
        aiPlayer.units += unitsToBuy;
        aiPlayer.gold -= unitsToBuy * C.UNIT_COST;
        // console.log(`AI ${playerId} bought ${unitsToBuy} units.`);
    }

    // 2. EXPEDICE (EXPANZE)
    // Pokud m�me dost jednotek a m�lo expedic
    if (aiPlayer.units > 15 && aiPlayer.activeExpeditions.length < 3) {
        // Hled�me c�l: Ide�ln� neobsazen� struktura, o kter� v�me
        let targetX, targetY;
        const visibleStructures = findKnownFreeStructures(playerId);

        if (visibleStructures.length > 0) {
            const star = visibleStructures[Math.floor(Math.random() * visibleStructures.length)];
            targetX = star.x + Math.floor(star.w / 2); // St�ed struktury
            targetY = star.y + Math.floor(star.h / 2);
        } else {
            // N�hodn� pr�zkum
            targetX = Math.floor(Math.random() * C.GRID_SIZE);
            targetY = Math.floor(Math.random() * C.GRID_SIZE);
        }

        const unitsToSend = Math.min(aiPlayer.units - 5, 25); // Nech si doma aspo� 5, po�li max 25

        if (unitsToSend > 5) {
            launchExpeditionForAI(playerId, targetX, targetY, unitsToSend);
            // console.log(`AI ${playerId} launched expedition to [${targetX}, ${targetY}] with ${unitsToSend} units.`);
        }
    }

    // 3. STAVBA BUDOV
    // Pokud m�me hodn� surovin, stav�me.
    if (aiPlayer.gold > 400 && aiPlayer.crystals > 100) {
        // Co stav�t? Doly > Vesnice > Kas�rna
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

    // 4. OBSAZOV�N� (CAPTURE)
    // Pokud vid�me ciz� strukturu a m�me na ni, bereme ji.
    const captureTargets = findCaptureTargets(playerId);
    for (const target of captureTargets) {
        if (aiPlayer.gold >= target.data.cost) {
            captureStructure(playerId, target.id);
            // console.log(`AI ${playerId} captured ${target.type} at [${target.x}, ${target.y}].`);
            break; // Jednu za tick sta��
        }
    }
}

// Pomocn� funkce pro AI expedice (nepou��v� UI slider)
function launchExpeditionForAI(playerId, targetX, targetY, unitsToSend) {
    const player = gameState.players[playerId];
    // if (player.units < unitsToSend) return; // Kontrolov�no naho�e

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

// Najde voln� m�sto vedle existuj�c�ho �zem�
function findBuildSpot(playerId, size) {
    // Projdeme hern� pole a hled�me 'owned' bu�ky tohoto hr��e
    // Je to drah�, tak�e to d�l�me jen ob�as (AI loop je co 3s)
    const candidates = [];

    for (let y = 1; y < C.GRID_SIZE - size - 1; y += 2) {
        for (let x = 1; x < C.GRID_SIZE - size - 1; x += 2) {
            // Rychl� check: Je toto m�sto bl�zko n�jak� na�� bu�ky? (zjednodu�eno - kontrola vlastnictv�)
            const cell = gameState.gameBoard[y][x];
            if (cell.ownerId === playerId) {
                // Zkus�me naj�t m�sto v okol�
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
        // Pokud nen� na�e (ownerId !== playerId)
        // A je viditeln� (n�jak� bu�ka pod n� je visibleTo playerId)
        // A NEN� to 'owned_' (tj. je neutr�ln�)
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
        // Ciz�, viditeln�, a NEN� neutr�ln� (pro jednoduchost AI zat�m krade jen neutr�ln�, ale poj�me povolit i kraden� ciz�ch pokud jsou Owned)
        // UPDATE: AI by m�la br�t hlavn� ty, co soused� s jej�m �zem�m nebo jsou vid�t.
        if (s.ownerId !== playerId) {
            const cell = gameState.gameBoard[s.y][s.x];
            if (cell.visibleTo.includes(playerId)) {
                targets.push(s);
            }
        }
    });
    return targets;
}
