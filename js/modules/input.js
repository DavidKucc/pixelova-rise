// js/modules/input.js
// Zpracování vstupů od uživatele (myš, zoom, kliknutí).
console.log('[INPUT] input.js loaded v=149');

import { ui, updateSliderLabel, logMessage, removeContextMenu } from './ui.js?v=149';
import { viewportState, gameState } from './state.js?v=149';
import * as C from './config.js?v=149';
import { gatherExpeditions, launchExpedition, redirectExpedition, initGame, handleCellClick, captureStructure, showExpeditionMenu, showBuildMenu, showCaptureMenu, splitExpedition } from './game.js?v=149';

// Stav klávesy Q
let isQPressed = false;

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') isQPressed = true;

    // Klávesové zkratky
    if (e.code === 'KeyG') {
        const coords = viewportState.lastMouseGridCoords;
        if (coords) gatherExpeditions('human', coords.x, coords.y);
    }

    if (e.code === 'KeyH') {
        const player = gameState.players['human'];
        if (player) {
            player.activeExpeditions.forEach(exp => {
                if (gameState.selectedExpeditionIds.includes(exp.id)) {
                    exp.isHolding = !exp.isHolding;
                    console.log(`Expedice #${exp.id} holding: ${exp.isHolding}`);
                }
            });
            gameState.needsRedraw = true;
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyQ') isQPressed = false;
});

function onMouseDown(e) {
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === 0) { // Levá myš -> Výběr
        gameState.selectionBox.active = true;
        gameState.selectionBox.startX = mouseX;
        gameState.selectionBox.startY = mouseY;
        gameState.selectionBox.endX = mouseX;
        gameState.selectionBox.endY = mouseY;
        viewportState.didDrag = false;
    } else if (e.button === 2) { // Pravá myš -> Panování
        viewportState.isDragging = true;
        viewportState.didDrag = false;
        viewportState.startPos.x = e.clientX - viewportState.gridPos.x;
        viewportState.startPos.y = e.clientY - viewportState.gridPos.y;
    }
}

function onMouseMove(e) {
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // VŽDY aktualizovat souřadnice pod myší
    viewportState.lastMouseGridCoords = getGridCoordsFromEvent(e);

    if (gameState.selectionBox.active) {
        // Logika pro box select (LMB)
        gameState.selectionBox.endX = mouseX;
        gameState.selectionBox.endY = mouseY;
        if (!viewportState.didDrag && Math.hypot(mouseX - gameState.selectionBox.startX, mouseY - gameState.selectionBox.startY) > 5) {
            viewportState.didDrag = true;
        }
        gameState.needsRedraw = true;
    } else if (viewportState.isDragging) {
        // Logika pro panování (RMB)
        if (!viewportState.didDrag && Math.hypot(e.clientX - (viewportState.startPos.x + viewportState.gridPos.x), e.clientY - (viewportState.startPos.y + viewportState.gridPos.y)) > 5) {
            viewportState.didDrag = true;
            removeContextMenu();
        }
        if (viewportState.didDrag) {
            viewportState.gridPos.x = e.clientX - viewportState.startPos.x;
            viewportState.gridPos.y = e.clientY - viewportState.startPos.y;
            gameState.needsRedraw = true;
        }
    }
}

function onMouseUp(e) {
    // Musíme vědět, které tlačítko se pustilo
    if (e.button === 0 && gameState.selectionBox.active) {
        if (viewportState.didDrag) {
            performBoxSelection();
        } else {
            onGridClick(e);
        }
        gameState.selectionBox.active = false;
    } else if (e.button === 2) {
        viewportState.isDragging = false;
    }

    // Pojistka pro případ, že se ztratí focus nebo dojde k chybě
    if (e.buttons === 0) {
        gameState.selectionBox.active = false;
        viewportState.isDragging = false;
    }

    gameState.needsRedraw = true;
}

function performBoxSelection() {
    const box = gameState.selectionBox;
    const x1 = Math.min(box.startX, box.endX);
    const y1 = Math.min(box.startY, box.endY);
    const x2 = Math.max(box.startX, box.endX);
    const y2 = Math.max(box.startY, box.endY);

    const selectedIds = [];
    const player = gameState.players['human'];
    if (!player) return;

    player.activeExpeditions.forEach(exp => {
        // Převod herních souřadnic expedice na obrazovkové
        const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
        const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

        const screenX = curX * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.x;
        const screenY = curY * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.y;

        // Hitbox: Expedice je vybrána, pokud se její mrak (cca 2 buňky poloměr) dotýká boxu
        const margin = 2 * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale;

        if (screenX + margin >= x1 && screenX - margin <= x2 &&
            screenY + margin >= y1 && screenY - margin <= y2) {
            selectedIds.push(exp.id);
        }
    });

    gameState.selectedExpeditionIds = selectedIds;
    if (selectedIds.length > 0) {
        gameState.selectedStructureId = null; // Zrušit výběr budovy při výběru armády
    }
    console.log(`[INPUT] Vybráno ${selectedIds.length} expedic.`);
}

function onWheel(e) {
    e.preventDefault();

    // Pokud drží Q, měníme velikost expedice
    if (isQPressed) {
        let currentValue = parseInt(ui.slider.value, 10);
        const delta = e.deltaY > 0 ? -5 : 5; // Kolečko dolů = méně, nahoru = více
        currentValue = Math.max(1, Math.min(100, currentValue + delta));
        ui.slider.value = currentValue;
        updateSliderLabel(); // Aktualizace textu
        return;
    }

    // Jinak klasický zoom
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const oldScale = viewportState.scale;

    let scaleChange = e.deltaY * -0.001;
    viewportState.scale += scaleChange * viewportState.scale;
    viewportState.scale = Math.max(C.MIN_SCALE, Math.min(C.MAX_SCALE, viewportState.scale));

    viewportState.gridPos.x = mouseX - (mouseX - viewportState.gridPos.x) * (viewportState.scale / oldScale);
    viewportState.gridPos.y = mouseY - (mouseY - viewportState.gridPos.y) * (viewportState.scale / oldScale);
    gameState.needsRedraw = true;
}

function getGridCoordsFromEvent(e) {
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const gridX = Math.floor((mouseX - viewportState.gridPos.x) / (viewportState.scale * (C.CELL_SIZE + C.GAP_SIZE)));
    const gridY = Math.floor((mouseY - viewportState.gridPos.y) / (viewportState.scale * (C.CELL_SIZE + C.GAP_SIZE)));
    if (gridX < 0 || gridX >= C.GRID_SIZE || gridY < 0 || gridY >= C.GRID_SIZE) return null;
    return { x: gridX, y: gridY };
}

function onGridClick(e) {
    if (viewportState.didDrag) return;
    const coords = getGridCoordsFromEvent(e);
    if (coords && gameState.gameBoard[coords.y]) handleCellClick(gameState.gameBoard[coords.y][coords.x]);
}

function onDoubleClick(e) {
    const coords = getGridCoordsFromEvent(e);
    if (!coords || !gameState.gameBoard[coords.y]) return;

    const cell = gameState.gameBoard[coords.y][coords.x];
    const struct = cell.structureId ? gameState.structures.get(cell.structureId) : null;

    // 1. Double click na budovu -> obsadit (pokud je cizí)
    if (cell.visibleTo.includes(gameState.myPlayerId) && struct && struct.ownerId !== gameState.myPlayerId) {
        captureStructure(gameState.myPlayerId, struct.id);
        return;
    }

    // 2. Double click na jednotku -> vybrat VŠECHNY viditelné expedice hráče
    const player = gameState.players['human'];
    if (player && player.activeExpeditions) {
        const rect = ui.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Kontrola, zda je u kurzoru nějaká expedice
        const hit = player.activeExpeditions.some(exp => {
            const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
            const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);
            const screenX = curX * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.x;
            const screenY = curY * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.y;
            const margin = 3 * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale; // Trochu větší tolerance pro dvojklik

            return Math.abs(mouseX - screenX) < margin && Math.abs(mouseY - screenY) < margin;
        });

        if (hit) {
            gameState.selectedExpeditionIds = player.activeExpeditions.map(exp => exp.id);
            gameState.selectedStructureId = null;
            console.log(`[INPUT] Dvojklik na jednotku: Vybrány všechny (${gameState.selectedExpeditionIds.length}) expedice.`);
            gameState.needsRedraw = true;
        }
    }
}

function handleRightClick(e) {
    e.preventDefault();
    if (viewportState.didDrag) return;
    const coords = getGridCoordsFromEvent(e);
    if (!coords) return;

    if (gameState.selectedExpeditionIds.length > 0) {
        // AKCE PRO VYBRANÉ EXPEDICE
        const ids = [...gameState.selectedExpeditionIds];
        if (e.shiftKey) {
            // SHIFT + Right Click = 50% split
            ids.forEach(id => splitExpedition(gameState.myPlayerId, id, coords.x, coords.y, 50));
        } else if (e.ctrlKey) {
            // CTRL + Right Click = 10% split
            ids.forEach(id => splitExpedition(gameState.myPlayerId, id, coords.x, coords.y, 10));
        } else {
            // Jen Right Click = redirect 100%
            ids.forEach(id => redirectExpedition(gameState.myPlayerId, id, coords.x, coords.y));
        }
        gameState.needsRedraw = true;
        return;
    }

    if (!gameState.gameBoard[coords.y]) return;
    const cell = gameState.gameBoard[coords.y][coords.x];
    const struct = cell.structureId ? gameState.structures.get(cell.structureId) : null;

    if (!cell.visibleTo.includes(gameState.myPlayerId)) {
        showExpeditionMenu(gameState.myPlayerId, coords.x, coords.y, e);
    } else {
        if (cell.ownerId === gameState.myPlayerId && cell.structureId === null) {
            showBuildMenu(gameState.myPlayerId, coords.x, coords.y, e);
        } else if (struct && struct.ownerId !== gameState.myPlayerId) {
            showCaptureMenu(gameState.myPlayerId, struct, e);
        } else if (cell.ownerId !== gameState.myPlayerId && cell.ownerId !== null) {
            showExpeditionMenu(gameState.myPlayerId, coords.x, coords.y, e);
        }
    }
}

export function attachEventListeners(initGame) {
    if (ui.canvas.dataset.listenersAttached) return;

    ui.viewport.addEventListener('mouseenter', () => ui.viewport.focus());
    ui.viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    ui.viewport.addEventListener('mouseleave', onMouseUp);
    ui.viewport.addEventListener('wheel', onWheel, { passive: false });
    ui.viewport.addEventListener('click', onGridClick);
    ui.viewport.addEventListener('dblclick', onDoubleClick); // Přidán dvojklik
    ui.viewport.addEventListener('contextmenu', handleRightClick);
    ui.slider.addEventListener('input', updateSliderLabel);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) removeContextMenu();
    });
    ui.resetBtn.addEventListener('click', initGame);
    const buyUnit = (count) => {
        const player = gameState.players[gameState.myPlayerId];
        if (!player) return;

        let purchasable = count;
        if (count === 'max') {
            purchasable = Math.floor(player.gold / C.UNIT_COST);
        }

        // Fix: Ochrana proti NaN
        if (isNaN(purchasable) || purchasable < 0) purchasable = 0;

        // Ochrana pro případ, že hráč nemá na 10, ale klikne na 10 (tlačítko by mělo být disabled, ale pro jistotu)
        if (count !== 'max' && player.gold < purchasable * C.UNIT_COST) return;

        const totalCost = purchasable * C.UNIT_COST;
        if (player.gold >= totalCost && purchasable > 0) {
            player.gold -= totalCost;
            player.units += purchasable;
            updateUI();
        }
    };

    ui.buyUnitBtn1.addEventListener('click', () => buyUnit(1));
    ui.buyUnitBtn10.addEventListener('click', () => buyUnit(10));
    ui.buyUnitBtnMax.addEventListener('click', () => buyUnit('max'));

    const resizeObserver = new ResizeObserver(() => {
        ui.canvas.width = ui.viewport.clientWidth;
        ui.canvas.height = ui.viewport.clientHeight;
        gameState.needsRedraw = true;
    });
    resizeObserver.observe(ui.viewport);

    ui.canvas.width = ui.viewport.clientWidth;
    ui.canvas.height = ui.viewport.clientHeight;

    ui.canvas.dataset.listenersAttached = 'true';
}