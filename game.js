// ==========================================
// 1. ACCOUNT & AUTHENTICATION SYSTEM
// ==========================================
let currentUser = localStorage.getItem("saved_username") || null;
let currentAuthMode = "login"; // "login" or "signup"

// Check if player was already logged in previously
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

  // Save login state locally
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
// 2. CORE GAME ENGINE & STATE
// ==========================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const TILE_SIZE = 34;       
let worldGrid = 24;

let isMultiplayer = false;
let socket = null;
let myPlayerId = null;
let serverPlayers = {};

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

// PURPLE KING ACHIEVEMENT TRACKER
let purpleDotsEatenThisRun = 0;
let isPurpleKingUnlocked = localStorage.getItem("skin_purple_king") === "true";

// SAFE ICON LOADER (Never throws a 404)
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
  phase = "COLLECT";
  resizeCanvas();
  initLevel();
  requestAnimationFrame(render);
}

// MULTIPLAYER LAUNCH (Connects to your Render server)
function startMultiplayer() {
  isMultiplayer = true;
  document.getElementById("main-menu").style.display = "none";
  document.getElementById("main-layout").style.display = "flex";
  document.getElementById("chat-container").style.display = "flex";
  setBanner("Connecting to live server...", "#ffd700");

  socket = new WebSocket("wss://hace-hsrp.onrender.com");

  socket.onopen = () => {
    setBanner("Connected to Universal Server!", "#4CAF50");
    resizeCanvas();
    requestAnimationFrame(render);
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "INIT") {
      myPlayerId = data.yourId;
      serverPlayers = data.players;
      worldGrid = data.worldGrid;
      level = data.level;
      phase = data.phase;
      normalDots = data.normalDots;
      purpleDots = data.purpleDots;
      if (data.isSpectator) {
        setBanner("Run in progress! Spectating until Intermission...", "#ffd700");
      }
    }

    if (data.type === "LEVEL_START") {
      level = data.level;
      worldGrid = data.worldGrid;
      serverPlayers = data.players;
      normalDots = data.normalDots;
      purpleDots = data.purpleDots;
      phase = "COLLECT";
      document.getElementById("overlay-screen").style.display = "none";
      setBanner(`Level ${level}: Clear red dots!`, "#ff5555");
    }

    if (data.type === "TICK") {
      serverPlayers = data.players;
      normalDots = data.normalDots;
    }

    if (data.type === "GREED_START") {
      phase = "GREED";
      exit = data.exit;
      setBanner("EXIT OPEN! ESCAPE OR GREED FOR GOLD!", "#ffd700");
    }

    if (data.type === "INTERMISSION_START") {
      triggerIntermission();
    }

    if (data.type === "VOTE_UPDATE") {
      document.getElementById("vote-count").innerText = data.readyCount;
      document.getElementById("vote-total").innerText = data.total;
    }

    if (data.type === "CHAT") {
      addChatMessage(data.sender, data.text);
    }
  };

  socket.onclose = () => {
    setBanner("Disconnected from server.", "#ff3333");
  };
}

function initLevel() {
  clearInterval(decayTimer);
  document.getElementById("overlay-screen").style.display = "none";

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

function triggerIntermission() {
  phase = "INTERMISSION";
  clearInterval(decayTimer);

  const overlay = document.getElementById("overlay-screen");
  const shop = document.getElementById("shop-container");
  overlay.style.display = "flex";

  let isShopLevel = (level % 4 === 0);
  let allMaxed = (
    upgrades.shoes >= 3 && upgrades.dash >= 2 && upgrades.bridge >= 1 &&
    upgrades.poison >= 3 && upgrades.eyes >= 1 && upgrades.shield >= 2 && upgrades.thermo >= 1
  );

  if (isShopLevel && !allMaxed) {
    document.getElementById("overlay-title").innerText = "THE SHOP IS OPEN";
    document.getElementById("overlay-title").style.color = "#ffd700";
    document.getElementById("overlay-subtitle").innerText = "Spend your gold on upgrades!";
    shop.style.display = "flex";
    renderShopCards();
  } else {
    document.getElementById("overlay-title").innerText = `LEVEL ${level} COMPLETE`;
    document.getElementById("overlay-title").style.color = "#4CAF50";
    document.getElementById("overlay-subtitle").innerText = "Catch your breath before the next round...";
    shop.style.display = "none";
  }

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

function renderShopCards() {
  document.getElementById("card-shoes").innerHTML = `
    ${getIconHtml('shoes', 'Shoes')}
    <h4>Shoes</h4><p>Speed up.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.shoes}/3</div>
    <button onclick="buyItem('shoes')" ${upgrades.shoes >= 3 || coins < 30 ? 'disabled' : ''}>Buy $30</button>`;

  document.getElementById("card-dash").innerHTML = `
    ${getIconHtml('dash', 'Dash')}
    <h4>Dash!</h4><p>Blink forward.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.dash}/2</div>
    <button onclick="buyItem('dash')" ${upgrades.dash >= 2 || coins < 40 ? 'disabled' : ''}>Buy $40</button>`;

  document.getElementById("card-bridge").innerHTML = `
    ${getIconHtml('bridge', 'Bridge')}
    <h4>Bridge</h4><p>Cross Void.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.bridge}/1</div>
    <button onclick="buyItem('bridge')" ${upgrades.bridge >= 1 || coins < 60 ? 'disabled' : ''}>Buy $60</button>`;

  document.getElementById("card-poison").innerHTML = `
    ${getIconHtml('poison', 'Poison Ctr')}
    <h4>Poison Ctr</h4><p>Resist purple.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.poison}/3</div>
    <button onclick="buyItem('poison')" ${upgrades.poison >= 3 || coins < 35 ? 'disabled' : ''}>Buy $35</button>`;

  document.getElementById("card-eyes").innerHTML = `
    ${getIconHtml('eyes', 'Eyes')}
    <h4>Eagle Eyes</h4><p>Coolant radar.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.eyes}/1</div>
    <button onclick="buyItem('eyes')" ${upgrades.eyes >= 1 || coins < 45 ? 'disabled' : ''}>Buy $45</button>`;

  document.getElementById("card-shield").innerHTML = `
    ${getIconHtml('shield', 'Shield')}
    <h4>Shield</h4><p>Void save.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.shield}/2</div>
    <button onclick="buyItem('shield')" ${upgrades.shield >= 2 || coins < 50 ? 'disabled' : ''}>Buy $50</button>`;

  document.getElementById("card-thermo").innerHTML = `
    ${getIconHtml('thermo', 'Thermometer')}
    <h4>Thermo</h4><p>Heat gauge.</p>
    <div style="font-size:10px; color:#4CAF50;">${upgrades.thermo}/1</div>
    <button onclick="buyItem('thermo')" ${upgrades.thermo >= 1 || coins < 25 ? 'disabled' : ''}>Buy $25</button>`;
}

function buyItem(item) {
  if (item === 'shoes' && upgrades.shoes < 3 && coins >= 30) { coins -= 30; upgrades.shoes++; }
  else if (item === 'dash' && upgrades.dash < 2 && coins >= 40) { coins -= 40; upgrades.dash++; }
  else if (item === 'bridge' && upgrades.bridge < 1 && coins >= 60) { coins -= 60; upgrades.bridge++; }
  else if (item === 'poison' && upgrades.poison < 3 && coins >= 35) { coins -= 35; upgrades.poison++; }
  else if (item === 'eyes' && upgrades.eyes < 1 && coins >= 45) { coins -= 45; upgrades.eyes++; }
  else if (item === 'shield' && upgrades.shield < 2 && coins >= 50) { coins -= 50; upgrades.shield++; currentShields++; }
  else if (item === 'thermo' && upgrades.thermo < 1 && coins >= 25) { 
    coins -= 25; upgrades.thermo++; 
    if (activeCurses.has("temperature")) document.getElementById("heat-bar-wrapper").style.display = "flex";
  }
  updateUI();
  renderShopCards();
  updatePanels();
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

function tick() {
  if (phase === "GAMEOVER" || phase === "INTERMISSION" || phase === "MENU") return;

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
}

function render(timestamp) {
  if (phase === "MENU") return;

  let speedMultiplier = 1 - (upgrades.shoes * 0.12);
  let tickInterval = Math.max(50, 100 * speedMultiplier);

  if (timestamp - lastTick > tickInterval) {
    tick();
    lastTick = timestamp;
  }

  let targetCamX = snake[0] ? snake[0].x * TILE_SIZE + TILE_SIZE / 2 : 0;
  let targetCamY = snake[0] ? snake[0].y * TILE_SIZE + TILE_SIZE / 2 : 0;
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

  // DRAW LOCAL PLAYER (Or Purple King if equipped!)
  snake.forEach((part, i) => {
    if (isPurpleKingUnlocked) {
      ctx.fillStyle = i === 0 ? "#8e44ad" : "#a29bfe";
    } else {
      ctx.fillStyle = i === 0 ? "#2ed573" : "#7bed9f";
    }
    ctx.fillRect(part.x * TILE_SIZE + 1, part.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  });

  // DRAW OTHER PLAYERS IN MULTIPLAYER
  if (isMultiplayer) {
    Object.values(serverPlayers).forEach(p => {
      if (p.id !== myPlayerId && p.alive && p.snake.length > 0) {
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

  if (phase === "MENU") return;

  if (e.code === "Space") {
    if (phase === "GAMEOVER") {
      coins = 0; level = 1; purpleDotsEatenThisRun = 0;
      upgrades = { shoes: 0, dash: 0, bridge: 0, poison: 0, eyes: 0, shield: 0, thermo: 0 };
      activeCurses.clear();
      initLevel();
      return;
    }
  }

  if (["ArrowUp", "KeyW"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: -1 };
  if (["ArrowDown", "KeyS"].includes(e.code) && dir.y === 0) nextDir = { x: 0, y: 1 };
  if (["ArrowLeft", "KeyA"].includes(e.code) && dir.x === 0) nextDir = { x: -1, y: 0 };
  if (["ArrowRight", "KeyD"].includes(e.code) && dir.x === 0) nextDir = { x: 1, y: 0 };
});
