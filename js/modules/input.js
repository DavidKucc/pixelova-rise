console.log('[INPUT] input.js loaded v=190');

import { ui, updateSliderLabel, logMessage, removeContextMenu } from './ui.js?v=190';
import { viewportState, gameState } from './state.js?v=190';
import * as C from './config.js?v=190';
import { gatherExpeditions, launchExpedition, redirectExpedition, initGame, handleCellClick, captureStructure, showExpeditionMenu, showBuildMenu, showCaptureMenu, splitExpedition, centerCameraOnBase } from './game.js?v=190';
import { updateUI } from './ui.js?v=190';

// Stav klávesy Q
let isQPressed = false;

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') isQPressed = true;

    // Klávesové zkratky
    if (e.code === 'KeyG') {
        const coords = viewportState.lastMouseGridCoords;
        if (coords) gatherExpeditions(gameState.myPlayerId, coords.x, coords.y);
    }

    if (e.code === 'KeyH') {
        const player = gameState.players[gameState.myPlayerId];
        if (player) {
            player.activeExpeditions.forEach(exp => {
                if (gameState.selectedExpeditionIds.includes(exp.id)) {
                    exp.isHolding = !exp.isHolding;
                    console.log(`Expedice #${exp.id} holding: ${exp.isHolding}`);

                    // v184 SYNC: Zastavení se musí poslat do Firebase!
                    if (gameState.currentLobbyId) {
                        import('../main.js?v=190').then(m => m.syncExpeditionToFirebase(gameState.myPlayerId, exp));
                    }
                }
            });
            gameState.needsRedraw = true;
        }
    }

    if (e.code === 'Space') {
        e.preventDefault();
        centerCameraOnBase();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyQ') isQPressed = false;
});

let lastLeftClickTime = 0;
let isPanning = false;

function onMouseDown(e) {
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === 0) { // Levá myš -> Rozhodování mezi Tažením kamery (Pan), Box Selectem a Dvojklikem
        const now = Date.now();
        const isDoubleClick = (now - lastLeftClickTime) < 300;
        lastLeftClickTime = now;

        if (isDoubleClick) {
            const coords = getGridCoordsFromEvent(e);
            const cell = coords ? gameState.gameBoard[coords.y]?.[coords.x] : null;
            const struct = cell?.structureId ? gameState.structures.get(cell.structureId) : null;

            if (struct && struct.ownerId !== gameState.myPlayerId) {
                // LEVÝ DVOJKLIK: Okamžité obsazení/nákup budovy!
                // v178: Doly nesmí jít označit/koupit dvojklikem (jen aktivací blízkostí)
                if (struct.type.includes('mine')) {
                    logMessage("Důl musíš aktivovat přiblížením jednotky!", "warn");
                } else {
                    captureStructure(gameState.myPlayerId, struct.id);
                }
                gameState.selectionBox.active = false;
                isPanning = false;
                viewportState.didDrag = false;
            } else {
                // Dvojklik & držení: Výběrový box (pokud neklikám na nepřátelskou budovu)
                gameState.selectionBox.active = true;
                gameState.selectionBox.startX = mouseX;
                gameState.selectionBox.startY = mouseY;
                gameState.selectionBox.endX = mouseX;
                gameState.selectionBox.endY = mouseY;
                viewportState.didDrag = false;
            }
        } else {
            // Jeden klik & držení: Pohyb mapou (Pan)
            isPanning = true;
            viewportState.didDrag = false;
            viewportState.startPos.x = e.clientX - viewportState.gridPos.x;
            viewportState.startPos.y = e.clientY - viewportState.gridPos.y;
        }
    }
}

function onMouseMove(e) {
    const rect = ui.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // V�DY aktualizovat sou�adnice pod my��
    viewportState.lastMouseGridCoords = getGridCoordsFromEvent(e);

    if (gameState.selectionBox.active) {
        // Logika pro box select (LMB - DoubleClick Hold)
        gameState.selectionBox.endX = mouseX;
        gameState.selectionBox.endY = mouseY;
        if (!viewportState.didDrag && Math.hypot(mouseX - gameState.selectionBox.startX, mouseY - gameState.selectionBox.startY) > 5) {
            viewportState.didDrag = true;
        }
        gameState.needsRedraw = true;
    } else if (isPanning) {
        // Logika pro panov�n� (LMB Single Hold - Ta�en� kamery)
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
    if (e.button === 0) {
        if (gameState.selectionBox.active) {
            // Ukon�en v�b�rov� box
            if (viewportState.didDrag) {
                performBoxSelection();
            }
            gameState.selectionBox.active = false;
        } else if (isPanning) {
            // Ukon�en pan
            if (!viewportState.didDrag) {
                // Nebylo to ta�en�, tak�e to byl norm�ln� single-click!
                if (!e.shiftKey) {
                    gameState.selectedExpeditionIds = [];
                    gameState.selectedStructureId = null;
                }
                onGridClick(e);
            }
            isPanning = false;
        }
    }

    // Pojistka pro p��pad ztr�ty focusu
    if (e.buttons === 0) {
        gameState.selectionBox.active = false;
        isPanning = false;
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
    const player = gameState.players[gameState.myPlayerId];
    if (!player) return;

    player.activeExpeditions.forEach(exp => {
        // P�evod hern�ch sou�adnic expedice na obrazovkov�
        const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
        const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);

        const screenX = curX * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.x;
        const screenY = curY * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale + viewportState.gridPos.y;

        // Hitbox: Expedice je vybr�na, pokud se jej� mrak (cca 2 bu�ky polom�r) dot�k� boxu
        const margin = 2 * (C.CELL_SIZE + C.GAP_SIZE) * viewportState.scale;

        if (screenX + margin >= x1 && screenX - margin <= x2 &&
            screenY + margin >= y1 && screenY - margin <= y2) {
            selectedIds.push(exp.id);
        }
    });

    gameState.selectedExpeditionIds = selectedIds;
    if (selectedIds.length > 0) {
        gameState.selectedStructureId = null; // Zru�it v�b�r budovy p�i v�b�ru arm�dy
    }
    console.log(`[INPUT] Vybr�no ${selectedIds.length} expedic.`);
}

function onWheel(e) {
    e.preventDefault();

    // Pokud dr�� Q, m�n�me velikost expedice
    if (isQPressed) {
        let currentValue = parseInt(ui.slider.value, 10);
        const delta = e.deltaY > 0 ? -5 : 5; // Kole�ko dol� = m�n�, nahoru = v�ce
        currentValue = Math.max(1, Math.min(100, currentValue + delta));
        ui.slider.value = currentValue;
        updateSliderLabel(); // Aktualizace textu
        return;
    }

    // Jinak klasick� zoom
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
    if (!coords || !gameState.gameBoard[coords.y]) return;

    const cell = gameState.gameBoard[coords.y][coords.x];
    const player = gameState.players[gameState.myPlayerId];
    if (!player) return;

    // Klik na vlastn� objevenou expedici vybere jen tu jednu (p��padn� p�id� s shiftem)
    const hitExp = player.activeExpeditions.find(exp => {
        const curX = Math.round(exp.startX + (exp.targetX - exp.startX) * exp.progress);
        const curY = Math.round(exp.startY + (exp.targetY - exp.startY) * exp.progress);
        const margin = 2;
        return Math.abs(coords.x - curX) <= margin && Math.abs(coords.y - curY) <= margin;
    });

    if (hitExp) {
        gameState.selectedExpeditionIds = [hitExp.id];
        gameState.selectedStructureId = null;
        gameState.needsRedraw = true;
        return;
    }

    handleCellClick(cell);
}

// Odstran�n� nativn�ho dvojkliku z canvasu (byl p�esunut na 2x prav� a 2x lev�)
ui.viewport.addEventListener('click', (e) => {
    // O�et�eno z onMouseUp (norm�ln� klik), nen� pot�eba nativn� listener 
});

function handleRightClick(e) {
    e.preventDefault();
    if (viewportState.didDrag) return;
    const coords = getGridCoordsFromEvent(e);
    if (!coords) return;
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
        } else {
            // v184: Pokud kliknu na PRÁZNÉ OBJEVENÉ pole (neutrální), nabídnu vyslání expedice
            showExpeditionMenu(gameState.myPlayerId, coords.x, coords.y, e);
        }
    }
}

function handleRightDoubleClick(e) {
    e.preventDefault();
    const coords = getGridCoordsFromEvent(e);
    if (!coords) return;

    if (gameState.selectedExpeditionIds.length > 0) {
        // AKCE PRO VYBRAN� EXPEDICE - POVEL K POCHODU (PRAV� DVOJKLIK)
        removeContextMenu();
        const ids = [...gameState.selectedExpeditionIds];
        if (e.shiftKey) {
            // SHIFT + Right Double Click = 50% split
            ids.forEach(id => splitExpedition(gameState.myPlayerId, id, coords.x, coords.y, 50));
        } else if (e.ctrlKey) {
            // CTRL + Right Double Click = 10% split
            ids.forEach(id => splitExpedition(gameState.myPlayerId, id, coords.x, coords.y, 10));
        } else {
            // Jen Right Double Click = redirect 100%
            ids.forEach(id => redirectExpedition(gameState.myPlayerId, id, coords.x, coords.y));
        }
        gameState.needsRedraw = true;
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
    ui.viewport.addEventListener('contextmenu', handleRightClick);

    // Glob�ln� pojistka proti probubl�n� kontextov�ho menu z mousedown event�
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('#game-viewport') || e.target.closest('#game-canvas')) {
            e.preventDefault();
        }
    });

    // Vlastn� logika pro odchycen� prav�ho dvojkliku, kter� prohl�e� nativn� moc dob�e nepodporuje
    let rightClickTimeout = null;
    let rightClickCount = 0;

    ui.viewport.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            e.preventDefault(); // Zabra�uje v�choz�mu chov�n� pro jistotu
            rightClickCount++;
            if (rightClickCount === 1) {
                // Prvn� klik se zpracuje nativn� p�es contextmenu event, ale nastav�me si timeout na dvojklik
                rightClickTimeout = setTimeout(() => {
                    rightClickCount = 0;
                }, 250); // 250ms rozestup na RTS dvojklik
            } else if (rightClickCount === 2) {
                // Druh� klik v �asov�m limitu!
                clearTimeout(rightClickTimeout);
                rightClickCount = 0;
                removeContextMenu(); // Uklid�me dialog z prvn�ho kliku!
                handleRightDoubleClick(e);
            }
        }
    });

    ui.slider.addEventListener('input', updateSliderLabel);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) removeContextMenu();
    });
    ui.resetBtn.addEventListener('click', () => {
        if (confirm('Opravdu chcete hru ukon�it a vr�tit se do hlavn� nab�dky?')) {
            window.location.reload();
        }
    });
    const buyUnit = (count) => {
        const player = gameState.players[gameState.myPlayerId];
        if (!player) return;

        let purchasable = count;
        if (count === 'max') {
            purchasable = Math.floor(player.gold / C.UNIT_COST);
        }

        // Fix: Ochrana proti NaN
        if (isNaN(purchasable) || purchasable < 0) purchasable = 0;

        // Ochrana pro p��pad, �e hr�� nem� na 10, ale klikne na 10 (tla��tko by m�lo b�t disabled, ale pro jistotu)
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