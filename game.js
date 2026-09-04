// ==========================================
// 1. ACCOUNT, SETTINGS & AUTHENTICATION
// ==========================================
let currentUser = localStorage.getItem("saved_username") || null;
let currentAuthMode = "login";

// SERVER-SYNCED ACCOUNT PROGRESSION
let accountStats = {
  accountLevel: 1,
  exp: 0,
  expNeeded: 60
};

// USER SETTINGS (Default configs)
let userSettings = {
  showLevel: true,
  playerOpacity: 1.0,
  showNames: true
};

// Load saved settings from storage
const savedSettings = localStorage.getItem("void_snake_settings");
if (savedSettings) {
  try { userSettings = JSON.parse(savedSettings); } catch(e) {}
}

window.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    proceedToMainMenu(currentUser);
  }
  checkChangelog();
  applySettingsToUI();
});

function showAuthForm(mode) {
  currentAuthMode = mode;
  document.getElementById("auth-choices").style.display = "none";
  document.getElementById("auth-form").style.display = "flex";
  document.getElementById("auth-form-title").innerText = (mode === "login") ? "Log In" : "Sign Up";
  document.getElementById("auth-error").innerText = "";
  document.getElementById("auth-user").value = "";
  document.getElementById("auth-pass").value = "";
  document.getElementById("auth-user").focus();
}

function backToAuthChoices() {
  document.getElementById("auth-form").style.display = "none";
  document.getElementById("auth-choices").style.display = "flex";
  document.getElementById("auth-error").innerText = "";
}

function playAsGuest() {
  currentUser = "Guest_" + Math.floor(Math.random() * 899 + 100);
  proceedToMainMenu(currentUser);
}

function handleAuthSubmit(e) {
  e.preventDefault();
  const user = document.getElementById("auth-user").value.trim();
  const pass = document.getElementById("auth-pass").value.trim();

  if (user.length < 3 || pass.length < 3) {
    document.getElementById("auth-error").innerText = "Must be at least 3 characters.";
    return;
  }

  // Connect briefly to send credentials to Render
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    socket = new WebSocket("wss://hace-hsrp.onrender.com");
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: currentAuthMode.toUpperCase(), username: user, password: pass }));
    };
  } else {
    socket.send(JSON.stringify({ type: currentAuthMode.toUpperCase(), username: user, password: pass }));
  }

  localStorage.setItem("saved_username", user);
  proceedToMainMenu(user);
}

function proceedToMainMenu(username) {
  currentUser = username;
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("main-menu").style.display = "flex";
  document.getElementById("current-username").innerText = username;

  // Reveal Account button only for logged in users (hide for guest)
  const isGuest = username.startsWith("Guest_");
  document.getElementById("account-btn").style.display = isGuest ? "none" : "block";
}

function logout() {
  localStorage.removeItem("saved_username");
  currentUser = null;
  document.getElementById("main-menu").style.display = "none";
  document.getElementById("auth-screen").style.display = "flex";
  document.getElementById("account-btn").style.display = "none";
  backToAuthChoices();
}

// ACCOUNT PROGRESSION MODAL
function openAccountModal() {
  document.getElementById("acc-modal-user").innerText = currentUser;
  document.getElementById("acc-modal-level").innerText = accountStats.accountLevel;
  
  const pct = Math.min(100, Math.floor((accountStats.exp / accountStats.expNeeded) * 100));
  document.getElementById("exp-bar-fill").style.width = pct + "%";
  document.getElementById("exp-bar-text").innerText = `${accountStats.exp} / ${accountStats.expNeeded} EXP (+15 EXP per floor)`;

  document.getElementById("account-modal").style.display = "flex";
}
function closeAccountModal() {
  document.getElementById("account-modal").style.display = "none";
}

// SETTINGS MODAL
function openSettingsModal() {
  applySettingsToUI();
  document.getElementById("settings-modal").style.display = "flex";
}
function closeSettingsModal() {
  saveSettings();
  document.getElementById("settings-modal").style.display = "none";
}
function applySettingsToUI() {
  document.getElementById("set-show-level").checked = userSettings.showLevel;
  document.getElementById("set-show-names").checked = userSettings.showNames;
  document.getElementById("set-opacity-slider").value = Math.floor(userSettings.playerOpacity * 100);
  document.getElementById("set-opacity-val").innerText = Math.floor(userSettings.playerOpacity * 100) + "%";
}
function updateOpacityDisplay() {
  const val = document.getElementById("set-opacity-slider").value;
  document.getElementById("set-opacity-val").innerText = val + "%";
}
function saveSettings() {
  userSettings.showLevel = document.getElementById("set-show-level").checked;
  userSettings.showNames = document.getElementById("set-show-names").checked;
  userSettings.playerOpacity = parseInt(document.getElementById("set-opacity-slider").value, 10) / 100;
  localStorage.setItem("void_snake_settings", JSON.stringify(userSettings));
}

// ==========================================
// 2. CHANGELOG LOADER (CHANGELOG.JSON)
// ==========================================
let cachedChangelog = null;

async function checkChangelog() {
  try {
    const res = await fetch(`changelog.json?t=${Date.now()}`);
    if (res.ok) {
      cachedChangelog = await res.json();
      document.getElementById("version-tag").innerText = cachedChangelog.version || "vA1.0.1";
    }
  } catch (err) {
    console.log("Could not load changelog.json", err);
  }
}

function openChangelog() {
  if (!cachedChangelog) {
    checkChangelog().then(() => renderChangelogUI());
  } else {
    renderChangelogUI();
  }
}

function renderChangelogUI() {
  if (!cachedChangelog) return;
  document.getElementById("changelog-title").innerText = cachedChangelog.title || "Patch Notes";
  document.getElementById("changelog-badge").innerText = cachedChangelog.version || "vA1.0.1";
  document.getElementById("changelog-date").innerText = cachedChangelog.date || "";

  const listEl = document.getElementById("changelog-list");
  listEl.innerHTML = "";
  (cachedChangelog.notes || []).forEach(note => {
    const li = document.createElement("li");
    li.innerText = note;
    listEl.appendChild(li);
  });

  document.getElementById("changelog-modal").style.display = "flex";
}

function closeChangelog() {
  document.getElementById("changelog-modal").style.display = "none";
}

// ==========================================
// 3. CORE GAME ENGINE & MULTIPLAYER
// ==========================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const TILE_SIZE = 34;       
let worldGrid = 24;

let isMultiplayer = false;
let socket = null;
let myPlayerId = null;
let serverPlayers = {};
let isLobbyReady = false;
let isEscaped = false;

let snake = [];
let dir = { x: 0, y: 0 };
let nextDir = { x: 0, y: 0 };
let normalDots = [];
let purpleDots = [];  
let yellowDots = [];
let coolButtons = []; 
let exit = null;
let decayingTiles = new Map();
let phase = "MENU";
let coins = 0;
let level = 1;

let camera = { x: 0, y: 0 };
let consumedDots = new Set();

// UPGRADES INVENTORY
let upgrades = { shoes: 0, dash: 0, bridge: 0, poison: 0, eyes: 0, shield: 0, thermo: 0 };
let currentShields = 0;
let dashCharges = 0;
let dashCooldownTimer = null;
let isBridging = false;
let bridgeStamina = 100;
let bridgeCooldown = 0;
let bridgePlanks = new Set();

let activeCurses = new Set();
let heat = 0;
let decayTimer = null;
let lastTick = 0;

// DRAFT
let draftPhase = "NONE";
let currentDraftChoices = [];
let upgradeRerolls = 3;
let curseRerolls = 2;

// PURPLE KING ACHIEVEMENT
let purpleDotsEatenThisRun = 0;
let isPurpleKingUnlocked = localStorage.getItem("skin_purple_king") === "true";

function getIconHtml(name, alt) {
  const fallbackSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'><rect width='44' height='44' fill='%2322222e'/><text x='22' y='28' font-size='18' text-anchor='middle' fill='%23666'>?</text></svg>";
  return `<img src="Icons/${name}.png" class="item-icon-img" alt="${alt}" onerror="this.onerror=null; this.src='Icons/Placeholder.png'; this.onerror=function(){this.src='${fallbackSvg}';};">`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener("resize", resizeCanvas);

// TOTAL PURGE / RUN RESET
function resetRunState() {
  level = 1;
  coins = 0;
  purpleDotsEatenThisRun = 0;
  upgrades = { shoes: 0, dash: 0, bridge: 0, poison: 0, eyes: 0, shield: 0, thermo: 0 };
  currentShields = 0;
  dashCharges = 0;
  if (dashCooldownTimer) clearInterval(dashCooldownTimer);
  dashCooldownTimer = null;
  isBridging = false;
  bridgeStamina = 100;
  bridgeCooldown = 0;
  bridgePlanks.clear();
  activeCurses.clear();
  heat = 0;
  consumedDots.clear();
  exit = null;

  document.getElementById("heat-bar-wrapper").style.display = "none";
  updatePanels();
  updateUI();
}

// SINGLEPLAYER
function startSingleplayer() {
  isMultiplayer = false;
  isEscaped = false;
  resetRunState();

  document.getElementById("main-menu").style.display = "none";
  document.getElementById("main-layout").style.display = "flex";
  document.getElementById("chat-container").style.display = "none";
  document.getElementById("lobby-screen").style.display = "none";
  document.getElementById("death-screen").style.display = "none";
  document.getElementById("team-wipe-screen").style.display = "none";

  resizeCanvas();
  initLevel();
  requestAnimationFrame(render);
}

// MULTIPLAYER
function startMultiplayer() {
  isMultiplayer = true;
  isLobbyReady = false;
  isEscaped = false;
  resetRunState();

  document.getElementById("main-menu").style.display = "none";
  document.getElementById("main-layout").style.display = "flex";
  document.getElementById("chat-container").style.display = "flex";
  document.getElementById("death-screen").style.display = "none";
  document.getElementById("team-wipe-screen").style.display = "none";
  
  phase = "LOBBY";
  const lobby = document.getElementById("lobby-screen");
  lobby.style.display = "flex";
  document.getElementById("lobby-status").innerText = "Connecting to universal server...";
  document.getElementById("lobby-ready-btn").innerText = "Ready Up";
  document.getElementById("lobby-ready-btn").className = "";

  resizeCanvas();
  requestAnimationFrame(render);

  socket = new WebSocket("wss://hace-hsrp.onrender.com");

  socket.onopen = () => {
    document.getElementById("lobby-status").innerText = "Connected! Click Ready to launch.";
    // If logged in, authenticate connection
    if (currentUser && !currentUser.startsWith("Guest_")) {
      socket.send(JSON.stringify({ type: "LOGIN", username: currentUser, password: "" }));
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "INIT") {
      myPlayerId = data.yourId;
      serverPlayers = data.players || {};
      worldGrid = data.worldGrid || 24;
      level = data.level || 1;
      updateLobbyPlayerList();
    }

    if (data.type === "AUTH_SUCCESS" || data.type === "ACCOUNT_UPDATE") {
      accountStats.accountLevel = data.accountLevel;
      accountStats.exp = data.exp;
      accountStats.expNeeded = data.expNeeded;
    }

    if (data.type === "PLAYER_UPDATE" || data.type === "VOTE_UPDATE") {
      if (data.players) serverPlayers = data.players;
      updateLobbyPlayerList();
    }

    if (data.type === "LEVEL_START") {
      phase = "COLLECT";
      isEscaped = false;
      consumedDots.clear();
      clearInterval(decayTimer);

      exit = null;
      decayingTiles.clear();
      bridgePlanks.clear();
      yellowDots = [];
      coolButtons = [];
      heat = 0;

      document.getElementById("lobby-screen").style.display = "none";
      document.getElementById("overlay-screen").style.display = "none";
      document.getElementById("death-screen").style.display = "none";
      document.getElementById("team-wipe-screen").style.display = "none";

      level = data.level;
      worldGrid = data.worldGrid;
      serverPlayers = data.players;
      normalDots = data.normalDots;
      purpleDots = data.purpleDots || [];

      let me = serverPlayers[myPlayerId];
      if (me && me.snake && me.snake.length > 0) {
        snake = [...me.snake];
        dir = { x: 0, y: 0 };
        nextDir = { x: 0, y: 0 };
        camera.x = snake[0].x * TILE_SIZE;
        camera.y = snake[0].y * TILE_SIZE;
      }

      setBanner(`Level ${level}: Clear red dots!`, "#ff5555");
      updatePanels();
      updateUI();
    }

    if (data.type === "TICK") {
      serverPlayers = data.players;
      if (data.normalDots) {
        normalDots = data.normalDots.filter(d => !consumedDots.has(`${d.x},${d.y}`));
      }
      updateUI();
    }

    if (data.type === "DOT_REMOVED") {
      consumedDots.add(`${data.x},${data.y}`);
      normalDots = normalDots.filter(d => !(d.x === data.x && d.y === data.y));
      updateUI();
    }

    if (data.type === "GREED_START") {
      phase = "GREED";
      exit = data.exit;
      setBanner("EXIT OPEN! ESCAPE OR GREED FOR GOLD!", "#ffd700");
    }

    if (data.type === "PLAYER_ESCAPED") {
      if (data.players) serverPlayers = data.players;
      if (data.id === myPlayerId) {
        setBanner("YOU ESCAPED! Spectating teammates...", "#4CAF50");
      } else {
        setBanner(`${data.name} escaped through the exit!`, "#ffd700");
      }
    }

    if (data.type === "PLAYER_FELL") {
      if (data.players) serverPlayers = data.players;
      if (data.id !== myPlayerId) {
        setBanner(`${data.name} ${data.reason}!`, "#ff4757");
      }
    }

    if (data.type === "INTERMISSION_START") {
      level = data.level;
      document.getElementById("death-screen").style.display = "none";
      triggerIntermission();
    }

    if (data.type === "TEAM_WIPED") {
      phase = "TEAM_WIPED";
      clearInterval(decayTimer);
      document.getElementById("wipe-level").innerText = data.level || level;
      document.getElementById("team-wipe-screen").style.display = "flex";
      document.getElementById("death-screen").style.display = "none";
      document.getElementById("overlay-screen").style.display = "none";
      resetRunState();
    }

    if (data.type === "RETURN_TO_LOBBY") {
      phase = "LOBBY";
      resetRunState();
      document.getElementById("team-wipe-screen").style.display = "none";
      document.getElementById("death-screen").style.display = "none";
      document.getElementById("lobby-screen").style.display = "flex";
      document.getElementById("lobby-ready-btn").innerText = "Ready Up";
      document.getElementById("lobby-ready-btn").className = "";
      serverPlayers = data.players || {};
      updateLobbyPlayerList();
    }

    if (data.type === "KICKED") {
      alert(data.reason || "Kicked for inactivity.");
      location.reload();
    }

    if (data.type === "CHAT") {
      addChatMessage(data.sender, data.text);
    }
  };

  socket.onclose = () => {
    document.getElementById("lobby-status").innerText = "Disconnected from server.";
    setBanner("Server disconnected.", "#ff3333");
  };
}

function updateLobbyPlayerList() {
  const container = document.getElementById("lobby-player-list");
  container.innerHTML = "";

  const playersList = Object.values(serverPlayers);
  playersList.forEach(p => {
    const isMe = p.id === myPlayerId;
    let label = isMe ? `${currentUser || p.name} (You)` : p.name;
    if (userSettings.showLevel && p.accountLevel) label = `[Lv.${p.accountLevel}] ` + label;

    const readyState = p.ready ? 
      `<span class="lobby-ready-tag" style="background:#2ecc71; color:#000;">READY</span>` : 
      `<span class="lobby-ready-tag" style="background:#e74c3c;">WAITING</span>`;

    container.innerHTML += `
      <div class="lobby-player-row">
        <span>${label}</span>
        ${readyState}
      </div>
    `;
  });
}

function sendLobbyReady() {
  if (isMultiplayer && socket && socket.readyState === WebSocket.OPEN) {
    isLobbyReady = !isLobbyReady;
    const btn = document.getElementById("lobby-ready-btn");
    btn.innerText = isLobbyReady ? "Ready! (Waiting...)" : "Ready Up";
    btn.className = isLobbyReady ? "ready" : "";

    socket.send(JSON.stringify({ type: "VOTE_READY" }));
  }
}

// INITIALIZE FLOOR
function initLevel() {
  clearInterval(decayTimer);
  consumedDots.clear();
  isEscaped = false;

  decayingTiles.clear();
  bridgePlanks.clear();
  yellowDots = [];
  purpleDots = [];
  coolButtons = [];
  exit = null;
  heat = 0;

  document.getElementById("overlay-screen").style.display = "none";
  document.getElementById("lobby-screen").style.display = "none";
  document.getElementById("death-screen").style.display = "none";
  document.getElementById("team-wipe-screen").style.display = "none";

  worldGrid = 24 + (level - 1) * 6;
  let mid = Math.floor(worldGrid / 2);
  
  snake = [{ x: mid, y: mid }, { x: mid, y: mid + 1 }];
  dir = { x: 0, y: 0 };
  nextDir = { x: 0, y: 0 };
  camera.x = mid * TILE_SIZE;
  camera.y = mid * TILE_SIZE;

  phase = "COLLECT";

  dashCharges = upgrades.dash;
  currentShields = upgrades.shield;
  bridgeStamina = 100;
  isBridging = false;

  rollCurses();
  setBanner(`Level ${level}: Clear red dots to unlock exit!`, "#ff5555");

  normalDots = [];
  let dotCount = 6 + (level * 3);
  for (let i = 0; i < dotCount; i++) spawnDot(normalDots);

  if (activeCurses.has("nullscape")) {
    let purpleCount = Math.floor(normalDots.length * 0.35);
    for (let i = 0; i < purpleCount; i++) {
      let pDot = normalDots.pop();
      if (pDot) purpleDots.push(pDot);
    }
  }

  if (activeCurses.has("temperature")) {
    spawnDot(coolButtons);
    spawnDot(coolButtons);
  }

  const heatBar = document.getElementById("heat-bar-wrapper");
  if (activeCurses.has("temperature") && upgrades.thermo > 0) {
    heatBar.style.display = "flex";
  } else {
    heatBar.style.display = "none";
  }

  updatePanels();
  updateUI();
}

function rollCurses() {
  if (level >= 3 && !activeCurses.has("temperature")) activeCurses.add("temperature");
  if (level >= 5 && !activeCurses.has("nullscape")) activeCurses.add("nullscape");
  if (level >= 7 && !activeCurses.has("nothing")) activeCurses.add("nothing");
}

function setBanner(text, color) {
  const b = document.getElementById("banner");
  b.innerText = text;
  b.style.color = color || "#fff";
}

function spawnDot(list) {
  let spot = null;
  let tries = 0;
  while (!spot && tries < 500) {
    tries++;
    let rx = Math.floor(Math.random() * (worldGrid - 4)) + 2;
    let ry = Math.floor(Math.random() * (worldGrid - 4)) + 2;
    let key = `${rx},${ry}`;

    let onSnake = snake.some(s => s.x === rx && s.y === ry);
    let onList = list.some(d => d.x === rx && d.y === ry);
    let tile = decayingTiles.get(key);
    let isLethal = tile && tile.stage === 3;

    if (!onSnake && !onList && !isLethal) spot = { x: rx, y: ry };
  }
  if (spot) list.push(spot);
}

function startGreedPhase() {
  phase = "GREED";
  setBanner("EXIT OPEN! ESCAPE OR GREED FOR GOLD!", "#ffd700");

  exit = {
    x: Math.floor(Math.random() * (worldGrid - 4)) + 2,
    y: Math.floor(Math.random() * (worldGrid - 4)) + 2
  };

  let coinCount = 8 + (level * 4);
  for (let i = 0; i < coinCount; i++) spawnDot(yellowDots);

  decayTimer = setInterval(processDecay, 280);
}

function processDecay() {
  for (let [key, tile] of decayingTiles.entries()) {
    if (tile.stage === 1) tile.stage = 2;
    else if (tile.stage === 2) {
      tile.stage = 3;
      let [tx, ty] = key.split(",").map(Number);
      if (snake[0] && snake[0].x === tx && snake[0].y === ty && !isBridging) {
        if (!tryShieldAbsorb(tx, ty)) {
          triggerPlayerDeath("Swallowed by the void!");
        }
      }
    }
  }

  let newCount = 2 + Math.floor(level / 3);
  for (let i = 0; i < newCount; i++) {
    let rx = Math.floor(Math.random() * worldGrid);
    let ry = Math.floor(Math.random() * worldGrid);
    let key = `${rx},${ry}`;
    if (exit && rx === exit.x && ry === exit.y) continue;
    if (decayingTiles.has(key)) continue;
    decayingTiles.set(key, { stage: 1 });
  }
}

function tryShieldAbsorb(x, y) {
  if (currentShields > 0) {
    currentShields--;
    decayingTiles.delete(`${x},${y}`);
    setBanner("SHIELD BROKE! SAVED FROM VOID!", "#00d2d3");
    updateUI();
    updatePanels();
    return true;
  }
  return false;
}

// 3-CARD DRAFT SYSTEM
const ALL_CURSES_POOL = [
  { id: "temperature", name: "Temperature", icon: "temperature", desc: "Hit coolant buttons or burn alive!" },
  { id: "nullscape", name: "Nullscape", icon: "nullscape", desc: "Purple rotten dots are fatal poison!" },
  { id: "nothing", name: "Theory of Nothing", icon: "nothing", desc: "Dash & Void Bridge are heavily nerfed." }
];

const ALL_UPGRADES_POOL = [
  { id: "shoes", name: "Shoes", icon: "shoes", desc: "Increases snake speed.", cost: 30, max: 3 },
  { id: "dash", name: "Dash!", icon: "dash", desc: "Blink forward 3 tiles.", cost: 40, max: 2 },
  { id: "bridge", name: "Bridge", icon: "bridge", desc: "Glide across white void.", cost: 60, max: 1 },
  { id: "poison", name: "Poison Ctr", icon: "poison", desc: "+20% Purple dot resist.", cost: 35, max: 3 },
  { id: "eyes", name: "Eagle Eyes", icon: "eyes", desc: "Radar arrows for coolant.", cost: 45, max: 1 },
  { id: "shield", name: "Shield", icon: "shield", desc: "Blocks 1 fatal void hit.", cost: 50, max: 2 },
  { id: "thermo", name: "Thermometer", icon: "thermo", desc: "Reveals the Heat gauge.", cost: 25, max: 1 }
];

function triggerIntermission() {
  phase = "INTERMISSION";
  clearInterval(decayTimer);

  document.getElementById("overlay-screen").style.display = "flex";
  document.getElementById("vote-section").style.display = "none";
  document.getElementById("draft-cards-container").style.display = "flex";
  document.getElementById("draft-bottom-bar").style.display = "flex";

  upgradeRerolls = 3;
  curseRerolls = 2;

  let unacquiredCurses = ALL_CURSES_POOL.filter(c => !activeCurses.has(c.id));
  let isCurseRound = (level >= 3 && unacquiredCurses.length > 0 && Math.random() < 0.85);

  if (isCurseRound) {
    startCurseDraft();
  } else {
    startUpgradeDraft();
  }
}

function startCurseDraft() {
  draftPhase = "CURSE";
  const logo = document.getElementById("draft-logo");
  logo.src = "Icons/curses.png";
  logo.onerror = () => { logo.src = "Icons/Placeholder.png"; };

  document.getElementById("overlay-subtitle").innerText = "THE VOID DEMANDS A SACRIFICE: Pick 1 Curse";
  updateRerollButtonUI("curse");
  generateCardChoices();
}

function startUpgradeDraft() {
  draftPhase = "UPGRADE";
  const logo = document.getElementById("draft-logo");
  logo.src = "Icons/upgrades.png";
  logo.onerror = () => { logo.src = "Icons/Placeholder.png"; };

  document.getElementById("overlay-subtitle").innerText = "REWARD TIME: Pick 1 Upgrade for your gold";
  updateRerollButtonUI("upgrade");
  generateCardChoices();
}

function updateRerollButtonUI(type) {
  const btn = document.getElementById("reroll-btn");
  const countSpan = document.getElementById("reroll-count");

  if (type === "curse") {
    btn.className = "curse-reroll";
    countSpan.innerText = `${curseRerolls} Left`;
    btn.disabled = (curseRerolls <= 0);
  } else {
    btn.className = "";
    countSpan.innerText = `${upgradeRerolls} Left`;
    btn.disabled = (upgradeRerolls <= 0);
  }
}

function generateCardChoices() {
  let pool = [];
  if (draftPhase === "CURSE") {
    pool = ALL_CURSES_POOL.filter(c => !activeCurses.has(c.id));
  } else {
    pool = ALL_UPGRADES_POOL.filter(u => upgrades[u.id] < u.max);
  }
  let shuffled = [...pool].sort(() => 0.5 - Math.random());
  currentDraftChoices = shuffled.slice(0, 3);
  renderDraftCards();
}

function renderDraftCards() {
  for (let i = 0; i < 3; i++) {
    const cardEl = document.getElementById(`choice-${i + 1}`);
    const item = currentDraftChoices[i];

    if (!item) {
      cardEl.style.visibility = "hidden";
      continue;
    }

    cardEl.style.visibility = "visible";
    cardEl.className = draftPhase === "CURSE" ? "draft-card curse-card" : "draft-card";

    let bottomDetail = "";
    if (draftPhase === "UPGRADE") {
      let canAfford = coins >= item.cost;
      bottomDetail = `<div class="card-cost" style="color: ${canAfford ? '#ffd700' : '#ff4757'};">$${item.cost} (${upgrades[item.id]}/${item.max})</div>`;
    } else {
      bottomDetail = `<div class="card-cost" style="color: #ff4757;">CURSE</div>`;
    }

    cardEl.innerHTML = `
      ${getIconHtml(item.icon, item.name)}
      <h4>${item.name}</h4>
      <p>${item.desc}</p>
      ${bottomDetail}
    `;
  }
}

function selectDraftChoice(index) {
  const item = currentDraftChoices[index];
  if (!item) return;

  if (draftPhase === "CURSE") {
    activeCurses.add(item.id);
    updatePanels();
    startUpgradeDraft();
  } else if (draftPhase === "UPGRADE") {
    if (coins < item.cost) {
      setBanner("Not enough gold to buy this upgrade!", "#ff4757");
      return;
    }

    coins -= item.cost;
    upgrades[item.id]++;
    if (item.id === "shield") currentShields++;
    if (item.id === "thermo" && activeCurses.has("temperature")) {
      document.getElementById("heat-bar-wrapper").style.display = "flex";
    }

    updateUI();
    updatePanels();
    finishDraftToReady();
  }
}

function rerollDraftChoices() {
  if (draftPhase === "CURSE" && curseRerolls > 0) {
    curseRerolls--;
    updateRerollButtonUI("curse");
    generateCardChoices();
  } else if (draftPhase === "UPGRADE" && upgradeRerolls > 0) {
    upgradeRerolls--;
    updateRerollButtonUI("upgrade");
    generateCardChoices();
  }
}

function skipDraft() {
  if (draftPhase === "CURSE") {
    startUpgradeDraft();
  } else {
    finishDraftToReady();
  }
}

function finishDraftToReady() {
  draftPhase = "READY";
  document.getElementById("draft-cards-container").style.display = "none";
  document.getElementById("draft-bottom-bar").style.display = "none";
  document.getElementById("overlay-subtitle").innerText = "All set! Ready up to launch next level";
  document.getElementById("vote-section").style.display = "flex";

  const btn = document.getElementById("ready-btn");
  btn.innerText = "Ready Up";
  btn.className = "";
}

function toggleReadyVote() {
  if (isMultiplayer && socket) {
    socket.send(JSON.stringify({ type: "VOTE_READY" }));
    const btn = document.getElementById("ready-btn");
    btn.innerText = "Ready! (Waiting for votes...)";
    btn.className = "ready";
  } else {
    level++;
    initLevel();
  }
}

function useDash() {
  if (upgrades.dash === 0 || dashCharges <= 0 || (dir.x === 0 && dir.y === 0)) return;
  dashCharges--;
  updateUI();

  let dashDist = activeCurses.has("nothing") ? 1 : 3;
  for (let step = 0; step < dashDist; step++) {
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= worldGrid || head.y < 0 || head.y >= worldGrid) break;
    snake.unshift(head);
    snake.pop();
  }

  if (!dashCooldownTimer) {
    let rechargeTime = activeCurses.has("nothing") ? 12000 : 7000;
    dashCooldownTimer = setInterval(() => {
      if (dashCharges < upgrades.dash) {
        dashCharges++;
        updateUI();
      } else {
        clearInterval(dashCooldownTimer);
        dashCooldownTimer = null;
      }
    }, rechargeTime);
  }
}

function startBridging() {
  if (upgrades.bridge === 0 || bridgeStamina <= 10 || isBridging || bridgeCooldown > 0) return;
  isBridging = true;
}

function stopBridging() {
  if (isBridging) {
    isBridging = false;
    bridgeCooldown = 100;
  }
}

// DEATH SYSTEM
function triggerPlayerDeath(reason) {
  phase = "GAMEOVER";
  clearInterval(decayTimer);
  snake = [];

  document.getElementById("death-reason").innerText = reason || "Crashed";
  document.getElementById("death-level").innerText = level;
  const actionBtn = document.getElementById("death-action-btn");

  if (isMultiplayer) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PLAYER_DIED", reason }));
    }
    actionBtn.innerText = "Spectate Team";
    document.getElementById("death-screen").style.display = "flex";
  } else {
    actionBtn.innerText = "Try Again";
    document.getElementById("death-screen").style.display = "flex";
  }
}

function handleDeathAction() {
  document.getElementById("death-screen").style.display = "none";
  if (!isMultiplayer) {
    resetRunState();
    initLevel();
  } else {
    setBanner("Spectating survivors... wait for extraction.", "#ffd700");
  }
}

function tick() {
  if (phase === "GAMEOVER" || phase === "INTERMISSION" || phase === "MENU" || phase === "LOBBY" || phase === "TEAM_WIPED") return;
  if (isEscaped || snake.length === 0) return;

  if (activeCurses.has("temperature")) {
    heat += 0.35;
    if (upgrades.thermo > 0) {
      document.getElementById("heat-fill").style.width = `${Math.min(100, heat)}%`;
    }
    if (heat >= 100) return triggerPlayerDeath("Burned alive by the heat!");
  }

  let drainRate = activeCurses.has("nothing") ? 8 : 4;
  if (isBridging) {
    bridgeStamina -= drainRate;
    if (bridgeStamina <= 0) { bridgeStamina = 0; isBridging = false; }
  } else {
    if (bridgeCooldown > 0) bridgeCooldown -= 2;
    else if (bridgeStamina < 100) bridgeStamina = Math.min(100, bridgeStamina + 1);
  }

  dir = nextDir;
  if (dir.x === 0 && dir.y === 0) return;

  if (isMultiplayer && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "MOVE", dir }));
  }

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  if (head.x < 0 || head.x >= worldGrid || head.y < 0 || head.y >= worldGrid) return triggerPlayerDeath("Crashed into world border!");
  if (snake.some(seg => seg.x === head.x && seg.y === head.y)) return triggerPlayerDeath("Bit your own tail!");

  let headTile = decayingTiles.get(`${head.x},${head.y}`);
  if (headTile && headTile.stage === 3 && !isBridging) {
    if (!tryShieldAbsorb(head.x, head.y)) return triggerPlayerDeath("Swallowed by the void!");
  }

  let purpleIdx = purpleDots.findIndex(p => p.x === head.x && p.y === head.y);
  if (purpleIdx !== -1) {
    let safeChance = upgrades.poison * 0.20;
    if (Math.random() < safeChance) {
      purpleDots.splice(purpleIdx, 1);
      purpleDotsEatenThisRun++;
      setBanner(`POISON RESISTED! (${purpleDotsEatenThisRun}/5 for Purple King)`, "#a29bfe");

      if (purpleDotsEatenThisRun >= 5 && !isPurpleKingUnlocked) {
        isPurpleKingUnlocked = true;
        localStorage.setItem("skin_purple_king", "true");
        setBanner("ACHIEVEMENT UNLOCKED: PURPLE KING SKIN!", "#ffd700");
      }
    } else {
      return triggerPlayerDeath("Touched a poisonous Nullscape dot!");
    }
  }

  let coolIdx = coolButtons.findIndex(c => c.x === head.x && c.y === head.y);
  if (coolIdx !== -1) {
    coolButtons.splice(coolIdx, 1);
    heat = Math.max(0, heat - 45);
    spawnDot(coolButtons);
  }

  if (isBridging) bridgePlanks.add(`${head.x},${head.y}`);
  snake.unshift(head);

  let tail = snake[snake.length - 1];
  bridgePlanks.delete(`${tail.x},${tail.y}`);

  // Dot Pickup
  let eatenNormal = normalDots.findIndex(d => d.x === head.x && d.y === head.y);
  if (eatenNormal !== -1) {
    let dot = normalDots[eatenNormal];
    consumedDots.add(`${dot.x},${dot.y}`);
    normalDots.splice(eatenNormal, 1);

    if (isMultiplayer && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "EAT_DOT", x: dot.x, y: dot.y }));
    }

    if (normalDots.length === 0) startGreedPhase();
  } 
  else if (phase === "GREED" && yellowDots.some(d => d.x === head.x && d.y === head.y)) {
    let eatenYellow = yellowDots.findIndex(d => d.x === head.x && d.y === head.y);
    yellowDots.splice(eatenYellow, 1);
    coins += 10;
  } 
  // TOUCH EXIT
  else if (phase === "GREED" && exit && head.x === exit.x && head.y === exit.y) {
    if (isMultiplayer) {
      isEscaped = true;
      snake = [];
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "TOUCH_EXIT" }));
      }
      setBanner("YOU ESCAPED! Spectating teammates...", "#4CAF50");
    } else {
      return triggerIntermission();
    }
    return;
  } 
  else {
    snake.pop();
  }

  updateUI();
}

function updateUI() {
  document.getElementById("level").innerText = level;
  document.getElementById("dots").innerText = normalDots.length;
  document.getElementById("coins").innerText = coins;

  const dashSlot = document.getElementById("dash-hud");
  if (upgrades.dash > 0) {
    dashSlot.classList.add("active");
    document.getElementById("dash-val").innerText = `${dashCharges} / ${upgrades.dash}`;
  } else {
    dashSlot.classList.remove("active");
    document.getElementById("dash-val").innerText = "LOCKED";
  }

  const bridgeSlot = document.getElementById("bridge-hud");
  if (upgrades.bridge > 0) {
    bridgeSlot.classList.add("active");
    let txt = bridgeCooldown > 0 ? `COOLING (${Math.ceil(bridgeCooldown)}%)` : `${Math.ceil(bridgeStamina)}%`;
    document.getElementById("bridge-val").innerText = txt;
  } else {
    bridgeSlot.classList.remove("active");
    document.getElementById("bridge-val").innerText = "LOCKED";
  }

  const shieldSlot = document.getElementById("shield-hud");
  if (upgrades.shield > 0) {
    shieldSlot.style.display = "block";
    shieldSlot.classList.add("active");
    document.getElementById("shield-val").innerText = `${currentShields} / ${upgrades.shield}`;
  } else {
    shieldSlot.style.display = "none";
  }
}

function updatePanels() {
  const uList = document.getElementById("upgrades-list");
  uList.innerHTML = "";
  let hasAny = false;

  if (upgrades.shoes > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('shoes', 'Shoes')}<div class="item-info"><h5>Shoes</h5><p>Speed +${upgrades.shoes * 12}%</p></div><div class="item-badge" style="background:#4CAF50;">${upgrades.shoes}/3</div></div>`;
  }
  if (upgrades.dash > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('dash', 'Dash')}<div class="item-info"><h5>Dash!</h5><p>${activeCurses.has("nothing") ? 'NERFED: 1 Tile' : '3-Tile Blink'}</p></div><div class="item-badge" style="background:#ffd700; color:#000;">${upgrades.dash}/2</div></div>`;
  }
  if (upgrades.bridge > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('bridge', 'Bridge')}<div class="item-info"><h5>Bridge</h5><p>${activeCurses.has("nothing") ? 'NERFED: Fast drain' : 'Cross Void'}</p></div><div class="item-badge" style="background:#00cec9; color:#000;">1/1</div></div>`;
  }
  if (upgrades.poison > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('poison', 'Poison Ctr')}<div class="item-info"><h5>Poison Ctr</h5><p>+${upgrades.poison * 20}% Purple dot safe</p></div><div class="item-badge" style="background:#9b59b6;">${upgrades.poison}/3</div></div>`;
  }
  if (upgrades.eyes > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('eyes', 'Eyes')}<div class="item-info"><h5>Eagle Eyes</h5><p>Radar for coolant</p></div><div class="item-badge" style="background:#3498db;">1/1</div></div>`;
  }
  if (upgrades.shield > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('shield', 'Shield')}<div class="item-info"><h5>Shield</h5><p>Absorb Void Hits</p></div><div class="item-badge" style="background:#e67e22;">${currentShields}/${upgrades.shield}</div></div>`;
  }
  if (upgrades.thermo > 0) {
    hasAny = true;
    uList.innerHTML += `<div class="item-card">${getIconHtml('thermo', 'Thermo')}<div class="item-info"><h5>Thermometer</h5><p>Reveals Heat Bar</p></div><div class="item-badge" style="background:#ff6b81;">1/1</div></div>`;
  }
  if (!hasAny) uList.innerHTML = `<div style="font-size: 11px; color: #666;">No upgrades owned. Visit shop on Level 4!</div>`;

  const cList = document.getElementById("curses-list");
  cList.innerHTML = "";
  if (activeCurses.size === 0) {
    cList.innerHTML = `<div style="font-size: 11px; color: #666;">No active curses. The void sleeps...</div>`;
  } else {
    if (activeCurses.has("temperature")) {
      cList.innerHTML += `<div class="item-card" style="border-color: #ff4757;">${getIconHtml('temperature', 'Temp')}<div class="item-info"><h5 style="color: #ff6b81;">Temperature</h5><p>Hit coolant or burn!</p></div></div>`;
    }
    if (activeCurses.has("nullscape")) {
      cList.innerHTML += `<div class="item-card" style="border-color: #9b59b6;">${getIconHtml('nullscape', 'Nullscape')}<div class="item-info"><h5 style="color: #a29bfe;">Nullscape</h5><p>Purple dots are poison!</p></div></div>`;
    }
    if (activeCurses.has("nothing")) {
      cList.innerHTML += `<div class="item-card" style="border-color: #e67e22;">${getIconHtml('nothing', 'Theory')}<div class="item-info"><h5 style="color: #fdcb6e;">Theory of Nothing</h5><p>Dash & Bridge nerfed.</p></div></div>`;
    }
  }
}

// 60FPS CAMERA & CANVAS RENDERING (WITH SETTINGS APPLIED)
function render(timestamp) {
  if (phase === "MENU") return;

  let speedMultiplier = 1 - (upgrades.shoes * 0.12);
  let tickInterval = Math.max(50, 100 * speedMultiplier);

  if (timestamp - lastTick > tickInterval) {
    tick();
    lastTick = timestamp;
  }

  let targetCamX = (worldGrid * TILE_SIZE) / 2;
  let targetCamY = (worldGrid * TILE_SIZE) / 2;

  if (snake && snake.length > 0) {
    targetCamX = snake[0].x * TILE_SIZE + TILE_SIZE / 2;
    targetCamY = snake[0].y * TILE_SIZE + TILE_SIZE / 2;
  } 
  else if (isMultiplayer) {
    const survivor = Object.values(serverPlayers).find(p => p.alive && !p.escaped && p.snake && p.snake.length > 0);
    if (survivor) {
      targetCamX = survivor.snake[0].x * TILE_SIZE + TILE_SIZE / 2;
      targetCamY = survivor.snake[0].y * TILE_SIZE + TILE_SIZE / 2;
    }
  }

  camera.x += (targetCamX - camera.x) * 0.15;
  camera.y += (targetCamY - camera.y) * 0.15;

  ctx.fillStyle = "#09090d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

  // Floor
  ctx.fillStyle = "#14141e";
  ctx.fillRect(0, 0, worldGrid * TILE_SIZE, worldGrid * TILE_SIZE);

  // Grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= worldGrid; i++) {
    ctx.beginPath(); ctx.moveTo(i * TILE_SIZE, 0); ctx.lineTo(i * TILE_SIZE, worldGrid * TILE_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * TILE_SIZE); ctx.lineTo(worldGrid * TILE_SIZE, i * TILE_SIZE); ctx.stroke();
  }

  // Decay
  decayingTiles.forEach((tile, key) => {
    let [x, y] = key.split(",").map(Number);
    if (tile.stage === 1) ctx.fillStyle = "#3e3e50";
    else if (tile.stage === 2) ctx.fillStyle = "#a5a5bb";
    else if (tile.stage === 3) ctx.fillStyle = "#ffffff";
    ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  });

  // Planks
  ctx.fillStyle = "#00d2d3";
  bridgePlanks.forEach(key => {
    let [x, y] = key.split(",").map(Number);
    ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  });

  // Exit
  if (exit) {
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(exit.x * TILE_SIZE + 2, exit.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  }

  // Dots
  ctx.fillStyle = "#ff4757";
  normalDots.forEach(d => {
    ctx.beginPath(); ctx.arc(d.x * TILE_SIZE + TILE_SIZE / 2, d.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3.5, 0, Math.PI * 2); ctx.fill();
  });

  // Poison
  ctx.fillStyle = "#9b59b6";
  purpleDots.forEach(d => {
    ctx.beginPath(); ctx.arc(d.x * TILE_SIZE + TILE_SIZE / 2, d.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3.2, 0, Math.PI * 2); ctx.fill();
  });

  // Coolant
  ctx.fillStyle = "#00d2d3";
  coolButtons.forEach(d => {
    ctx.fillRect(d.x * TILE_SIZE + 4, d.y * TILE_SIZE + 4, TILE_SIZE - 8, TILE_SIZE - 8);
  });

  // Yellow Coins
  ctx.fillStyle = "#ffd32a";
  yellowDots.forEach(d => {
    ctx.beginPath(); ctx.arc(d.x * TILE_SIZE + TILE_SIZE / 2, d.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2.8, 0, Math.PI * 2); ctx.fill();
  });

  // Local Player
  if (snake && snake.length > 0) {
    snake.forEach((part, i) => {
      if (isPurpleKingUnlocked) {
        ctx.fillStyle = i === 0 ? "#8e44ad" : "#a29bfe";
      } else {
        ctx.fillStyle = i === 0 ? "#2ed573" : "#7bed9f";
      }
      ctx.fillRect(part.x * TILE_SIZE + 1, part.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    });

    // Local Name Tag
    if (userSettings.showNames) {
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      let tag = currentUser || "You";
      if (userSettings.showLevel && accountStats.accountLevel) tag = `[Lv.${accountStats.accountLevel}] ` + tag;
      ctx.fillText(tag, snake[0].x * TILE_SIZE + TILE_SIZE / 2, snake[0].y * TILE_SIZE - 6);
      ctx.restore();
    }
  }

  // Peers (With Player Opacity setting applied!)
  if (isMultiplayer) {
    ctx.save();
    ctx.globalAlpha = userSettings.playerOpacity; // APPLY OPACITY SETTING

    Object.values(serverPlayers).forEach(p => {
      if (p.id !== myPlayerId && p.alive && !p.escaped && p.snake && p.snake.length > 0) {
        p.snake.forEach((part, i) => {
          ctx.fillStyle = i === 0 ? "#e74c3c" : "#ff7675";
          ctx.fillRect(part.x * TILE_SIZE + 1, part.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        });

        // Peer Name Tags
        if (userSettings.showNames) {
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          let peerTag = p.name;
          if (userSettings.showLevel && p.accountLevel) peerTag = `[Lv.${p.accountLevel}] ` + peerTag;
          ctx.fillText(peerTag, p.snake[0].x * TILE_SIZE + TILE_SIZE / 2, p.snake[0].y * TILE_SIZE - 6);
          ctx.restore();
        }
      }
    });

    ctx.restore();
  }

  ctx.strokeStyle = "#ff3838";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, worldGrid * TILE_SIZE, worldGrid * TILE_SIZE);

  ctx.restore();
  requestAnimationFrame(render);
}

// CHAT
const chatInput = document.getElementById("chat-input");
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && chatInput.value.trim() !== "") {
    if (isMultiplayer && socket) {
      socket.send(JSON.stringify({ type: "CHAT", text: chatInput.value.trim() }));
    }
    chatInput.value = "";
    chatInput.blur();
  }
});

function addChatMessage(sender, text) {
  const box = document.getElementById("chat-messages");
  const msg = document.createElement("div");
  msg.innerHTML = `<span style="color:#ffd700;">${sender}:</span> ${text}`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

window.addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput) return;

  if (e.key === "Enter") {
    chatInput.focus();
    return;
  }

  if (phase === "MENU" || phase === "LOBBY" || phase === "TEAM_WIPED") return;

  if (e.code === "Space") {
    if (phase !== "INTERMISSION" && !isEscaped && snake.length > 0) startBridging();
  }

  if (e.key === "Shift" && phase !== "INTERMISSION" && !isEscaped && snake.length > 0) useDash();

  if (["ArrowUp", "KeyW"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: -1 };
  if (["ArrowDown", "KeyS"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: 1 };
  if (["ArrowLeft", "KeyA"].includes(e.code) && dir.x === 0) nextDir = { x: -1, y: 0 };
  if (["ArrowRight", "KeyD"].includes(e.code) && dir.x === 0) nextDir = { x: 1, y: 0 };
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") stopBridging();
});
