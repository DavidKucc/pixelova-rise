// js/main.js
console.log('[DEBUG] main.js loaded v=135');

import { initGame } from './modules/game.js?v=135';

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
export const db = getDatabase(app);

export let currentLobbyId = null;
export let playerFirebaseRef = null;
export let isHost = false;
export let isReady = false;

// Funkce pro detekci parametrů v URL při načtení
// Spustit kontrolu URL při startu
document.addEventListener('DOMContentLoaded', () => {
    checkUrlParams();
});

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'online' && params.get('lobby')) {
        currentLobbyId = params.get('lobby');

        // Změna UI hlavního menu pro připojujícího se hráče
        const titleEl = document.querySelector('#main-menu h1');
        if (titleEl) titleEl.textContent = 'Připojuješ se k bitvě!';

        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            startBtn.innerHTML = '🛡️ Vstoupit do Lobby';
            startBtn.style.background = '#1976D2';
        }

        // Pokud klikne na start v tomto módu, rovnou ho to hodí do lobby po vyplnění jména
        console.log("[DEBUG] Detekována pozvánka do lobby:", currentLobbyId);
    }
}
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

    // JSOU JSME HOST? (Pokud v lobby ještě nikdo není)
    onValue(lobbyPlayersRef, (snapshot) => {
        if (!snapshot.exists()) {
            isHost = true;
        }
    }, { onlyOnce: true });

    set(playerFirebaseRef, {
        name: nickname,
        ready: false,
        lastSeen: Date.now()
    });

    // Při odpojení (zavření okna) se automaticky smažeme
    onDisconnect(playerFirebaseRef).remove();

    // Poslouchat změny v lobby a aktualizovat UI
    onValue(lobbyPlayersRef, (snapshot) => {
        const players = snapshot.val();
        updateLobbyUI(players);
    });

    // POSLOUCHAT START HRY (od hostitele nebo synchronizovaně)
    const gameStatusRef = ref(db, `lobbies/${currentLobbyId}/status`);
    onValue(gameStatusRef, (snapshot) => {
        if (snapshot.val() === 'started') {
            startGameLocally();
        }
    });
}

// Tuto funkci volá hráč pro změnu stavu Ready
window.toggleReady = function () {
    if (!playerFirebaseRef) return;
    isReady = !isReady;
    const btn = document.getElementById('ready-btn');
    btn.textContent = isReady ? 'Unready' : 'Ready';
    btn.classList.toggle('ready-active', isReady);

    set(ref(db, `lobbies/${currentLobbyId}/players/${playerFirebaseRef.key}/ready`), isReady);
};

// Tuto funkci volá hostitel kliknutím na "Start" v Lobby
window.hostStartGame = function () {
    if (!currentLobbyId || !isHost) return;

    // Kontrola zda jsou všichni ready (kromě možná hostitele, ten dává start)
    const playersRef = ref(db, `lobbies/${currentLobbyId}/players`);
    onValue(playersRef, (snapshot) => {
        const players = snapshot.val();
        const allReady = Object.values(players).every(p => p.ready);

        if (allReady) {
            const gameStatusRef = ref(db, `lobbies/${currentLobbyId}/status`);
            set(gameStatusRef, 'started');
        } else {
            alert('Všichni hráči musí být Ready před startem!');
        }
    }, { onlyOnce: true });
};

function startGameLocally() {
    console.log("HRA STARTUJE!");
    window.showScreen('game-ui');

    // Malá prodleva pro jistotu, že UI je vykreslené
    setTimeout(() => {
        initGame();
    }, 100);
}

function updateLobbyUI(players) {
    const listEl = document.getElementById('lobby-players-list');
    listEl.innerHTML = '';

    if (!players) return;

    let allReady = true;
    let playerCount = 0;

    Object.keys(players).forEach(key => {
        const p = players[key];
        const isMe = (key === playerFirebaseRef.key);
        if (!p.ready) allReady = false;
        playerCount++;

        const item = document.createElement('div');
        item.className = 'lobby-player-item' + (isMe ? ' current-player' : '');
        item.style.color = p.ready ? '#4caf50' : '#ff9800';

        item.innerHTML = `
            <span class="status-dot ${p.ready ? 'online' : 'away'}"></span> 
            <span>${p.name} ${isMe ? ' (Ty)' : ''}</span>
            <span style="font-size: 0.8em; margin-left: 10px;">${p.ready ? '[READY]' : '[ČEKÁ]'}</span>
        `;
        listEl.appendChild(item);
    });

    // SPRÁVA TLAČÍTKA START
    const startBtn = document.getElementById('start-online-game-btn');
    if (isHost) {
        startBtn.style.display = 'block';
        // Tlačítko start je aktivní jen když jsou všichni Ready (včetně hostitele) a jsou aspoň 2
        startBtn.disabled = !allReady || playerCount < 2;
        startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';
    } else {
        startBtn.style.display = 'none';
    }
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
