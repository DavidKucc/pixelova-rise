console.log('[DEBUG] multiplayer.js loaded v=226');

import { db } from '../firebase-config.js?v=226';
import { ref, set, push, onValue, onDisconnect, remove, onChildAdded, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { gameState } from './state.js?v=226';
import { getServerTime } from './utils.js?v=226';
import { captureStructure } from './game.js?v=226';

/**
 * Zodpovídá za přepis lokálního pole `player.activeExpeditions` Firebase daty.
 */
export function setupMultiplayerSync() {
    if (!gameState.currentLobbyId) return;

    // 1. Odběr VŠECH expedic (cizích i svých kvůli Authority Hosta)
    Object.keys(gameState.players).forEach(otherPlayerId => {
        // v208: Nyní sledujeme i myPlayerId! (Abychom zaregistrovali ztráty životů od Hosta z boje)
        const expeditionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/expeditions/${otherPlayerId}`);
        onValue(expeditionsRef, (snapshot) => {
            const data = snapshot.val();
            const otherPlayer = gameState.players[otherPlayerId];
            if (!otherPlayer) return;

            if (!data) {
                // Smaže všechny lokální expedice daného nepřítele (už dorazily / zničeny) -> opravuje "Duchy"
                otherPlayer.activeExpeditions = [];
                return;
            }

            const updatedExpeditions = [];

            for (const id in data) {
                const remote = data[id];
                if (!remote) continue; // FIX pro Firebase pole s null dírami
                
                // V217: Absolutní krematorium - Mrtvoly nesmí být nikdy oživeny!
                if (remote.units <= 0) {
                    removeExpeditionFromFirebase(otherPlayerId, remote.id);
                    continue;
                }

                const existingExp = otherPlayer.activeExpeditions.find(e => e.id === remote.id);

                if (existingExp) {
                    // V222 ANTI-ROLLBACK: Pokud je toto lokální oddíl a Cloud se ho snaží "zmenšit" 
                    // krátce po tom, co proběhlo masivní slučování (zahozené staré pingy z DB) -> ZAKÁZAT!
                    const isMyOwn = otherPlayerId === gameState.myPlayerId;
                    if (isMyOwn && gameState.isHost && existingExp.unitsLeft > remote.units && remote.units > 0) {
                        console.warn(`[SYNC-HEAL] Zachycen Anomální Cloud Drop! Cloud hlásil ${remote.units}, my máme ${existingExp.unitsLeft}. Ponechávám vyšší RAM číslo a vynucuji zápis!`);
                        syncExpeditionToFirebase(otherPlayerId, existingExp);
                    } else {
                        existingExp.unitsLeft = remote.units;
                        if (remote.initialUnits !== undefined) {
                            existingExp.initialUnits = remote.initialUnits;
                            // Failsafe auto-oprava stropu
                            if (existingExp.unitsLeft > existingExp.initialUnits) existingExp.initialUnits = existingExp.unitsLeft;
                        }
                    }
                    
                    if (remote.isHolding !== undefined) existingExp.isHolding = remote.isHolding;
                    
                    if (otherPlayerId !== gameState.myPlayerId) {
                        existingExp.isRemote = true;

                        // v201 FIX: Přesměrování updatuje trasu (při bitvě zůstává Time a cíl zachován -> neseká)
                        const targetChanged = (existingExp.targetX !== remote.targetX || existingExp.targetY !== remote.targetY
                            || existingExp.startX !== remote.startX || existingExp.startY !== remote.startY);

                        if (targetChanged) {
                            existingExp.targetX = remote.targetX;
                            existingExp.targetY = remote.targetY;
                            existingExp.startX = remote.startX;
                            existingExp.startY = remote.startY;
                            existingExp.startTime = remote.startTime;
                            existingExp.duration = remote.duration;
                        
                            const elapsed = getServerTime() - (remote.startTime || 0);
                            existingExp.progress = remote.duration > 0
                                ? Math.max(0, Math.min(1, elapsed / remote.duration))
                                : 1;
                            existingExp.arrived = (existingExp.progress >= 1);
                        }
                    } else {
                        // Moje vlastní expedice modifikovaná Hostem na Firebase!
                        const targetChanged = (existingExp.targetX !== remote.targetX || existingExp.targetY !== remote.targetY);
                        if (targetChanged) {
                             existingExp.targetX = remote.targetX;
                             existingExp.targetY = remote.targetY;
                             existingExp.startX = remote.startX;
                             existingExp.startY = remote.startY;
                             existingExp.startTime = remote.startTime;
                             existingExp.duration = remote.duration;
                             existingExp.arrived = false; // Rozhodně neodborný dojezd, musí se rozjet
                        }
                    }
                    updatedExpeditions.push(existingExp);
                } else {
                    // Nová expedice
                    const elapsed = getServerTime() - (remote.startTime || 0);
                    const computedProgress = remote.duration > 0
                        ? Math.max(0, Math.min(1, elapsed / remote.duration))
                        : 1;

                    updatedExpeditions.push({
                        id: remote.id,
                        startX: remote.startX,
                        startY: remote.startY,
                        targetX: remote.targetX,
                        targetY: remote.targetY,
                        initialUnits: remote.initialUnits !== undefined ? remote.initialUnits : remote.units,
                        unitsLeft: remote.units,
                        progress: computedProgress,
                        startTime: remote.startTime,
                        duration: remote.duration,
                        isHolding: remote.isHolding || false,
                        arrived: computedProgress >= 1,
                        isRemote: (otherPlayerId !== gameState.myPlayerId)
                    });
                }
            }
            
            // LOG pro debug neviditelnosti zprostředkovaně od uživatele
            if (updatedExpeditions.length > 0) {
                console.log(`[SYNC-DEBUG] Hráč ${otherPlayerId} má celkem ${updatedExpeditions.length} akt. expedic.`);
                updatedExpeditions.forEach(e => {
                    console.log(`[SYNC-DEBUG] -> Expedice ${e.id} na souřadnicích [${Math.round(e.startX + (e.targetX - e.startX) * e.progress)}, ${Math.round(e.startY + (e.targetY - e.startY) * e.progress)}] (progress: ${e.progress.toFixed(2)})`);
                });
            }

            otherPlayer.activeExpeditions = updatedExpeditions;
        });
    });

    // 2. Sledování cizích akcí (obsazení budov)
    const actionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/actions`);
    onChildAdded(actionsRef, (snapshot) => {
        const action = snapshot.val();
        if (!action) return;

        if (action.playerId !== gameState.myPlayerId) {
            console.log("[SYNC] Přijata cizí akce:", action);
            if (action.type === 'capture') {
                captureStructure(action.playerId, action.structureId, true, false);
            }
        }
    });
}

export function syncExpeditionToFirebase(playerId, exp, partialUpdate = false) {
    if (!gameState.currentLobbyId || !exp) return;
    
    try {
        const expeditionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/expeditions/${playerId}/${exp.id}`);
        
        if (partialUpdate) {
            update(expeditionsRef, {
                startX: exp.startX,
                startY: exp.startY,
                targetX: exp.targetX,
                targetY: exp.targetY,
                startTime: exp.startTime || getServerTime(),
                duration: exp.duration || 0,
                timestamp: getServerTime()
            }).catch(e => console.error('[FIREBASE UPDATE ERROR]', e));
        } else {
            const dataLoad = {
                id: exp.id,
                startX: exp.startX,
                startY: exp.startY,
                targetX: exp.targetX,
                targetY: exp.targetY,
                units: exp.unitsLeft,
                initialUnits: exp.initialUnits,
                startTime: exp.startTime || getServerTime(),
                duration: exp.duration || 0,
                isHolding: exp.isHolding || false,
                timestamp: getServerTime()
            };
            set(expeditionsRef, dataLoad).catch(e => console.error('[FIREBASE SET ERROR]', e, dataLoad));
        }
    } catch (err) {
        console.error('[SYNC CRITICAL ERROR]', err, exp);
    }
}

export function removeExpeditionFromFirebase(playerId, expId) {
    if (!db || !gameState.currentLobbyId) return;
    const path = `lobbies/${gameState.currentLobbyId}/expeditions/${playerId}/${expId}`;
    remove(ref(db, path)).catch(err => console.error(`[SYNC] Chyba při mazání z FB:`, err));
}

export function syncActionToFirebase(actionData) {
    if (!gameState.currentLobbyId || !actionData) return;
    const actionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/actions`);
    push(actionsRef, actionData);
}
