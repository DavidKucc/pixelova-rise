console.log('[DEBUG] combat.js loaded v=221');

import { gameState } from './state.js?v=221';
import { removeExpedition } from './game.js?v=221';
import { syncExpeditionToFirebase, removeExpeditionFromFirebase } from './multiplayer.js?v=221';

/**
 * Zpracovává bitvy mezi dvěma expedicemi. 
 * KLIČOVÉ V201: Výpočty poškození a sync do sítě dělá POUZE Hostitel.
 */
export function handleCombatBetweenExpeditions(p1Id) {
    const p1 = gameState.players[p1Id];
    if (!p1) return;

    for (const p2Id in gameState.players) {
        if (p1Id === p2Id) continue;
        const p2 = gameState.players[p2Id];

        p1.activeExpeditions.forEach(e1 => {
            if (e1.unitsLeft <= 0) return; // Mrtví nebojují
            p2.activeExpeditions.forEach(e2 => {
                if (e2.unitsLeft <= 0) return; // Obrana proti Ghostům
                const e1Y = e1.startY + (e1.targetY - e1.startY) * e1.progress;
                const e2X = e2.startX + (e2.targetX - e2.startX) * e2.progress;
                const e2Y = e2.startY + (e2.targetY - e2.startY) * e2.progress;

                const dist = Math.hypot(e1X - e2X, e1Y - e2Y);

                if (dist < 1.5) { // Dosah boje
                    const cell = gameState.gameBoard[Math.round(e1Y)]?.[Math.round(e1X)];
                    const terrainWidth = (cell?.terrain === 'forest') ? 0.2 : 1.0;

                    // --- V201 HOST AUTHORITY ---
                    // Pouze pokud jsem Host (zakladatel lobby nebo local mode) provádím matematiku a sync
                    if (gameState.isHost || !gameState.currentLobbyId) {
                        const baseLoss = 2 * terrainWidth;
                        e1.unitsLeft -= baseLoss;
                        e2.unitsLeft -= baseLoss;

                        if (e1.unitsLeft <= 0) {
                            removeExpedition(p1Id, e1.id);
                            if (gameState.currentLobbyId) removeExpeditionFromFirebase(p1Id, e1.id);
                        }
                        if (e2.unitsLeft <= 0) {
                            removeExpedition(p2Id, e2.id);
                            if (gameState.currentLobbyId) removeExpeditionFromFirebase(p2Id, e2.id);
                        }

                        // Host odešle update OBOU zasažených expedic jen pokud neumřely
                        if (gameState.currentLobbyId) {
                            if (e1.unitsLeft > 0) syncExpeditionToFirebase(p1Id, e1);
                            if (e2.unitsLeft > 0) syncExpeditionToFirebase(p2Id, e2);
                        }
                    }

                    gameState.needsRedraw = true;
                }
            });
        });
    }
}
