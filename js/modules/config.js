// js/modules/config.js v=135
// Všechny neměnné hodnoty, konstanty a statická data hry.

export const GRID_SIZE = 400, INITIAL_GOLD = 500, INITIAL_UNITS = 20, INITIAL_CRYSTALS = 0;
export const UNIT_COST = 50, BASE_INCOME = 5, NUM_STRUCTURES = 1000, ATTRITION_RATE = 20;
export const EXPANSION_TICK_RATE = 150, PRODUCTION_TICK_RATE = 15000, TERRAIN_DENSITY = 0.1;
export const EXPEDITION_SPEED = 0.12; // Zvýšeno na 12% cesty za sekundu pro svižnější hru
export const CELL_SIZE = 10, GAP_SIZE = 1;
export const UNIT_PIXEL_SIZE = 10; // Přesně velikost buňky CELL_SIZE
export const UNIT_SPREAD = 20;     // Rozptyl pro "mrak" efekt

export const MIN_SCALE = 0.2, MAX_SCALE = 2.5;

export const BUILDINGS = {
    barracks: { name: "Kasárny", cost: { gold: 150, crystals: 5 }, size: 3, upkeep: { gold: 2 } },
    watchtower: { name: "Strážní věž", cost: { gold: 100, crystals: 0 }, size: 2, effect: { attrition_reduction: 0.5, radius: 10 } }
};

export const CELL_COLORS = {
    'hidden': '#282828',
    'expanding': '#336e35',
    'owned-land': '#3d9440',
    'owned_base': '#5aab5d', 'owned_village': '#5aab5d', 'owned_mine': '#5aab5d', 'owned_crystal_mine': '#5aab5d',
    'owned_ancient_library': '#5aab5d', 'owned_trading_post': '#5aab5d', 'owned_barracks': '#5aab5d', 'owned_watchtower': '#5aab5d',
    'visible_mine': '#795548',
    'visible_village': '#03A9F4',
    'visible_crystal_mine': '#4dd0e1',
    'visible_ancient_library': '#673ab7',
    'visible_trading_post': '#ff9800',
    'terrain-forest': '#1b5e20',
    'terrain-road': '#a1887f'
};

export const STRUCTURE_ICONS = {
    base: '🏡', village: '🏘️', mine: '⛏️', crystal_mine: '💎',
    ancient_library: '📚', trading_post: '⚖️', barracks: '⚔️', watchtower: '👁️'
};