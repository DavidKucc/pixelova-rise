console.log('[DEBUG] renderer.js loaded v=162');

import { ui } from './ui.js?v=162';
import { gameState, viewportState } from './state.js?v=162';
import * as C from './config.js?v=162';
const { GRID_SIZE, CELL_SIZE, GAP_SIZE, CELL_COLORS, STRUCTURE_ICONS, UNIT_PIXEL_SIZE, UNIT_SPREAD } = C;

export function gameLoop() {
    if (gameState.needsRedraw) {
        drawBoard();
        gameState.needsRedraw = false;
    }
    requestAnimationFrame(gameLoop);
}

function drawBoard() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas || !gameState.gameBoard || gameState.gameBoard.length < GRID_SIZE) return;
    const ctx = canvas.getContext('2d');
    const { scale, gridPos } = viewportState;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(gridPos.x, gridPos.y);
    ctx.scale(scale, scale);

    const fullCellSize = CELL_SIZE + GAP_SIZE;

    // 1. VYKRESLENÍ TERÉNU A FOG OF WAR
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.gameBoard[y][x];

            // OPTIMALIZACE: Pokud není buňka vidět, kreslíme černo
            let visible = cell.visibleTo.includes(gameState.myPlayerId);
            let finalColor = visible ? (CELL_COLORS[cell.terrain] || CELL_COLORS['none'] || '#3d9440') : CELL_COLORS['hidden'];

            ctx.fillStyle = finalColor;
            ctx.fillRect(x * fullCellSize, y * fullCellSize, CELL_SIZE, CELL_SIZE);
        }
    }

    // 2. VYKRESLENÍ BUDOV
    gameState.structures.forEach(struct => {
        const structCell = gameState.gameBoard[struct.y][struct.x];
        const isVisible = structCell.visibleTo.includes(gameState.myPlayerId);

        if (isVisible) {
            const structScreenX = struct.x * fullCellSize;
            const structScreenY = struct.y * fullCellSize;

            // Pokud je budova objevená, ale nikdo ji nevlastní, dáme jí "neutrální" barvu budovy
            ctx.fillStyle = (struct.ownerId === gameState.myPlayerId) ? '#1976D2' : (struct.ownerId ? '#D32F2F' : '#78909C');
            ctx.fillRect(structScreenX, structScreenY, struct.w * fullCellSize - GAP_SIZE, struct.h * fullCellSize - GAP_SIZE);

            // Ikona
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const typeKey = struct.type.replace('owned_', '');
            let iconChar = STRUCTURE_ICONS[typeKey] || '🏠';

            ctx.font = `${struct.w * CELL_SIZE * 0.7}px Segoe UI Emoji`;
            ctx.fillText(iconChar, structScreenX + (struct.w * fullCellSize / 2), structScreenY + (struct.h * fullCellSize / 2));

            if (struct.ownerId) {
                const owner = gameState.players[struct.ownerId];
                ctx.strokeStyle = owner?.borderColor || '#fff';
                ctx.lineWidth = 2 / scale;
                ctx.strokeRect(structScreenX, structScreenY, struct.w * fullCellSize - GAP_SIZE, struct.h * fullCellSize - GAP_SIZE);
            }
        }
    });

    // 3. VYKRESLENÍ EXPEDIC
    // Moje expedice
    if (gameState.players[gameState.myPlayerId]?.activeExpeditions) {
        gameState.players[gameState.myPlayerId].activeExpeditions.forEach(exp => {
            const isSelected = gameState.selectedExpeditionIds.includes(exp.id);
            const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
            const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;
            drawExpedition(ctx, curX, curY, exp.unitsLeft, gameState.players[gameState.myPlayerId].color, isSelected);
            drawDustIndicators(ctx, curX, curY);
        });
    }

    // Ostatní expedice (jen v dohledu)
    Object.keys(gameState.players).forEach(pId => {
        if (pId === gameState.myPlayerId) return;
        const oPlayer = gameState.players[pId];
        if (oPlayer?.activeExpeditions) {
            oPlayer.activeExpeditions.forEach(exp => {
                const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
                const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;
                const cell = gameState.gameBoard[Math.round(curY)]?.[Math.round(curX)];
                if (cell?.visibleTo.includes(gameState.myPlayerId)) {
                    drawExpedition(ctx, curX, curY, exp.unitsLeft, oPlayer.color, false);
                }
            });
        }
    });

    // 4. VÝBĚROVÝ BOX
    if (gameState.selectionBox?.active && viewportState.didDrag) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(3, 169, 244, 0.8)';
        ctx.fillStyle = 'rgba(3, 169, 244, 0.2)';
        ctx.lineWidth = 2;
        const { startX, startY, endX, endY } = gameState.selectionBox;
        ctx.fillRect(Math.min(startX, endX), Math.min(startY, endY), Math.abs(endX - startX), Math.abs(endY - startY));
        ctx.strokeRect(Math.min(startX, endX), Math.min(startY, endY), Math.abs(endX - startX), Math.abs(endY - startY));
    }

    ctx.restore();
}

function drawExpedition(ctx, curX, curY, units, color, isSelected) {
    const fullCellSize = CELL_SIZE + GAP_SIZE;
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#fff' : color;
    ctx.lineWidth = isSelected ? (2 / viewportState.scale) : (1 / viewportState.scale);

    const offsets = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }
    ];
    const count = Math.min(Math.ceil(units / 2), offsets.length);
    for (let i = 0; i < count; i++) {
        const ox = Math.round(curX + offsets[i].x) * fullCellSize;
        const oy = Math.round(curY + offsets[i].y) * fullCellSize;
        ctx.fillRect(ox, oy, CELL_SIZE, CELL_SIZE);
        if (isSelected) ctx.strokeRect(ox, oy, CELL_SIZE, CELL_SIZE);
    }
}

function drawDustIndicators(ctx, x, y) {
    const RANGE = 20;

    Object.keys(gameState.players).forEach(pId => {
        if (pId === gameState.myPlayerId) return; // Nekreslit radar pro sebe

        const enemyPlayer = gameState.players[pId];
        if (!enemyPlayer.activeExpeditions) return;

        enemyPlayer.activeExpeditions.forEach(enemy => {
            const ex = enemy.startX + (enemy.targetX - enemy.startX) * enemy.progress;
            const ey = enemy.startY + (enemy.targetY - enemy.startY) * enemy.progress;
            const dist = Math.hypot(x - ex, y - ey);
            const cell = gameState.gameBoard[Math.round(ey)]?.[Math.round(ex)];

            // Kresli radar jen, dokud expedice není v našem jasném výhledu
            if (dist < RANGE && !cell?.visibleTo.includes(gameState.myPlayerId)) {
                const angle = Math.atan2(ey - y, ex - x);
                const radius = 30;
                ctx.beginPath();
                ctx.arc(x * (CELL_SIZE + GAP_SIZE), y * (CELL_SIZE + GAP_SIZE), radius, angle - 0.4, angle + 0.4);
                // Vykreslí prach v barvě nepřítele
                const r = parseInt(enemyPlayer.color.slice(1, 3), 16);
                const g = parseInt(enemyPlayer.color.slice(3, 5), 16);
                const b = parseInt(enemyPlayer.color.slice(5, 7), 16);
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${1 - (dist / RANGE)})`;
                ctx.lineWidth = 5;
                ctx.stroke();
            }
        });
    });
}