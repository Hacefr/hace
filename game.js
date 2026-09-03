// ==========================================
// 1. ACCOUNT & AUTHENTICATION SYSTEM
// ==========================================
let currentUser = localStorage.getItem("saved_username") || null;
let currentAuthMode = "login";

window.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    proceedToMainMenu(currentUser);
  }
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
  proceedToMainMenu("Guest_" + Math.floor(Math.random() * 899 + 100));
}

function handleAuthSubmit(e) {
  e.preventDefault();
  const user = document.getElementById("auth-user").value.trim();
  const pass = document.getElementById("auth-pass").value.trim();

  if (user.length < 3 || pass.length < 3) {
    document.getElementById("auth-error").innerText = "Must be at least 3 characters.";
    return;
  }

  localStorage.setItem("saved_username", user);
  proceedToMainMenu(user);
}

function proceedToMainMenu(username) {
  currentUser = username;
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("main-menu").style.display = "flex";
  document.getElementById("current-username").innerText = username;
}

function logout() {
  localStorage.removeItem("saved_username");
  currentUser = null;
  document.getElementById("main-menu").style.display = "none";
  document.getElementById("auth-screen").style.display = "flex";
  backToAuthChoices();
}

// ==========================================
// 2. CORE GAME ENGINE & MULTIPLAYER LOBBY
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

let snake = [];
let dir = { x: 0, y: 0 };
let nextDir = { x: 0, y: 0 };
let normalDots = [];
let purpleDots = [];  
let yellowDots = [];
let coolButtons = []; 
let exit = null;
let decayingTiles = new Map();
let phase = "MENU"; // "MENU", "LOBBY", "COLLECT", "GREED", "INTERMISSION", "GAMEOVER"
let coins = 0;
let level = 1;

let camera = { x: 0, y: 0 };

// UPGRADES
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

// PURPLE KING ACHIEVEMENT TRACKER
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

// SINGLEPLAYER LAUNCH
function startSingleplayer() {
  isMultiplayer = false;
  document.getElementById("main-menu").style.display = "none";
  document.getElementById("main-layout").style.display = "flex";
  document.getElementById("chat-container").style.display = "none";
  document.getElementById("lobby-screen").style.display = "none";
  phase = "COLLECT";
  resizeCanvas();
  initLevel();
  requestAnimationFrame(render);
}

// MULTIPLAYER LAUNCH (Opens Waiting Lobby First!)
function startMultiplayer() {
  isMultiplayer = true;
  isLobbyReady = false;
  document.getElementById("main-menu").style.display = "none";
  document.getElementById("main-layout").style.display = "flex";
  document.getElementById("chat-container").style.display = "flex";
  
  // Show Waiting Lobby
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

    if (data.type === "PLAYER_UPDATE" || data.type === "VOTE_UPDATE") {
      updateLobbyPlayerList();
    }

    if (data.type === "LEVEL_START") {
      // GAME BEGINS: Close lobby & spawn snakes!
      phase = "COLLECT";
      document.getElementById("lobby-screen").style.display = "none";
      document.getElementById("overlay-screen").style.display = "none";

      level = data.level;
      worldGrid = data.worldGrid;
      serverPlayers = data.players;
      normalDots = data.normalDots;
      purpleDots = data.purpleDots || [];

      // Local player spawn position from server
      let me = serverPlayers[myPlayerId];
      if (me && me.snake && me.snake.length > 0) {
        snake = [...me.snake];
        camera.x = snake[0].x * TILE_SIZE;
        camera.y = snake[0].y * TILE_SIZE;
      }

      setBanner(`Level ${level}: Clear red dots!`, "#ff5555");
      updateUI();
    }

    if (data.type === "TICK") {
      serverPlayers = data.players;
      normalDots = data.normalDots;
      updateUI();
    }

    if (data.type === "GREED_START") {
      phase = "GREED";
      exit = data.exit;
      setBanner("EXIT OPEN! ESCAPE OR GREED FOR GOLD!", "#ffd700");
    }

    if (data.type === "INTERMISSION_START") {
      triggerIntermission();
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
    const displayName = isMe ? `${currentUser || p.name} (You)` : p.name;
    const readyState = p.ready ? 
      `<span class="lobby-ready-tag" style="background:#2ecc71; color:#000;">READY</span>` : 
      `<span class="lobby-ready-tag" style="background:#e74c3c;">WAITING</span>`;

    container.innerHTML += `
      <div class="lobby-player-row">
        <span>${displayName}</span>
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

function initLevel() {
  clearInterval(decayTimer);
  document.getElementById("overlay-screen").style.display = "none";
  document.getElementById("lobby-screen").style.display = "none";

  worldGrid = 24 + (level - 1) * 6;
  let mid = Math.floor(worldGrid / 2);
  
  snake = [{ x: mid, y: mid }, { x: mid, y: mid + 1 }];
  dir = { x: 0, y: 0 };
  nextDir = { x: 0, y: 0 };
  camera.x = mid * TILE_SIZE;
  camera.y = mid * TILE_SIZE;

  decayingTiles.clear();
  bridgePlanks.clear();
  yellowDots = [];
  purpleDots = [];
  coolButtons = [];
  exit = null;
  phase = "COLLECT";

  dashCharges = upgrades.dash;
  currentShields = upgrades.shield;
  bridgeStamina = 100;
  isBridging = false;
  heat = 0;

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
      if (snake[0].x === tx && snake[0].y === ty && !isBridging) {
        if (!tryShieldAbsorb(tx, ty)) {
          gameOver("Swallowed by the void!");
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

// ==========================================
// 3. 3-CARD DRAFT & INTERMISSION SYSTEM
// ==========================================
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

// ==========================================
// 4. CONTROLS, ABILITIES & GAME LOOP
// ==========================================
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

function tick() {
  if (phase === "GAMEOVER" || phase === "INTERMISSION" || phase === "MENU" || phase === "LOBBY") return;

  if (activeCurses.has("temperature")) {
    heat += 0.35;
    if (upgrades.thermo > 0) {
      document.getElementById("heat-fill").style.width = `${Math.min(100, heat)}%`;
    }
    if (heat >= 100) return gameOver("OVERHEATED! You burned to ashes!");
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

  if (!snake || snake.length === 0) return;

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  if (head.x < 0 || head.x >= worldGrid || head.y < 0 || head.y >= worldGrid) return gameOver("Crashed into world border!");
  if (snake.some(seg => seg.x === head.x && seg.y === head.y)) return gameOver("Bit your own tail!");

  let headTile = decayingTiles.get(`${head.x},${head.y}`);
  if (headTile && headTile.stage === 3 && !isBridging) {
    if (!tryShieldAbsorb(head.x, head.y)) return gameOver("Swallowed by the void!");
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
      return gameOver("Touched a poisonous Nullscape dot!");
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

  let eatenNormal = normalDots.findIndex(d => d.x === head.x && d.y === head.y);
  if (eatenNormal !== -1) {
    normalDots.splice(eatenNormal, 1);
    if (normalDots.length === 0) startGreedPhase();
  } 
  else if (phase === "GREED" && yellowDots.some(d => d.x === head.x && d.y === head.y)) {
    let eatenYellow = yellowDots.findIndex(d => d.x === head.x && d.y === head.y);
    yellowDots.splice(eatenYellow, 1);
    coins += 10;
  } 
  else if (phase === "GREED" && exit && head.x === exit.x && head.y === exit.y) {
    return triggerIntermission();
  } 
  else {
    snake.pop();
  }

  updateUI();
}

function gameOver(reason) {
  phase = "GAMEOVER";
  clearInterval(decayTimer);
  setBanner(`${reason || 'CRASHED!'} Press SPACE to restart`, "#ff3333");
}

function updateUI() {
  document.getElementById("level").innerText = level;
  document.getElementById("dots").innerText = normalDots.length;
  document.getElementById("coins").innerText = coins;

  const dashSlot = document.getElementById("dash-hud");
  if (upgrades.dash > 0) {
    dashSlot.classList.add("active");
    document.getElementById("dash-val").innerText = `${dashCharges} / ${upgrades.dash}`;
  }

  const bridgeSlot = document.getElementById("bridge-hud");
  if (upgrades.bridge > 0) {
    bridgeSlot.classList.add("active");
    let txt = bridgeCooldown > 0 ? `COOLING (${Math.ceil(bridgeCooldown)}%)` : `${Math.ceil(bridgeStamina)}%`;
    document.getElementById("bridge-val").innerText = txt;
  }

  const shieldSlot = document.getElementById("shield-hud");
  if (upgrades.shield > 0) {
    shieldSlot.style.display = "block";
    shieldSlot.classList.add("active");
    document.getElementById("shield-val").innerText = `${currentShields} / ${upgrades.shield}`;
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

// 60FPS CAMERA & DRAWING
function render(timestamp) {
  if (phase === "MENU") return;

  let speedMultiplier = 1 - (upgrades.shoes * 0.12);
  let tickInterval = Math.max(50, 100 * speedMultiplier);

  if (timestamp - lastTick > tickInterval) {
    tick();
    lastTick = timestamp;
  }

  // Camera Target Math: Defaults to map center if player hasn't spawned yet
  let targetCamX = (worldGrid * TILE_SIZE) / 2;
  let targetCamY = (worldGrid * TILE_SIZE) / 2;

  if (snake && snake.length > 0) {
    targetCamX = snake[0].x * TILE_SIZE + TILE_SIZE / 2;
    targetCamY = snake[0].y * TILE_SIZE + TILE_SIZE / 2;
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

  // Poison Dots
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

  // Local Snake
  snake.forEach((part, i) => {
    if (isPurpleKingUnlocked) {
      ctx.fillStyle = i === 0 ? "#8e44ad" : "#a29bfe";
    } else {
      ctx.fillStyle = i === 0 ? "#2ed573" : "#7bed9f";
    }
    ctx.fillRect(part.x * TILE_SIZE + 1, part.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  });

  // Other Multiplayer Peers
  if (isMultiplayer) {
    Object.values(serverPlayers).forEach(p => {
      if (p.id !== myPlayerId && p.alive && p.snake && p.snake.length > 0) {
        p.snake.forEach((part, i) => {
          ctx.fillStyle = i === 0 ? "#e74c3c" : "#ff7675";
          ctx.fillRect(part.x * TILE_SIZE + 1, part.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        });
      }
    });
  }

  ctx.strokeStyle = "#ff3838";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, worldGrid * TILE_SIZE, worldGrid * TILE_SIZE);

  ctx.restore();
  requestAnimationFrame(render);
}

// CHAT SYSTEM
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

  if (phase === "MENU" || phase === "LOBBY") return;

  if (e.code === "Space") {
    if (phase === "GAMEOVER") {
      coins = 0; level = 1; purpleDotsEatenThisRun = 0;
      upgrades = { shoes: 0, dash: 0, bridge: 0, poison: 0, eyes: 0, shield: 0, thermo: 0 };
      activeCurses.clear();
      initLevel();
      return;
    }
    if (phase !== "INTERMISSION") startBridging();
  }

  if (e.key === "Shift" && phase !== "INTERMISSION") useDash();

  if (["ArrowUp", "KeyW"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: -1 };
  if (["ArrowDown", "KeyS"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: 1 };
  if (["ArrowLeft", "KeyA"].includes(e.code) && dir.x === 0) nextDir = { x: -1, y: 0 };
  if (["ArrowRight", "KeyD"].includes(e.code) && dir.x === 0) nextDir = { x: 1, y: 0 };
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") stopBridging();
});
