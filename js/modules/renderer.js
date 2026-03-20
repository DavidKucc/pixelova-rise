console.log('[DEBUG] renderer.js loaded v=224');

import { ui } from './ui.js?v=224';
import { gameState, viewportState } from './state.js?v=224';
import * as C from './config.js?v=224';
const { GRID_SIZE, CELL_SIZE, GAP_SIZE, CELL_COLORS, STRUCTURE_ICONS, UNIT_PIXEL_SIZE, UNIT_SPREAD } = C;

let bgCanvasCache = null;
let fogCanvasCache = null;
let bgCtx = null;
let fogCtx = null;

export function initRendererCache() {
    console.log('[RENDERER] Generuji Offscreen Cache mapy (Očekávejte drobný initial lag)...');
    const fullSize = C.GRID_SIZE * (C.CELL_SIZE + C.GAP_SIZE);
    
    bgCanvasCache = document.createElement('canvas');
    bgCanvasCache.width = fullSize;
    bgCanvasCache.height = fullSize;
    bgCtx = bgCanvasCache.getContext('2d', { alpha: false }); 
    
    // Default podklad (černá vrstva vytvoří přirozené Gaps/spáry mezi buňkami)
    bgCtx.fillStyle = '#000';
    bgCtx.fillRect(0, 0, fullSize, fullSize);
    
    fogCanvasCache = document.createElement('canvas');
    fogCanvasCache.width = fullSize;
    fogCanvasCache.height = fullSize;
    fogCtx = fogCanvasCache.getContext('2d');
    
    // Kompletně černá mlha na startu
    fogCtx.fillStyle = C.CELL_COLORS['hidden'];
    fogCtx.fillRect(0, 0, fullSize, fullSize);

    const fullCellSize = C.CELL_SIZE + C.GAP_SIZE;
    
    for (let y = 0; y < C.GRID_SIZE; y++) {
        for (let x = 0; x < C.GRID_SIZE; x++) {
            const cell = gameState.gameBoard[y][x];
            
            // Vykreslení úplně všech terénů na černý podklad (zachová 1px Grid Gaps)
            bgCtx.fillStyle = C.CELL_COLORS[cell.terrain] || '#3d9440';
            bgCtx.fillRect(x * fullCellSize, y * fullCellSize, C.CELL_SIZE, C.CELL_SIZE);
            
            // Prvotní odhalení mlhy
            if (cell.visibleTo.includes(gameState.myPlayerId)) {
                fogCtx.clearRect(x * fullCellSize, y * fullCellSize, fullCellSize, fullCellSize);
            }
        }
    }
    console.log('[RENDERER] Cache mapy vygenerována úspěšně!');
}

export function updateFogCache(x, y) {
    if (!fogCtx) return;
    const fullCellSize = C.CELL_SIZE + C.GAP_SIZE;
    fogCtx.clearRect(x * fullCellSize, y * fullCellSize, fullCellSize, fullCellSize);
}

export function gameLoop() {
    // v195 FIX: Pokud existuje jakákoliv pohybující se expedice, VŽDY překreslovat každý frame.
    // Dříve se kreslilo jen při gameState.needsRedraw = true (pouze při akci uživatele).
    // Vzdálené expedice mají své progress aktualizované physicsLoop, ale plátno se neobnovilo.
    let hasMovingExpeditions = false;
    for (const pId in gameState.players) {
        const p = gameState.players[pId];
        if (p?.activeExpeditions?.some(e => !e.arrived)) {
            hasMovingExpeditions = true;
            break;
        }
    }

    if (gameState.needsRedraw || hasMovingExpeditions) {
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

    // 0. VIEWPORT CULLING: Analýza viditelné plochy pro ořez neviditelných buněk (s přesahem 1 buňky pro jistotu)
    const startX = Math.max(0, Math.floor(-gridPos.x / (scale * fullCellSize)) - 1);
    const endX = Math.min(GRID_SIZE, Math.ceil((canvas.width - gridPos.x) / (scale * fullCellSize)) + 1);
    const startY = Math.max(0, Math.floor(-gridPos.y / (scale * fullCellSize)) - 1);
    const endY = Math.min(GRID_SIZE, Math.ceil((canvas.height - gridPos.y) / (scale * fullCellSize)) + 1);

    // 1. VYKRESLENÍ TERÉNU A FOG OF WAR (Akcelerováno přes Offscreen Cache Textury viz V218)
    if (bgCanvasCache && fogCanvasCache) {
        const sx = Math.max(0, startX * fullCellSize);
        const sy = Math.max(0, startY * fullCellSize);
        const sw = Math.max(1, Math.min(bgCanvasCache.width - sx, (endX - startX) * fullCellSize));
        const sh = Math.max(1, Math.min(bgCanvasCache.height - sy, (endY - startY) * fullCellSize));

        // Bleskurychlý GPU Blit
        ctx.drawImage(bgCanvasCache, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.drawImage(fogCanvasCache, sx, sy, sw, sh, sx, sy, sw, sh);
    }

    // 2. VYKRESLENÍ BUDOV (s cullingem)
    gameState.structures.forEach(struct => {
        // Culling: Přeskočit budovy mimo obrazovku
        if (struct.x + struct.w < startX || struct.x > endX || struct.y + struct.h < startY || struct.y > endY) return;

        const structCell = gameState.gameBoard[struct.y]?.[struct.x];
        if (!structCell) return;
        const isVisible = structCell.visibleTo.includes(gameState.myPlayerId);

        if (isVisible) {
            const structScreenX = struct.x * fullCellSize;
            const structScreenY = struct.y * fullCellSize;

            // Pokud je budova objeven, ale nikdo ji nevlastn, dme j "neutrln" barvu budovy
            const owner = struct.ownerId ? gameState.players[struct.ownerId] : null;
            ctx.fillStyle = owner ? owner.baseColor : '#78909C';

            // Abychom se vyvarovali asymetrickm pekryvm, ka a vka budov zapluje vetn gap
            const drawW = struct.w * fullCellSize - GAP_SIZE;
            const drawH = struct.h * fullCellSize - GAP_SIZE;

            ctx.fillRect(structScreenX, structScreenY, drawW, drawH);

            // Ikona
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const typeKey = struct.type.replace('owned_', '');
            let iconChar = STRUCTURE_ICONS[typeKey] || '??';

            ctx.font = `${struct.w * CELL_SIZE * 0.7}px Segoe UI Emoji`;
            ctx.fillText(iconChar, structScreenX + (struct.w * fullCellSize / 2), structScreenY + (struct.h * fullCellSize / 2));

            if (owner) {
                ctx.strokeStyle = owner.borderColor || '#fff';
                ctx.lineWidth = 3 / viewportState.scale;
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
            
            // Culling pro expedice (margin 2 buňky kvůli velikosti mraku)
            if (curX < startX - 2 || curX > endX + 2 || curY < startY - 2 || curY > endY + 2) return;
            
            drawExpedition(ctx, curX, curY, exp.unitsLeft, gameState.players[gameState.myPlayerId].color, isSelected);
            drawDustIndicators(ctx, curX, curY);
        });
    }

    // Ostatn expedice (jen v dohledu)
    Object.keys(gameState.players).forEach(pId => {
        if (pId === gameState.myPlayerId) return;
        const oPlayer = gameState.players[pId];
        if (oPlayer?.activeExpeditions) {
            oPlayer.activeExpeditions.forEach(exp => {
                const curX = exp.startX + (exp.targetX - exp.startX) * exp.progress;
                const curY = exp.startY + (exp.targetY - exp.startY) * exp.progress;

                // Culling pro cizí expedice
                if (curX < startX - 2 || curX > endX + 2 || curY < startY - 2 || curY > endY + 2) return;

                const cY = Math.round(curY);
                const cX = Math.round(curX);

                // Kontrola širšího okolí (cca 5x5)
                let isVisible = false;
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        if (gameState.gameBoard[cY + dy]?.[cX + dx]?.visibleTo.includes(gameState.myPlayerId)) {
                            isVisible = true;
                            break;
                        }
                    }
                    if (isVisible) break;
                }

                if (isVisible) {
                    drawExpedition(ctx, curX, curY, exp.unitsLeft, oPlayer.color, false);
                }
            });
        }
    });

    // 4. VYKRESLENÍ DĚLNÍKŮ (v175)
    drawWorkers(ctx, startX, startY, endX, endY);

    // 5. VÝBĚROVÝ BOX
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

function drawWorkers(ctx, startX, startY, endX, endY) {
    if (!gameState.workers) return;
    const fullCellSize = CELL_SIZE + GAP_SIZE;
    const time = performance.now() / 1000;

    gameState.workers.forEach(w => {
        // v179: Cílový bod pro aktuální úsek cesty
        const targetX = (w.path && w.path.length > 1) ? w.path[1].x : w.startX;
        const targetY = (w.path && w.path.length > 1) ? w.path[1].y : w.startY;

        const curX = w.startX + (targetX - w.startX) * w.progress;
        const curY = w.startY + (targetY - w.startY) * w.progress;

        // Culling pro workery
        if (curX < startX - 1 || curX > endX + 1 || curY < startY - 1 || curY > endY + 1) return;

        const screenX = curX * fullCellSize;
        const screenY = curY * fullCellSize;
        const size = (CELL_SIZE + GAP_SIZE) * C.WORKER_SIZE_RATIO;

        const owner = gameState.players[w.ownerId];
        if (!owner) return;

        // Vykreslit pozadí dělníka (barva hráče)
        ctx.fillStyle = owner.color;
        ctx.fillRect(screenX + (CELL_SIZE - size) / 2, screenY + (CELL_SIZE - size) / 2, size, size);

        // Pulzující efekt (pouze pokud nese náklad)
        if (!w.isReturning) {
            const pulse = 0.5 + 0.5 * Math.sin(time * 10 + w.pulseOffset);
            ctx.fillStyle = w.type === 'gold' ? C.WORKER_PULSE_COLOR_GOLD : C.WORKER_PULSE_COLOR_CRYSTAL;
            ctx.globalAlpha = pulse;
            ctx.fillRect(screenX + (CELL_SIZE - size) / 2, screenY + (CELL_SIZE - size) / 2, size, size);
            ctx.globalAlpha = 1.0;
        }

        // Malý okraj
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5 / viewportState.scale;
        ctx.strokeRect(screenX + (CELL_SIZE - size) / 2, screenY + (CELL_SIZE - size) / 2, size, size);
    });
}

function drawExpedition(ctx, curX, curY, units, color, isSelected) {
    const fullCellSize = CELL_SIZE + GAP_SIZE;
    const time = performance.now() / 400; // Rychlost přelévání
    
    // Objem tekuté formace
    // Min velikost = 1 políčko. Max = klidně neomezeně, ale pro výkon ořezáme.
    const safeUnits = Math.min(200, Math.max(1, units));
    const baseRadius = Math.max(0.5, Math.sqrt(safeUnits / Math.PI));
    const checkRadius = Math.ceil(baseRadius * 1.5) + 1; // Okruh kontroly buněk

    /**
     * Vnitřní funkce pro vykreslení slizu 
     * @param {number} rOffset Zvětšení poloměru (pro bílý outline selekce)
     * @param {string} clr Barva
     */
    const renderBlob = (rOffset, clr) => {
        ctx.fillStyle = clr;
        for (let dy = -checkRadius; dy <= checkRadius; dy++) {
            for (let dx = -checkRadius; dx <= checkRadius; dx++) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Centrální políčko se vždy nakreslí pevně
                if (dist === 0) {
                    ctx.fillRect(
                        Math.round((curX + dx) * fullCellSize), 
                        Math.round((curY + dy) * fullCellSize), 
                        fullCellSize, fullCellSize
                    );
                    continue;
                }

                // Goniometrický šum pro deformaci (Liquid Organic Mouvement)
                const angle = Math.atan2(dy, dx);
                // Komplexní vlna složená ze 3 frekvencí a posunutá časem
                const wave = Math.sin(angle * 3 + time) * 0.15 
                           + Math.cos(angle * 5 - time * 0.8) * 0.1 
                           + Math.sin(angle * 2 + time * 1.5) * 0.05;
                
                const dynamicRadius = (baseRadius + rOffset) * (1 + wave);

                if (dist <= dynamicRadius) {
                    // Pevný block (pixel-art hrana) - Bez gapu (slité v jednu hmotu)
                    ctx.fillRect(
                        Math.round((curX + dx) * fullCellSize), 
                        Math.round((curY + dy) * fullCellSize), 
                        fullCellSize, fullCellSize // kreslíme včetně spárů = jednolitá kapalina
                    );
                }
            }
        }
    };

    // 1. Zvýraznění (Outline)
    if (isSelected) {
        renderBlob(0.4, '#ffffff'); // Nakreslí o něco tlustší bílý blob naspod
    }
    
    // 2. Barva hráče (Tělo liquidu)
    renderBlob(0, color);
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

            const eX = Math.round(ex);
            const eY = Math.round(ey);
            let isVisible = false;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (gameState.gameBoard[eY + dy]?.[eX + dx]?.visibleTo.includes(gameState.myPlayerId)) {
                        isVisible = true;
                        break;
                    }
                }
                if (isVisible) break;
            }

            // Kresli radar jen, dokud expedice nen� zasa�ena m�m rozhledem a je bl�zko
            if (dist < RANGE && !isVisible) {
                const angle = Math.atan2(ey - y, ex - x);
                const radius = 30;
                ctx.beginPath();
                ctx.arc(x * (CELL_SIZE + GAP_SIZE), y * (CELL_SIZE + GAP_SIZE), radius, angle - 0.4, angle + 0.4);
                // Vykresl� prach v barv� nep��tele
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