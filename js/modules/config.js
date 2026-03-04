// js/modules/config.js v=163
// Všechny neměnné hodnoty, konstanty a statická data hry.

export const GRID_SIZE = 400, INITIAL_GOLD = 500, INITIAL_UNITS = 20, INITIAL_CRYSTALS = 0;
export const UNIT_COST = 50, BASE_INCOME = 5, NUM_STRUCTURES = 1000, ATTRITION_RATE = 20;
export const EXPANSION_TICK_RATE = 150, PRODUCTION_TICK_RATE = 15000, TERRAIN_DENSITY = 0.1;
export const EXPEDITION_SPEED = 2.0; // Pevná rychlost: 2 buňky za sekundu.
export const CELL_SIZE = 10, GAP_SIZE = 1;
export const UNIT_PIXEL_SIZE = 10; // Přesně velikost buňky CELL_SIZE
export const UNIT_SPREAD = 20;     // Rozptyl pro "mrak" efekt

export const MIN_SCALE = 0.2, MAX_SCALE = 2.5;

// === MULTIPLAYER N-HRÁČŮ KLÍČE ===
export const MAX_PLAYERS = 4;

export const BASE_POSITIONS = [
    { x: 50, y: 50 },                               // Hráč 1: Levý Horní
    { x: Math.round(GRID_SIZE - 50), y: Math.round(GRID_SIZE - 50) }, // Hráč 2: Pravý Dolní
    { x: Math.round(GRID_SIZE - 50), y: 50 },       // Hráč 3: Pravý Horní
    { x: 50, y: Math.round(GRID_SIZE - 50) }        // Hráč 4: Levý Dolní
];

export const PLAYER_COLORS = [
    { name: "Hráč 1", color: '#03A9F4', baseColor: '#29B6F6', borderColor: '#81D4FA' }, // Modrá
    { name: "Hráč 2", color: '#b71c1c', baseColor: '#d32f2f', borderColor: '#ef5350' }, // Červená
    { name: "Hráč 3", color: '#8e24aa', baseColor: '#ab47bc', borderColor: '#ce93d8' }, // Fialová
    { name: "Hráč 4", color: '#fbc02d', baseColor: '#fdd835', borderColor: '#fff59d' }  // Žlutá
];

export const BUILDINGS = {
    base: { name: "Hlavní Základna", cost: { gold: 0 }, size: 2, income: 10 },
    village: { name: "Vesnice", cost: { gold: 100 }, size: 1, income: 2, unit_bonus: 5 },
    mine: { name: "Důl na Zlato", cost: { gold: 200 }, size: 1, income: 15 },
    crystal_mine: { name: "Krystalový Důl", cost: { gold: 300 }, size: 1, income: 0 },
    ancient_library: { name: "Prastará Knihovna", cost: { gold: 0 }, size: 1, reveal_radius: 15 },
    trading_post: { name: 'Tržiště', cost: { gold: 150 }, size: 3 },
    barracks: { name: "Kasárny", cost: { gold: 150, crystals: 5 }, size: 3, upkeep: { gold: 2 } },
    watchtower: { name: "Strážní věž", cost: { gold: 100, crystals: 0 }, size: 2, effect: { attrition_reduction: 0.5, radius: 10 } }
};

// --- DĚLNÍCI (WORKERS) KONFIGURACE ---
export const WORKER_SPEED = 2.0; // Rychlost dělníků (buňky za sekundu)
export const WORKER_SIZE_RATIO = 0.5; // Velikost dělníka (násobek CELL_SIZE)
export const WORKER_PULSE_SPEED = 0.15; // Rychlost pulzování barvy
export const WORKER_PROXIMITY_RADIUS = 2.5; // Vzdálenost pro aktivaci dolu (v buňkách)
export const WORKER_PULSE_COLOR_GOLD = 'rgba(255, 215, 0, 0.8)'; // Žlutá pro zlato
export const WORKER_PULSE_COLOR_CRYSTAL = 'rgba(0, 191, 255, 0.8)'; // Modrá pro krystaly

export const CELL_COLORS = {
    'hidden': '#111',
    'none': '#3d9440',
    'expanding': '#336e35',
    'owned-land': '#3d9440',
    'owned_base': '#5aab5d', 'owned_village': '#5aab5d', 'owned_mine': '#5aab5d', 'owned_crystal_mine': '#5aab5d',
    'owned_ancient_library': '#5aab5d', 'owned_trading_post': '#5aab5d', 'owned_barracks': '#5aab5d', 'owned_watchtower': '#5aab5d',
    'visible_mine': '#795548',
    'visible_village': '#03A9F4',
    'visible_crystal_mine': '#4dd0e1',
    'visible_ancient_library': '#673ab7',
    'visible_trading_post': '#ff9800',
    'forest': '#1b5e20',
    'road': '#a1887f'
};

export const STRUCTURE_ICONS = {
    base: '🏡', village: '🏘️', mine: '⛏️', crystal_mine: '💎',
    ancient_library: '📚', trading_post: '⚖️', barracks: '⚔️', watchtower: '👁️'
};