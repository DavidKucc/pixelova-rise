import { db } from './firebase-config.js?v=168';
import { ref, set, push, onValue, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { initGame } from './modules/game.js?v=168';
import { attachEventListeners } from './modules/input.js?v=168';

window.attachEventListeners = attachEventListeners;

import { gameState } from './modules/state.js?v=168';

export let playerFirebaseRef = null;

function updatePlayerIdentity() {
    // Již nenastavujeme 'human' / 'enemy'. 
    // myPlayerId se určí podle unikátního Firebase klíče v joinFirebaseLobby, nebo 'local_player' v lokále.
}
export let playerIsReady = false;

// Funkce pro detekci parametrů v URL při načtení
// Spustit kontrolu URL při startu
document.addEventListener('DOMContentLoaded', () => {
    checkUrlParams();
});

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'online' && params.get('lobby')) {
        gameState.currentLobbyId = params.get('lobby');

        // Změna UI hlavního menu pro připojujícího se hráče
        const titleEl = document.querySelector('#main-menu h1');
        if (titleEl) titleEl.textContent = 'Připojuješ se k bitvě!';

        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            startBtn.innerHTML = '🛡️ Vstoupit do Lobby';
            startBtn.style.background = '#1976D2';
        }

        // Pokud klikne na start v tomto módu, rovnou ho to hodí do lobby po vyplnění jména
        console.log("[DEBUG] Detekována pozvánka do lobby:", gameState.currentLobbyId);
    }
}
window.showScreen = function (screenId) {
    document.querySelectorAll('.menu-screen').forEach(s => s.style.display = 'none');
    document.getElementById('game-ui').style.display = 'none'; // pro jistotu vždy skrýt hru

    const target = document.getElementById(screenId);
    if (target) {
        if (screenId === 'game-ui') {
            target.style.display = 'flex'; // nebo formát, jaký používá hra (ve stylech se ukazuje normálně jako flex/block)
        } else {
            target.style.display = 'flex';
        }
    }

    if (screenId === 'lobby-screen') {
        const name = document.getElementById('player-nickname').value.trim();
        document.getElementById('display-nickname').textContent = name;
        document.getElementById('current-player-name').textContent = name;

        // Připojit do Firebase lobby
        joinFirebaseLobby(name);
    }
};

// Pomocná proměnná pro zamezení duplicit v lobby
let lobbyJoined = false;

// Funkce pro připojení do Firebase databáze
function joinFirebaseLobby(nickname) {
    if (lobbyJoined) return;
    lobbyJoined = true;
    const params = new URLSearchParams(window.location.search);
    const paramsReady = !!params.get('lobby');

    if (!gameState.currentLobbyId) {
        // Pokud zakládáme novou hru, vygenerujeme ID
        gameState.currentLobbyId = "lobby_" + Math.random().toString(36).substr(2, 9);
        // Upravit URL v prohlížeči bez reloadu
        const newUrl = window.location.origin + window.location.pathname + `?mode=online&lobby=${gameState.currentLobbyId}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    const lobbyPlayersRef = ref(db, `lobbies/${gameState.currentLobbyId}/players`);

    // Přidat sebe do seznamu
    playerFirebaseRef = push(lobbyPlayersRef);

    // Přiřadit si rovnou svůj vlastní klíč jako ID do hry
    gameState.myPlayerId = playerFirebaseRef.key;
    console.log(`[LOBBY] Moje unikátní ID hráče je: ${gameState.myPlayerId}`);

    // JSME HOST?
    // Pokud jsme ID lobby právě teď vygenerovali (viz řádek výše), jsme hostitel.
    if (!paramsReady) {
        gameState.isHost = true;
        console.log("[LOBBY] Jsi hostitelem této bitvy.");
    }

    onValue(lobbyPlayersRef, (snapshot) => {
        // Fallback: Pokud v lobby ještě nikdo není, jsme první = host
        if (!snapshot.exists()) {
            gameState.isHost = true;
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
    const gameStatusRef = ref(db, `lobbies/${gameState.currentLobbyId}/status`);
    onValue(gameStatusRef, (snapshot) => {
        const val = snapshot.val();

        // Záchrana proti starým událostem:
        // Jestliže se hra tváří jako zapnutá, ale my sami v menu ani nejsme "Ready",
        // znamená to, že se jedná o nečistý `started` status z předešlé opuštěné mapy!
        if (!playerIsReady && val !== 'waiting') {
            console.log("[LOBBY] Ignoruji starý spouštěcí signál, hráč ještě nepotvrdil Ready.");
            return;
        }

        if (typeof val === 'string' && val.startsWith('started_')) {
            gameState.sessionToken = val.split('_')[1];
            startGameLocally();
        } else if (val === 'started') {
            gameState.sessionToken = 'legacy';
            startGameLocally();
        }
    });
}

// Tuto funkci volá hráč pro změnu stavu Ready
window.toggleReady = function () {
    if (!playerFirebaseRef) return;
    playerIsReady = !playerIsReady;
    const btn = document.getElementById('ready-btn');
    btn.textContent = playerIsReady ? 'Unready' : 'Ready';
    btn.classList.toggle('ready-active', playerIsReady);

    set(ref(db, `lobbies/${gameState.currentLobbyId}/players/${playerFirebaseRef.key}/ready`), playerIsReady);
};

// Tuto funkci volá hostitel kliknutím na "Start" v Lobby
window.hostStartGame = function () {
    if (!gameState.currentLobbyId || !gameState.isHost) return;

    // Kontrola zda jsou všichni ready (kromě možná hostitele, ten dává start)
    const playersRef = ref(db, `lobbies/${gameState.currentLobbyId}/players`);
    onValue(playersRef, (snapshot) => {
        const players = snapshot.val();
        const allReady = Object.values(players).every(p => p.ready);

        if (allReady) {
            const gameStatusRef = ref(db, `lobbies/${gameState.currentLobbyId}/status`);
            const sessionToken = Date.now().toString();
            // Updatujeme session token, to odpálí onValue všem hráčům
            set(gameStatusRef, 'started_' + sessionToken);
        } else {
            alert('Všichni hráči musí být Ready před startem!');
        }
    }, { onlyOnce: true });
};

async function startGameLocally() {
    console.log("HRA STARTUJE!");

    window.showScreen('loading-screen');

    // Místo prázdného booleanu potřebujeme seznam hráčů
    let playersData = null;

    if (gameState.currentLobbyId) {
        // ONLINE HRA - Stáhneme si lidi z lobby
        const playersRef = ref(db, `lobbies/${gameState.currentLobbyId}/players`);
        await new Promise((resolve) => {
            const unsub = onValue(playersRef, (snapshot) => {
                if (!snapshot.exists() || !snapshot.val()) {
                    console.log("[LOBBY] Čekám na Firebase sync hráčů (přišel prázdný v první milisekundě)...");
                    return; // Ignorujeme nulák a čekáme dál!
                }

                playersData = snapshot.val();

                // Ujištění, že naše ID je to absolutně nejnovější z Firebase Node
                if (playerFirebaseRef && playerFirebaseRef.key) {
                    gameState.myPlayerId = playerFirebaseRef.key;
                }

                unsub(); // Splněno, odepsat posluchač
                resolve();
            });
        });
    } else {
        // LOKÁLNÍ HRA - Vytvoříme si falešná data pouze se sebou
        const me = 'local_player';
        gameState.myPlayerId = me;
        gameState.isHost = true;
        playersData = {
            [me]: { name: "Lokální Hráč", ready: true }
        };
    }

    // Inicializace hry je nyní asynchronní
    await initGame(gameState.isHost, gameState.myPlayerId, gameState.currentLobbyId, playersData);

    // Vynutit vykreslení ihned, co se ukáže panel
    if (gameState) gameState.needsRedraw = true;
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
    if (startBtn) {
        if (gameState.isHost) {
            startBtn.style.display = 'block';
            // Tlačítko start je aktivní jen když jsou všichni Ready (včetně hostitele) a jsou aspoň 2
            startBtn.disabled = !allReady || playerCount < 2;
            startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';
        } else {
            startBtn.style.display = 'none';
        }
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
        gameState.currentLobbyId = params.get('lobby'); // Uložit ID z linku pro join
        window.showScreen('lobby-screen');
    } else {
        window.showScreen('mode-selection');
    }
});

// Volba Lokální hry
document.getElementById('local-mode-btn').addEventListener('click', () => {
    document.getElementById('mode-selection').style.display = 'none';
    startGameLocally();
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
    console.error(`ERROR v165: ${msg} at ${line}`);
    return false;
};
// --- SYNCHRONIZAČNÍ EXPORTY ---
export function syncExpeditionToFirebase(playerId, exp) {
    if (!gameState.currentLobbyId || !exp) return;
    const expeditionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/expeditions/${playerId}/${exp.id}`);
    set(expeditionsRef, {
        id: exp.id,
        startX: exp.startX,
        startY: exp.startY,
        targetX: exp.targetX,
        targetY: exp.targetY,
        units: exp.unitsLeft,
        timestamp: Date.now()
    });
}

// Záchrana chybějící funkce z v152! Odesílání signálů akcí.
export function syncActionToFirebase(actionData) {
    if (!gameState.currentLobbyId || !actionData) return;
    const actionsRef = ref(db, `lobbies/${gameState.currentLobbyId}/actions`);
    push(actionsRef, actionData);
}
