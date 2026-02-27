// js/modules/ui.js
// Zodpovídá za veškerou interakci s DOM elementy (vše mimo Canvas).

console.log('[DEBUG] ui.js loaded v=145');

import * as C from './config.js?v=145';
import { gameState } from './state.js?v=145';

function getEl(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`[UI] Element s ID "${id}" nebyl nalezen!`);
    return el;
}

export const ui = {
    get viewport() { return getEl('game-viewport'); },
    get gold() { return getEl('gold-display'); },
    get crystals() { return getEl('crystals-display'); },
    get income() { return getEl('income-display'); },
    get units() { return getEl('units-display'); },
    get expeditions() { return getEl('expeditions-display'); },
    get buyUnitBtn1() { return getEl('buy-unit-1'); },
    get buyUnitBtn10() { return getEl('buy-unit-10'); },
    get buyUnitBtnMax() { return getEl('buy-unit-max'); },
    get slider() { return getEl('expedition-slider'); },
    get sliderValue() { return getEl('expedition-slider-value'); },
    get actionPanel() { return getEl('action-panel'); },
    get log() { return getEl('log-container'); },
    get resetBtn() { return getEl('reset-button'); },
    get expeditionList() { return getEl('expedition-list'); },
    get canvas() { return getEl('game-canvas'); },
    get ctx() {
        const c = getEl('game-canvas');
        return c ? c.getContext('2d') : null;
    }
};

export function updateUI() {
    const player = gameState.players[myPlayerId];
    if (!player) return;

    const stats = {
        'gold-display': Math.floor(player.gold),
        'crystals-display': Math.floor(player.crystals),
        'income-display': `${player.income}💰/s`,
        'units-display': player.units,
        'expeditions-display': player.activeExpeditions.length
    };

    for (const [id, val] of Object.entries(stats)) {
        const el = getEl(id);
        if (el) el.textContent = val;
    }

    const b1 = ui.buyUnitBtn1;
    const b10 = ui.buyUnitBtn10;
    const bMax = ui.buyUnitBtnMax;

    if (b1) b1.disabled = player.gold < C.UNIT_COST;
    if (b10) b10.disabled = player.gold < C.UNIT_COST * 10;
    if (bMax) {
        bMax.disabled = player.gold < C.UNIT_COST;
        bMax.textContent = `MAX (${Math.floor(player.gold / C.UNIT_COST)})`;
    }

    updateSliderLabel();
}

export function updateSliderLabel() {
    const player = gameState.players[myPlayerId];
    if (!player) return;
    const slider = ui.slider;
    const sliderVal = ui.sliderValue;
    if (!slider || !sliderVal) return;
    const p = slider.value;
    const u = Math.max(1, Math.ceil(player.units * (p / 100)));
    sliderVal.textContent = `${p}% (${u} ⚔️)`;
}

export function updateExpeditionsPanel() {
    const player = gameState.players[myPlayerId];
    const list = ui.expeditionList;
    if (!list || !player) return;
    list.innerHTML = '';
    if (player.activeExpeditions.length === 0) {
        list.innerHTML = '<p style="text-align:center; font-style:italic; font-size: 0.9em; color: #888;">Žádné aktivní expedice.</p>';
        return;
    }
    player.activeExpeditions.forEach(exp => {
        const item = document.createElement('div');
        item.className = 'expedition-item';
        const progressPercent = exp.progress * 100;
        item.innerHTML = `<span>Expedice #${exp.id} (${exp.unitsLeft}/${exp.initialUnits} ⚔️)</span><div class="expedition-progress-bar"><div class="expedition-progress" style="width: ${progressPercent}%;"></div></div>`;
        list.appendChild(item);
    });
}

export function updateActionPanel() {
    const panel = ui.actionPanel;
    if (!panel) return;
    if (gameState.selectedStructureId === null) {
        panel.innerHTML = `<h3>Akční Panel</h3><p>Klikni na budovu pro info.</p>`;
        return;
    }
    const struct = gameState.structures.get(gameState.selectedStructureId);
    if (!struct) return;
    let html = `<h3>${struct.data.name}</h3>`;
    const isOwned = struct.type.startsWith('owned_');
    const player = gameState.players[myPlayerId];
    if (!isOwned && player) {
        const canAfford = player.gold >= struct.data.cost;
        html += `<button onclick="captureStructure('${myPlayerId}', ${struct.id})" ${!canAfford ? 'disabled' : ''}>Obsadit (${struct.data.cost}💰)</button>`;
    }
    panel.innerHTML = html;
}

export function logMessage(message, type = 'info') {
    const log = ui.log;
    if (!log) return;
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `> ${type === 'win' ? '✅' : 'ℹ️'} ${message}`;
    log.prepend(msgEl);
    if (log.children.length > 50) log.removeChild(log.lastChild);
}

export function createContextMenu(x, y) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    return menu;
}

export function removeContextMenu() {
    document.querySelector('.context-menu')?.remove();
}

window.tradeWithPost = () => {
    const player = gameState.players[gameState.myPlayerId];
    if (player && player.units >= 5) {
        player.units -= 5; player.gold += 200;
        updateUI(); logMessage(`Vyměněno 5⚔️ za 200💰.`, 'win');
    }
};
