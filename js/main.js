// js/main.js
console.log('[DEBUG] main.js loaded v=131');

import { initGame } from './modules/game.js?v=131';

// --- FIREBASE KONFIGURACE (Doplněno od uživatele) ---
const firebaseConfig = {
    apiKey: "AIzaSyC-cetbyAiUhe5pFJS7_byK7r_QfxREhAY",
    authDomain: "pixelova-rise.firebaseapp.com",
    databaseURL: "https://pixelova-rise-default-rtdb.firebaseio.com",
    projectId: "pixelova-rise",
    storageBucket: "pixelova-rise.firebasestorage.app",
    messagingSenderId: "963499485506",
    appId: "1:963499485506:web:a502932dc948df453980db",
    measurementId: "G-L4JGKQ7P6K"
};

// Importy z Firebase SDK (ESM moduly)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentLobbyId = null;
let playerFirebaseRef = null;

// Funkce pro detekci parametrů v URL při načtení
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'online') {
        const titleEl = document.querySelector('#main-menu h1');
        if (titleEl) titleEl.textContent = 'Připojuješ se k bitvě!';
        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) startBtn.textContent = 'Připojit se';

        // Pokud v linku není ID lobby, vytvoříme ho (pro hostitele)
        currentLobbyId = params.get('lobby') || null;
    }
}

// Spustit kontrolu URL
checkUrlParams();

// Globální funkce pro přepínání obrazovek
window.showScreen = function (screenId) {
    document.querySelectorAll('.menu-screen').forEach(s => s.style.display = 'none');
    const target = document.getElementById(screenId);
    if (target) target.style.display = 'flex';

    if (screenId === 'lobby-screen') {
        const name = document.getElementById('player-nickname').value.trim();
        document.getElementById('display-nickname').textContent = name;
        document.getElementById('current-player-name').textContent = name;

        // Připojit do Firebase lobby
        joinFirebaseLobby(name);
    }
};

// Funkce pro připojení do Firebase databáze
function joinFirebaseLobby(nickname) {
    if (!currentLobbyId) {
        // Pokud zakládáme novou hru, vygenerujeme ID
        currentLobbyId = "lobby_" + Math.random().toString(36).substr(2, 9);
        // Upravit URL v prohlížeči bez reloadu
        const newUrl = window.location.origin + window.location.pathname + `?mode=online&lobby=${currentLobbyId}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    const lobbyPlayersRef = ref(db, `lobbies/${currentLobbyId}/players`);

    // Přidat sebe do seznamu
    playerFirebaseRef = push(lobbyPlayersRef);
    set(playerFirebaseRef, {
        name: nickname,
        lastSeen: Date.now()
    });

    // Při odpojení (zavření okna) se automaticky smažeme
    onDisconnect(playerFirebaseRef).remove();

    // Poslouchat změny v lobby a aktualizovat UI
    onValue(lobbyPlayersRef, (snapshot) => {
        const players = snapshot.val();
        updateLobbyUI(players);
    });
}

function updateLobbyUI(players) {
    const listEl = document.getElementById('lobby-players-list');
    listEl.innerHTML = ''; // Vyčistit

    if (!players) return;

    Object.keys(players).forEach(key => {
        const p = players[key];
        const isCurrent = (key === playerFirebaseRef.key);

        const item = document.createElement('div');
        item.className = 'lobby-player-item' + (isCurrent ? ' current-player' : '');
        item.innerHTML = `
            <span class="status-dot online"></span> 
            <span>${p.name}</span>
            ${isCurrent ? ' (Ty)' : ''}
        `;
        listEl.appendChild(item);
    });
}

// Listenery pro hlavní menu
document.getElementById('start-game-btn').addEventListener('click', () => {
    const nickInput = document.getElementById('player-nickname');
    const nickname = nickInput.value.trim();

    if (!nickname) {
        nickInput.classList.add('error');
        setTimeout(() => nickInput.classList.remove('error'), 1000);
        return;
    }

    nickInput.classList.remove('error');
    document.getElementById('display-nickname').textContent = nickname;

    // Pokud jsme přišli přes online link, jdeme rovnou do lobby (pokud nejsme na localhostu)
    const params = new URLSearchParams(window.location.search);
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (params.get('mode') === 'online' && !isLocal) {
        currentLobbyId = params.get('lobby'); // Uložit ID z linku pro join
        window.showScreen('lobby-screen');
    } else {
        window.showScreen('mode-selection');
    }
});

// Volba Lokální hry
document.getElementById('local-mode-btn').addEventListener('click', () => {
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

// Logika pro kopírování odkazu do lobby
document.getElementById('copy-lobby-btn').addEventListener('click', async () => {
    const btn = document.getElementById('copy-lobby-btn');
    // Použijeme aktuální URL, která už obsahuje lobbyID
    const lobbyUrl = window.location.href;

    try {
        await navigator.clipboard.writeText(lobbyUrl);
        const originalText = btn.textContent;
        btn.textContent = '✅ Odkaz zkopírován!';
        btn.classList.add('copied');

        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Selhalo kopírování: ', err);
        alert('Odkaz pro pozvání: ' + lobbyUrl);
    }
});

window.onerror = function (msg, url, line) {
    console.error(`ERROR v131: ${msg} at ${line}`);
    return false;
};
