// js/modules/state.js
console.log('[DEBUG] state.js loaded v=163');
// Exportuje objekty, které drží veškerý měnitelný stav hry.

export const gameState = {
    // MULTIPLAYER STAV
    isHost: false,
    myPlayerId: 'human',
    currentLobbyId: null,
    players: {},

    // Herní deska zůstává, ale buňky budou mít 'ownerId' místo 'state'
    gameBoard: [],

    // Tyto proměnné jsou skutečně globální pro hru, zůstávají
    structures: new Map(),
    selectedStructureId: null,
    selectedExpeditionIds: [], // Seznam ID vybraných expedic
    selectionBox: { startX: 0, startY: 0, endX: 0, endY: 0, active: false },
    logicIntervals: [],
    needsRedraw: true,
};

export const viewportState = {
    isDragging: false,
    didDrag: false,
    startPos: { x: 0, y: 0 },
    gridPos: { x: 0, y: 0 },
    scale: 1.0,
};