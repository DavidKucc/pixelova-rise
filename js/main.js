// js/main.js
console.log('[DEBUG] main.js loaded v=127');

import { initGame } from './modules/game.js?v=127';

// Globální funkce pro přepínání obrazovek (aby byla dostupná z inline onclick v HTML)
window.showScreen = function (screenId) {
    // Skrýt všechny obrazovky menu
    document.querySelectorAll('.menu-screen').forEach(s => s.style.display = 'none');
    // Zobrazit cílovou
    const target = document.getElementById(screenId);
    if (target) target.style.display = 'flex';
};

// Listenery pro hlavní menu
document.getElementById('start-game-btn').addEventListener('click', () => {
    const nickInput = document.getElementById('player-nickname');
    const nickname = nickInput.value.trim();

    if (!nickname) {
        nickInput.classList.add('error');
        // Po chvilce můžeme zkusit error odebrat, aby uživatel viděl, že to reaguje na každé kliknutí
        setTimeout(() => nickInput.classList.remove('error'), 1000);
        return;
    }

    nickInput.classList.remove('error');
    document.getElementById('display-nickname').textContent = nickname;
    window.showScreen('mode-selection');
});

// Volba Lokální hry
document.getElementById('local-mode-btn').addEventListener('click', () => {
    // Skrýt celé menu a pustit hru
    document.getElementById('mode-selection').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex';
    initGame();
});

// Volba Online hry
document.getElementById('online-mode-btn').addEventListener('click', () => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocal) {
        alert('⚠️ Online mód není v lokální testovací verzi dostupný.\n\nAbys mohl hrát online, musíš hru nahrát na web (třeba GitHub Pages), nebo počkat na dokončení backendu.');
        return;
    }

    window.showScreen('lobby-screen');
});

window.onerror = function (msg, url, line) {
    console.error(`ERROR v127: ${msg} at ${line}`);
    return false;
};
