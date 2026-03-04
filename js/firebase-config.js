// js/firebase-config.js
console.log('[DEBUG] firebase-config.js loaded v=174');

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
