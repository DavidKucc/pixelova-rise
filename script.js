// --- KONSTANTY HRY ---
const GRID_SIZE = 400, INITIAL_GOLD = 500, INITIAL_UNITS = 20, INITIAL_CRYSTALS = 0;
const UNIT_COST = 50, BASE_INCOME = 5, NUM_STRUCTURES = 1000, ATTRITION_RATE = 20;
const EXPANSION_TICK_RATE = 150, PRODUCTION_TICK_RATE = 15000, TERRAIN_DENSITY = 0.1;
const EXPANSION_SPREAD_FACTOR = 5; // Jak moc se má expanze "roztékat". Větší číslo = větší rozptyl.
const CELL_SIZE = 10, GAP_SIZE = 1;

// --- UI ELEMENTY ---
const viewportEl = document.getElementById('game-viewport'),
      goldEl = document.getElementById('gold-display'), crystalsEl = document.getElementById('crystals-display'),
      incomeEl = document.getElementById('income-display'), unitsEl = document.getElementById('units-display'),
      expeditionsEl = document.getElementById('expeditions-display'), buyUnitBtn = document.getElementById('buy-unit-button'),
      slider = document.getElementById('expedition-slider'), sliderValueEl = document.getElementById('expedition-slider-value'),
      actionPanelEl = document.getElementById('action-panel'), logEl = document.getElementById('log-container'),
      resetBtn = document.getElementById('reset-button'),
      expeditionListEl = document.getElementById('expedition-list');

// --- CANVAS ELEMENTY ---
const canvasEl = document.getElementById('game-canvas');
const ctx = canvasEl.getContext('2d');

// --- STAV HRY ---
let gold, units, income, crystals, gameBoard, structures, selectedStructureId = null;
let logicIntervals = [], activeExpeditions = [], expeditionCounter = 0, fractionalUnits = 0; // <-- PŘIDÁNO ZDE
let lastFrameTime = 0, needsRedraw = true;

// --- STAV VIEWPORTU (PAN & ZOOM) ---
let isDragging = false, didDrag = false;
let startPos = { x: 0, y: 0 }, gridPos = { x: 0, y: 0 };
let scale = 1.0;
const MIN_SCALE = 0.2, MAX_SCALE = 2.5;

// --- DEFINICE BUDOV ---
const BUILDINGS = { barracks: { name: "Kasárny", cost: { gold: 150, crystals: 5 }, size: 3, upkeep: { gold: 2 } }, watchtower: { name: "Strážní věž", cost: { gold: 100, crystals: 0 }, size: 2, effect: { attrition_reduction: 0.5, radius: 10 } } };
const CELL_COLORS = { 'hidden': '#282828', 'expanding': '#336e35', 'owned-land': '#3d9440', 'owned_base': '#5aab5d', 'owned_village': '#5aab5d', 'owned_mine': '#5aab5d', 'owned_crystal_mine': '#5aab5d', 'owned_ancient_library': '#5aab5d', 'owned_trading_post': '#5aab5d', 'owned_barracks': '#5aab5d', 'owned_watchtower': '#5aab5d', 'visible_mine': '#795548', 'visible_village': '#03A9F4', 'visible_crystal_mine': '#4dd0e1', 'visible_ancient_library': '#673ab7', 'visible_trading_post': '#ff9800', 'terrain-forest': '#1b5e20', 'terrain-road': '#a1887f' };

function initGame() {
    logicIntervals.forEach(clearInterval);
    logEl.innerHTML = ''; removeContextMenu();
    gold = INITIAL_GOLD; units = INITIAL_UNITS; income = BASE_INCOME; crystals = INITIAL_CRYSTALS;
    gameBoard = []; structures = new Map(); selectedStructureId = null;
    activeExpeditions = []; expeditionCounter = 0;
    for (let y = 0; y < GRID_SIZE; y++) { const row = []; for (let x = 0; x < GRID_SIZE; x++) { const cellData = { x, y, state: 'hidden', structureId: null, terrain: 'none' }; if (Math.random() < TERRAIN_DENSITY) cellData.terrain = Math.random() < 0.6 ? 'forest' : 'road'; row.push(cellData); } gameBoard.push(row); }
    const baseSize = 6, baseX = Math.floor(GRID_SIZE / 2 - baseSize / 2), baseY = Math.floor(GRID_SIZE / 2 - baseSize / 2);
    createStructure('owned_base', baseX, baseY, baseSize, baseSize, { name: 'Hlavní stan' });
    for (let i = 0; i < NUM_STRUCTURES; i++) { const rand = Math.random(); if (rand < 0.35) placeRandomStructure('mine', 2, { name: 'Důl', income: 5, cost: 100 }); else if (rand < 0.70) placeRandomStructure('village', 3, { name: 'Vesnice', unit_bonus: 7, cost: 75 }); else if (rand < 0.85) placeRandomStructure('crystal_mine', 2, { name: 'Krystalový důl', income: 1, cost: 300 }); else if (rand < 0.95) placeRandomStructure('ancient_library', 4, { name: 'Prastará knihovna', reveal_radius: 15, cost: 250 }); else placeRandomStructure('trading_post', 3, { name: 'Tržiště', cost: 150 }); }
    scale = 0.5;
    gridPos.x = viewportEl.clientWidth / 2 - (baseX * (CELL_SIZE + GAP_SIZE) * scale); gridPos.y = viewportEl.clientHeight / 2 - (baseY * (CELL_SIZE + GAP_SIZE) * scale);
    if(!canvasEl.dataset.listenersAttached) {
        viewportEl.addEventListener('mouseenter', () => viewportEl.focus()); viewportEl.addEventListener('mousedown', onMouseDown); viewportEl.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); viewportEl.addEventListener('mouseleave', onMouseUp); viewportEl.addEventListener('wheel', onWheel, { passive: false }); viewportEl.addEventListener('click', onGridClick); viewportEl.addEventListener('contextmenu', handleRightClick);
        slider.addEventListener('input', updateSliderLabel); document.addEventListener('click', (e) => { if (!e.target.closest('.context-menu')) removeContextMenu(); }); resetBtn.addEventListener('click', initGame); buyUnitBtn.addEventListener('click', () => { if (gold >= UNIT_COST) { gold -= UNIT_COST; units++; updateUI(); } }); canvasEl.dataset.listenersAttached = 'true';
    }
    logicIntervals.push(setInterval(incomeLoop, 1000));
    logicIntervals.push(setInterval(productionLoop, PRODUCTION_TICK_RATE));
    logicIntervals.push(setInterval(expansionLoop, EXPANSION_TICK_RATE));
    const resizeObserver = new ResizeObserver(() => { canvasEl.width = viewportEl.clientWidth; canvasEl.height = viewportEl.clientHeight; needsRedraw = true; }); resizeObserver.observe(viewportEl);
    canvasEl.width = viewportEl.clientWidth; canvasEl.height = viewportEl.clientHeight;
    updateUI(); updateExpeditionsPanel();
    logMessage('Vítej! Pohybuj mapou levým tlačítkem a zoomuj kolečkem.');
    requestAnimationFrame(gameLoop);
}
function showCaptureMenu(structure, e) {
    const menu = createContextMenu(e.clientX, e.clientY);
    const btn = document.createElement('button');
    const canAfford = gold >= structure.data.cost;
    
    btn.innerHTML = `💰 Obsadit (${structure.data.cost} zlata)`;
    btn.onclick = () => {
        captureStructure(structure.id);
        removeContextMenu();
    };
    if (!canAfford) {
        btn.disabled = true;
        btn.style.cursor = 'not-allowed';
        btn.style.backgroundColor = '#555';
    }
    menu.appendChild(btn);
}
function gameLoop(currentTime) { requestAnimationFrame(gameLoop); if (!needsRedraw) return; draw(); needsRedraw = false; }
function draw() { ctx.save(); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvasEl.width, canvasEl.height); ctx.translate(gridPos.x, gridPos.y); ctx.scale(scale, scale); const fullCellSize = CELL_SIZE + GAP_SIZE; const startX = Math.max(0, Math.floor(-gridPos.x / (fullCellSize * scale))); const endX = Math.min(GRID_SIZE, Math.ceil((-gridPos.x + canvasEl.width) / (fullCellSize * scale))); const startY = Math.max(0, Math.floor(-gridPos.y / (fullCellSize * scale))); const endY = Math.min(GRID_SIZE, Math.ceil((-gridPos.y + canvasEl.height) / (fullCellSize * scale))); for (let y = startY; y < endY; y++) { for (let x = startX; x < endX; x++) { const cell = gameBoard[y][x]; let colorKey = cell.state; if(cell.state === 'owned' || cell.state === 'visible') { if (cell.structureId) colorKey = structures.get(cell.structureId).type; else if (cell.state === 'owned') colorKey = 'owned-land'; } let finalColor = CELL_COLORS[colorKey] || CELL_COLORS['hidden']; if (cell.state !== 'hidden' && cell.terrain === 'road') finalColor = CELL_COLORS['terrain-road']; if (cell.state !== 'hidden' && cell.terrain === 'forest') finalColor = CELL_COLORS['terrain-forest']; ctx.fillStyle = finalColor; ctx.fillRect(x * fullCellSize, y * fullCellSize, CELL_SIZE, CELL_SIZE); } } ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; structures.forEach(struct => { const structScreenX = struct.x * fullCellSize; const structScreenY = struct.y * fullCellSize; if (structScreenX * scale + gridPos.x > canvasEl.width || (structScreenX + struct.w * fullCellSize) * scale + gridPos.x < 0 || structScreenY * scale + gridPos.y > canvasEl.height || (structScreenY + struct.h * fullCellSize) * scale + gridPos.y < 0) return; if (gameBoard[struct.y][struct.x].state !== 'hidden') { const iconMap = { base: '🏡', village: '🏘️', mine: '⛏️', crystal_mine: '💎', ancient_library: '📚', trading_post: '⚖️', barracks: '⚔️', watchtower: '👁️' }; let iconChar = ''; for(const key in iconMap) { if(struct.type.includes(key)) iconChar = iconMap[key]; } if(iconChar) { ctx.font = `${struct.w * CELL_SIZE * 0.8}px Segoe UI Emoji`; ctx.fillText(iconChar, structScreenX + (struct.w * fullCellSize / 2), structScreenY + (struct.h * fullCellSize / 2)); } } if (struct.type.startsWith('owned_')) { ctx.strokeStyle = 'var(--color-player-border)'; ctx.lineWidth = 2 / scale; ctx.strokeRect(structScreenX, structScreenY, struct.w * fullCellSize - GAP_SIZE, struct.h * fullCellSize - GAP_SIZE); } }); ctx.restore(); }
function onMouseDown(e) { if (e.button !== 0) return; isDragging = true; didDrag = false; startPos.x = e.clientX - gridPos.x; startPos.y = e.clientY - gridPos.y; }
function onMouseMove(e) { if (!isDragging) return; if(!didDrag && Math.hypot(e.clientX - (startPos.x + gridPos.x), e.clientY - (startPos.y + gridPos.y)) > 5) { didDrag = true; removeContextMenu(); } if(didDrag) { gridPos.x = e.clientX - startPos.x; gridPos.y = e.clientY - startPos.y; needsRedraw = true; } }
function onMouseUp(e) { isDragging = false; }
function onWheel(e) { e.preventDefault(); const rect = viewportEl.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const oldScale = scale; scale -= e.deltaY * 0.001 * scale; scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)); gridPos.x = mouseX - (mouseX - gridPos.x) * (scale / oldScale); gridPos.y = mouseY - (mouseY - gridPos.y) * (scale / oldScale); needsRedraw = true; }
function getGridCoordsFromEvent(e) { const rect = viewportEl.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const gridX = Math.floor((mouseX - gridPos.x) / (scale * (CELL_SIZE + GAP_SIZE))); const gridY = Math.floor((mouseY - gridPos.y) / (scale * (CELL_SIZE + GAP_SIZE))); if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) return null; return { x: gridX, y: gridY }; }
function onGridClick(e){ if(didDrag) return; const coords = getGridCoordsFromEvent(e); if(coords) handleCellClick(gameBoard[coords.y][coords.x]); }
function handleRightClick(e) {
    e.preventDefault();
    if(didDrag) return;
    const coords = getGridCoordsFromEvent(e);
    if (coords) {
        const cell = gameBoard[coords.y][coords.x];
        const struct = cell.structureId ? structures.get(cell.structureId) : null;

        if (cell.state === 'hidden') {
            showExpeditionMenu(coords.x, coords.y, e);
        } else if (cell.state === 'owned' && cell.structureId === null) {
            showBuildMenu(coords.x, coords.y, e);
        } else if (struct && !struct.type.startsWith('owned_')) {
            // Pokud je na políčku viditelná, ale nevlastněná budova
            showCaptureMenu(struct, e);
        }
    }
}
function showExpeditionMenu(x, y, e) { const menu = createContextMenu(e.clientX, e.clientY); const btn = document.createElement('button'); btn.textContent = '🛰️ Vyslat expedici'; btn.onclick = () => { launchExpedition(x, y); removeContextMenu(); }; menu.appendChild(btn); }
function showBuildMenu(x, y, e) { const menu = createContextMenu(e.clientX, e.clientY); for (const type in BUILDINGS) { const building = BUILDINGS[type]; const btn = document.createElement('button'); btn.innerHTML = `${building.name} (${building.cost.gold}💰 ${building.cost.crystals}💎)`; const canAfford = gold >= building.cost.gold && crystals >= building.cost.crystals; if (!canAfford) btn.disabled = true; btn.onclick = () => { buildStructure(type, x, y); removeContextMenu(); }; menu.appendChild(btn); } }
function incomeLoop() { gold += income; structures.forEach(s => { if(s.upkeep) gold -= s.upkeep.gold; }); updateUI(); }
function productionLoop() {
    let producedUnitsThisTick = 0;
    let newCrystals = 0;
    structures.forEach(s => {
        if (s.type === 'owned_barracks') producedUnitsThisTick += 1.1; // Produkuje o 10% více
        if (s.type === 'owned_crystal_mine') newCrystals += s.data.income;
    });

    fractionalUnits += producedUnitsThisTick; // Přičteme nově vyprodukované jednotky (i s desetinnou částí)
    const wholeNewUnits = Math.floor(fractionalUnits); // Zjistíme, kolik celých jednotek máme
    
    units += wholeNewUnits; // Přidáme celé jednotky k armádě
    crystals += newCrystals;
    
    fractionalUnits -= wholeNewUnits; // Odečteme přidané a zbytek si necháme na příště

    updateUI();
}

// --- PŘEPRACOVANÁ SMYČKA PRO EXPANZI ---
function expansionLoop() {
    if (activeExpeditions.length === 0) return;

    let changesOccurred = false;
    const expeditionsToRemove = new Set();
    
    // Získáme všechna možná pole pro expanzi najednou.
    // TOTO JE NÁŠ SPOLEČNÝ SEZNAM, KTERÝ BUDEME UPRAVOVAT.
    const candidateCells = findExpansionCandidates();

    for (const expedition of activeExpeditions) {
        
        // KLÍČOVÁ ZMĚNA č. 1: Zkontrolujeme a označíme vyčerpané expedice k odstranění hned na začátku.
        // Tím zajistíme, že se vyčerpané expedice nebudou zbytečně snažit expandovat.
        if (expedition.unitsLeft <= 0) {
            if (!expedition.isFinished) {
                logMessage(`Expedice #${expedition.id} se vyčerpala.`, 'lose');
                expedition.isFinished = true;
            }
            expeditionsToRemove.add(expedition.id);
            continue; // Pokračujeme na další expedici
        }
        
        // Pokud globálně není kam expandovat, expedice čeká.
        if (candidateCells.size === 0) {
            continue;
        }

        const scoredCandidates = [...candidateCells].map(cell => {
            let score = 0;
            const distanceToTarget = Math.hypot(cell.x - expedition.targetX, cell.y - expedition.targetY);
            score += (GRID_SIZE - distanceToTarget) * 5; 
            const ownedNeighbors = getNeighbors(cell.x, cell.y).filter(n => n.state === 'owned').length;
            score += ownedNeighbors * 150;
            if (cell.terrain === 'road') score += 200;
            if (cell.terrain === 'forest') score -= 300;
            score += Math.random() * 50;
            return { cell, score };
        });

        scoredCandidates.sort((a, b) => b.score - a.score);

        const cellsToExpandCount = Math.max(1, Math.floor(expedition.unitsLeft / 15));
        const cellsToProcess = scoredCandidates.slice(0, cellsToExpandCount);

        if (cellsToProcess.length === 0) continue;

        for (const { cell } of cellsToProcess) {
            if (expedition.unitsLeft <= 0) break;
            
            // Tento check je teď ještě důležitější
            if (cell.state !== 'hidden') continue;

            cell.state = 'owned';
            changesOccurred = true;

            // KLÍČOVÁ ZMĚNA č. 2: Jakmile políčko obsadíme, OKAMŽITĚ ho odstraníme
            // ze společného seznamu. Ostatní expedice ho už v tomto cyklu neuvidí.
            candidateCells.delete(cell); 

            if (cell.structureId !== null) {
                handleDiscovery(cell, expedition);
            }

            // Výpočet opotřebení (zůstává stejný)
            let attritionModifier = 1.0;
            if (cell.terrain === 'forest') attritionModifier = 2.0;
            if (cell.terrain === 'road') attritionModifier = 0.5;
            structures.forEach(s => { if (s.type === 'owned_watchtower' && Math.hypot(cell.x - s.x, cell.y - s.y) <= s.data.effect.radius) { attritionModifier *= s.data.effect.attrition_reduction; } });
            
            expedition.attritionCounter -= (1 / (attritionModifier || 0.1));
            if (expedition.attritionCounter <= 0) {
                expedition.unitsLeft--;
                expedition.attritionCounter = ATTRITION_RATE;
            }
        }
    }

    // Odstraníme všechny označené expedice
    if (expeditionsToRemove.size > 0) {
        activeExpeditions = activeExpeditions.filter(exp => !expeditionsToRemove.has(exp.id));
        changesOccurred = true;
    }

    if (changesOccurred) {
        updateUI();
        updateExpeditionsPanel();
        needsRedraw = true;
    }
}

function launchExpedition(targetX, targetY) { const unitsToSend = Math.max(1, Math.ceil(units * (slider.value / 100))); if (units < unitsToSend) { logMessage(`Nedostatek jednotek!`, 'lose'); return; } units -= unitsToSend; expeditionCounter++; const newExpedition = { id: expeditionCounter, targetX, targetY, initialUnits: unitsToSend, unitsLeft: unitsToSend, attritionCounter: ATTRITION_RATE, isFinished: false }; activeExpeditions.push(newExpedition); logMessage(`Vyslána expedice #${newExpedition.id} s ${unitsToSend} jednotkami.`); updateUI(); updateExpeditionsPanel(); }
function buildStructure(type, x, y) { const building = BUILDINGS[type]; if (gold < building.cost.gold || crystals < building.cost.crystals) { logMessage(`Nedostatek surovin na ${building.name}!`, 'lose'); return; } if (!isAreaClear(x, y, building.size, building.size)) { logMessage(`Zde nelze stavět, místo je obsazené.`, 'lose'); return; } gold -= building.cost.gold; crystals -= building.cost.crystals; createStructure(`owned_${type}`, x, y, building.size, building.size, building); logMessage(`Postaveno: ${building.name}.`, 'win'); updateUI(); }
function handleDiscovery(discoveredCell, expedition) { logMessage(`Expedice #${expedition.id} objevila ${structures.get(discoveredCell.structureId).data.name}.`); revealStructure(structures.get(discoveredCell.structureId)); }
window.captureStructure = (id) => { const struct = structures.get(id); if (gold < struct.data.cost) { logMessage(`Nemáš dostatek zlata na obsazení!`, 'lose'); return; } gold -= struct.data.cost; const oldType = struct.type; if (!oldType.startsWith('owned_')) { struct.type = `owned_${oldType}`; } if (oldType === 'mine') income += struct.data.income; else if (oldType === 'village') units += struct.data.unit_bonus; else if (oldType === 'ancient_library') revealArea(struct.x + Math.floor(struct.w/2), struct.y + Math.floor(struct.h/2), struct.data.reveal_radius); for (let i = struct.y; i < struct.y + struct.h; i++) { for (let j = struct.x; j < struct.x + struct.w; j++) { if (gameBoard[i]?.[j]) { gameBoard[i][j].state = 'owned'; } } } logMessage(`Získal jsi kontrolu nad ${struct.data.name}!`, 'win'); needsRedraw = true; updateUI(); updateActionPanel(); };

function updateUI() { goldEl.textContent = Math.floor(gold); crystalsEl.textContent = Math.floor(crystals); incomeEl.textContent = `${income}💰/s`; unitsEl.textContent = units; expeditionsEl.textContent = activeExpeditions.length; buyUnitBtn.disabled = gold < UNIT_COST; updateSliderLabel(); }
function updateExpeditionsPanel() {
    expeditionListEl.innerHTML = '';
    if (activeExpeditions.length === 0) { expeditionListEl.innerHTML = '<p style="text-align:center; font-style:italic; font-size: 0.9em; color: #888;">Žádné aktivní expedice.</p>'; return; }
    activeExpeditions.forEach(exp => { const item = document.createElement('div'); item.className = 'expedition-item'; const progressPercent = (exp.unitsLeft / exp.initialUnits) * 100; item.innerHTML = `<span>Expedice #${exp.id} (${exp.unitsLeft}/${exp.initialUnits} ⚔️)</span><div class="expedition-progress-bar"><div class="expedition-progress" style="width: ${progressPercent}%;"></div></div>`; expeditionListEl.appendChild(item); });
}
function updateSliderLabel() { const p = slider.value; const u = Math.max(1, Math.ceil(units * (p/100))); sliderValueEl.textContent = `${p}% (${u} ⚔️)`; }
function createStructure(type, x, y, w, h, data) { const id = structures.size + Date.now(); const newStructure = { id, type, x, y, w, h, data, upkeep: data.upkeep || null }; structures.set(id, newStructure); for (let i = y; i < y + h; i++) { for (let j = x; j < x + w; j++) { if (gameBoard[i]?.[j]) gameBoard[i][j].structureId = id; } } if (type.startsWith('owned_')) { for (let i = y; i < y + h; i++) { for (let j = x; j < x + w; j++) { if(gameBoard[i]?.[j]) gameBoard[i][j].state = 'owned'; } } } needsRedraw = true; }
function revealArea(cx, cy, radius) { for (let y = 0; y < GRID_SIZE; y++) { for (let x = 0; x < GRID_SIZE; x++) { if (Math.hypot(x - cx, y - cy) <= radius) { const cell = gameBoard[y][x]; if (cell.state === 'hidden') { cell.state = 'owned'; if (cell.structureId) revealStructure(structures.get(cell.structureId)); } } } } needsRedraw = true; }
function handleCellClick(cellData) { removeContextMenu(); if (cellData.structureId !== null && cellData.state !== 'hidden') { selectedStructureId = cellData.structureId; updateActionPanel(); } else { selectedStructureId = null; actionPanelEl.innerHTML = `<h3>Akční Panel</h3><p>Klikni na budovu/země pro akce.</p>`; } }
function updateActionPanel() { if (selectedStructureId === null) { actionPanelEl.innerHTML = `<h3>Akční Panel</h3><p>Klikni na budovu pro info.</p>`; return; } const struct = structures.get(selectedStructureId); let html = `<h3>${struct.data.name}</h3>`; let type = struct.type.replace('owned_', ''); const isOwned = struct.type.startsWith('owned_'); let btn = ''; if(!isOwned) btn = `<button onclick="captureStructure(${struct.id})" ${gold < struct.data.cost ? 'disabled' : ''}>Obsadit</button>`; switch(type) { case 'base': html += `<p>Centrum tvé říše.</p>`; break; case 'village': html += isOwned ? `<p>Tato vesnice ti poskytla ${struct.data.unit_bonus} jednotek.</p>` : `<p>Obsazením za ${struct.data.cost}💰 získáš ${struct.data.unit_bonus} jednotek.</p>${btn}`; break; case 'mine': html += isOwned ? `<p>Produkuje +${struct.data.income}💰/s.</p>` : `<p>Obsazením za ${struct.data.cost}💰 získáš +${struct.data.income}💰/s.</p>${btn}`; break; case 'crystal_mine': html += isOwned ? `<p>Produkuje +${struct.data.income}💎/15s.</p>` : `<p>Obsazením za ${struct.data.cost}💰 získáš +${struct.data.income}💎/15s.</p>${btn}`; break; case 'ancient_library': html += isOwned ? `<p>Tato knihovna ti odhalila část mapy.</p>` : `<p>Obsazením za ${struct.data.cost}💰 odhalíš okolí.</p>${btn}`; break; case 'trading_post': html += `<p>Vyměň 5 jednotek za 200💰.</p><button onclick="if(units>=5){units-=5; gold+=200; updateUI(); logMessage('Vyměněno 5⚔️ za 200💰.','win');}">Směnit</button>`; break; case 'barracks': html += `<p>Produkuje 1⚔️/15s. Údržba: ${struct.data.upkeep.gold}💰/s.</p>`; break; case 'watchtower': html += `<p>Snižuje opotřebení expedic v dosahu ${struct.data.effect.radius} polí.</p>`; break; default: html += `<p>Neznámá struktura.</p>`; break; } actionPanelEl.innerHTML = html; }
function logMessage(message, type = 'info') { const msgEl = document.createElement('div'); let icon = 'ℹ️'; if (type === 'win') icon = '✅'; if (type === 'lose') icon = '❌'; msgEl.textContent = `> ${icon} ${message}`; logEl.prepend(msgEl); }
function removeContextMenu() { document.querySelector('.context-menu')?.remove(); }
function createContextMenu(x, y) { removeContextMenu(); const menu = document.createElement('div'); menu.className = 'context-menu'; menu.style.left = `${x}px`; menu.style.top = `${y}px`; document.body.appendChild(menu); return menu; }
function isAreaClear(x, y, w, h) { for (let i = y; i < y + h; i++) { for (let j = x; j < x + w; j++) { if (i >= GRID_SIZE || j >= GRID_SIZE || gameBoard[i]?.[j]?.structureId !== null) return false; } } return true; }
function placeRandomStructure(type, size, data) { let placed = false, attempts=0; while (!placed && attempts < 500) { const x = Math.floor(Math.random() * (GRID_SIZE - size)); const y = Math.floor(Math.random() * (GRID_SIZE - size)); if (isAreaClear(x, y, size, size)) { createStructure(type, x, y, size, size, data); placed = true; } attempts++; } }
function revealStructure(struct) { for (let i = struct.y; i < struct.y + struct.h; i++) { for (let j = struct.x; j < struct.x + struct.w; j++) { if(gameBoard[i]?.[j]?.state === 'hidden') { gameBoard[i][j].state = 'visible'; } } } needsRedraw = true; }
function findExpansionCandidates() { const candidates = new Set(); for(let y=0; y<GRID_SIZE; y++){ for(let x=0; x<GRID_SIZE; x++){ if(gameBoard[y][x].state === 'owned'){ getNeighbors(x,y).forEach(n => { if(n.state === 'hidden') candidates.add(n); }); } } } return candidates; }
function getNeighbors(x,y) { const n = []; for(let dy = -1; dy <= 1; dy++) { for(let dx = -1; dx <= 1; dx++) { if((dx === 0 && dy === 0) || !gameBoard[y+dy]?.[x+dx]) continue; n.push(gameBoard[y+dy][x+dx]); } } return n; }

initGame();