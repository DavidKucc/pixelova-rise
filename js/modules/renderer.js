// js/modules/renderer.js
// Vše co se týká kreslení na Canvas.

import { ui } from './ui.js?v=130';
import { gameState, viewportState } from './state.js?v=130';
import * as C from './config.js?v=130';
const { GRID_SIZE, CELL_SIZE, GAP_SIZE, CELL_COLORS, STRUCTURE_ICONS, UNIT_PIXEL_SIZE, UNIT_SPREAD } = C;

export function gameLoop() {
    // Pokud jsou aktivní expedice, vynutíme překreslení pro plynulou animaci liquid efektu
    let hasExpeditions = false;
    for (const pid in gameState.players) {
        if (gameState.players[pid].activeExpeditions?.length > 0) {
            hasExpeditions = true;
            break;
        }
    }

    if (hasExpeditions) gameState.needsRedraw = true;

    requestAnimationFrame(gameLoop);
    if (!gameState.needsRedraw) return;
    draw();
    gameState.needsRedraw = false;
}

function draw() {
    const { ctx, canvas } = ui;
    console.log('Draw called. Canvas size:', canvas.width, canvas.height);
    const { scale, gridPos } = viewportState;
    const humanPlayer = gameState.players['human'];
    // Pojistka pro případ, že by se funkce zavolala dříve, než je hráč inicializován
    if (!humanPlayer) return;

    ctx.save();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(gridPos.x, gridPos.y);
    ctx.scale(scale, scale);

    const fullCellSize = CELL_SIZE + GAP_SIZE;
    // Přidáme extra padding (např. 2 buňky) na každou stranu, abychom předešli ořezání na okrajích
    const startX = Math.max(0, Math.floor(-gridPos.x / (fullCellSize * scale)) - 2);
    const endX = Math.min(GRID_SIZE, Math.ceil((-gridPos.x + canvas.width) / (fullCellSize * scale)) + 2);
    const startY = Math.max(0, Math.floor(-gridPos.y / (fullCellSize * scale)) - 2);
    const endY = Math.min(GRID_SIZE, Math.ceil((-gridPos.y + canvas.height) / (fullCellSize * scale)) + 2);

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const cell = gameState.gameBoard[y][x];
            const isVisible = cell.visibleTo.includes('human');

            let finalColor = CELL_COLORS['hidden']; // Výchozí barva je skrytá

            if (isVisible) {
                // Pokud je buňka viditelná, nastavíme barvu podle vlastníka
                if (cell.ownerId) {
                    const owner = gameState.players[cell.ownerId];
                    // Pro území použijeme barvu hráče, ale se sníženou sytostí/světlostí nebo průhledností
                    // Tady ji prostě trochu ztlumíme, aby "nesvítila" jako jednotka
                    ctx.globalAlpha = 0.4; // Území je jen podkres
                    finalColor = owner.color;
                } else {
                    finalColor = CELL_COLORS['owned-land']; // Neutrální viditelná
                }

                // Teď nekompromisně přepíšeme barvu, pokud je zde cizí struktura
                // ODSTRANĚNO: Nechceme přepisovat barvu, chceme vidět červenou pro AI
                /*
                const structOnCell = cell.structureId ? gameState.structures.get(cell.structureId) : null;
                if (structOnCell && structOnCell.ownerId !== 'human') {
                    finalColor = CELL_COLORS['owned-land'];
                }
                */

                // A úplně nakonec má slovo terén
                if (cell.terrain === 'road') {
                    finalColor = CELL_COLORS['terrain-road'];
                } else if (cell.terrain === 'forest') {
                    finalColor = CELL_COLORS['terrain-forest'];
                }
            }

            ctx.fillStyle = finalColor;
            ctx.fillRect(x * fullCellSize, y * fullCellSize, CELL_SIZE, CELL_SIZE);
            ctx.globalAlpha = 1.0; // Reset alpha pro další věci (budovy, jednotky)
        }
    }

    // Smyčka pro kreslení IKON a RÁMEČKŮ - musí být také uvnitř transformace!
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    gameState.structures.forEach(struct => {
        const structCell = gameState.gameBoard[struct.y][struct.x];
        // Kreslíme POUZE pokud je struktura viditelná pro hráče
        if (structCell.visibleTo.includes('human')) {
            const structScreenX = struct.x * fullCellSize;
            const structScreenY = struct.y * fullCellSize;

            // Kreslení ikony
            let iconChar = '';
            // Oprava ikony pro krystalový důl
            const typeKey = struct.type.replace('owned_', '');
            // Hledáme nejdelší (nejpřesnější) shodný klíč
            let bestMatch = '';
            for (const key in STRUCTURE_ICONS) {
                if (typeKey.includes(key) && key.length > bestMatch.length) {
                    bestMatch = key;
                }
            }
            if (bestMatch) {
                iconChar = STRUCTURE_ICONS[bestMatch];
            }
            if (iconChar) {
                ctx.font = `${struct.w * CELL_SIZE * 0.8}px Segoe UI Emoji`;
                ctx.fillText(iconChar, structScreenX + (struct.w * fullCellSize / 2), structScreenY + (struct.h * fullCellSize / 2));
            }

            // Kreslení rámečku, pokud má vlastníka
            if (struct.ownerId) {
                const owner = gameState.players[struct.ownerId];
                ctx.strokeStyle = owner.borderColor;
                ctx.lineWidth = 2 / scale;
                ctx.strokeRect(structScreenX, structScreenY, struct.w * fullCellSize - GAP_SIZE, struct.h * fullCellSize - GAP_SIZE);
            }
        }
    });

    // Kreslení EXPEDIC
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player || !player.activeExpeditions) continue;

        player.activeExpeditions.forEach(exp => {
            const isSelected = gameState.selectedExpeditionIds.includes(exp.id);

            ctx.fillStyle = player.color;
            ctx.strokeStyle = isSelected ? '#fff' : player.color;
            ctx.lineWidth = isSelected ? (2 / scale) : (1 / scale);
            // GRID-SNAPPED "MRAK" EFEKT: Jednotky se hýbou po celých buňkách (pixelech mapy)
            const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
            const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

            // Definované offsety pro mrak (tvoří kříž/kruh bez mezer)
            const cloudOffsets = [
                { x: 0, y: 0 },
                { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
                { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
                { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 },
                { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 },
                { x: 1, y: 2 }, { x: -1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: -2 }
            ];

            // Počet bloků v mraku podle síly expedice
            const unitDisplayCount = Math.min(Math.ceil(exp.unitsLeft / 2), cloudOffsets.length);

            for (let i = 0; i < unitDisplayCount; i++) {
                const offset = cloudOffsets[i];
                const drawX = (curX + offset.x) * fullCellSize;
                const drawY = (curY + offset.y) * fullCellSize;

                // Vykreslení čistého bloku přesně na mřížce
                ctx.fillRect(
                    drawX,
                    drawY,
                    CELL_SIZE,
                    CELL_SIZE
                );

                if (isSelected) {
                    ctx.strokeRect(
                        drawX,
                        drawY,
                        CELL_SIZE,
                        CELL_SIZE
                    );
                }
            }
        });
    }

    // Vykreslení výběrového boxu
    if (gameState.selectionBox && gameState.selectionBox.active && viewportState.didDrag) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset na obrazovkové souřadnice
        ctx.strokeStyle = 'rgba(3, 169, 244, 0.8)';
        ctx.fillStyle = 'rgba(3, 169, 244, 0.2)';
        ctx.lineWidth = 2;

        const box = gameState.selectionBox;
        const x = Math.min(box.startX, box.endX);
        const y = Math.min(box.startY, box.endY);
        const w = Math.abs(box.endX - box.startX);
        const h = Math.abs(box.endY - box.startY);

        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
}