// js/modules/renderer.js
// Vše co se týká kreslení na Canvas.

import { ui } from './ui.js?v=141';
import { gameState, viewportState } from './state.js?v=141';
import * as C from './config.js?v=141';
import { myPlayerId } from '../main.js?v=141';
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
    if (!canvas) return;
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
            let finalColor = CELL_COLORS['hidden'];

            // MULTIPLAYER: Vidím jen to co prozkoumal "já"
            if (cell.visibleTo.includes(myPlayerId)) {
                finalColor = CELL_COLORS[cell.terrain] || '#222';
            }

            ctx.fillStyle = finalColor;
            ctx.fillRect(x * fullCellSize, y * fullCellSize, CELL_SIZE, CELL_SIZE);
        }
    }

    // 2. VYKRESLENÍ BUDOV
    gameState.structures.forEach(struct => {
        const structCell = gameState.gameBoard[struct.y][struct.x];
        if (structCell.visibleTo.includes(myPlayerId)) {
            const structScreenX = struct.x * fullCellSize;
            const structScreenY = struct.y * fullCellSize;

            ctx.fillStyle = (struct.ownerId === myPlayerId) ? '#1976D2' : '#455A64';
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
    if (gameState.players[myPlayerId]?.activeExpeditions) {
        gameState.players[myPlayerId].activeExpeditions.forEach(exp => {
            const isSelected = gameState.selectedExpeditionIds.includes(exp.id);
            const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
            const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;
            drawExpedition(ctx, curX, curY, exp.unitsLeft, gameState.players[myPlayerId].color, isSelected);
            drawDustIndicators(ctx, curX, curY);
        });
    }

    // Ostatní expedice (jen v dohledu)
    Object.keys(gameState.players).forEach(pId => {
        if (pId === myPlayerId) return;
        const oPlayer = gameState.players[pId];
        if (oPlayer?.activeExpeditions) {
            oPlayer.activeExpeditions.forEach(exp => {
                const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
                const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;
                const cell = gameState.gameBoard[Math.round(curY)]?.[Math.round(curX)];
                if (cell?.visibleTo.includes(myPlayerId)) {
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
    if (!gameState.players['enemy']?.activeExpeditions) return;
    gameState.players['enemy'].activeExpeditions.forEach(enemy => {
        const ex = enemy.startX + (enemy.targetX - enemy.startX) * enemy.progress;
        const ey = enemy.startY + (enemy.targetY - enemy.startY) * enemy.progress;
        const dist = Math.hypot(x - ex, y - ey);
        const cell = gameState.gameBoard[Math.round(ey)]?.[Math.round(ex)];
        if (dist < RANGE && !cell?.visibleTo.includes('human')) {
            const angle = Math.atan2(ey - y, ex - x);
            const radius = 30;
            ctx.beginPath();
            ctx.arc(x * (CELL_SIZE + GAP_SIZE), y * (CELL_SIZE + GAP_SIZE), radius, angle - 0.4, angle + 0.4);
            ctx.strokeStyle = `rgba(255, 0, 0, ${1 - (dist / RANGE)})`;
            ctx.lineWidth = 5;
            ctx.stroke();
        }
    });
}