const { WebSocketServer, WebSocket } = require('ws');

// Render gives us the PORT automatically in process.env.PORT
const PORT = process.env.PORT || 10000;
const wss = new WebSocketServer({ port: PORT });

console.log(`Universal Multiplayer Server running on port ${PORT}`);

// --- SERVER STATE ---
let players = {}; // { id: { id, name, skin, snake: [], dir, alive, ready, isSpectator } }
let phase = "COLLECT"; // "COLLECT", "GREED", "INTERMISSION"
let level = 1;
let worldGrid = 24;
let normalDots = [];
let purpleDots = [];
let yellowDots = [];
let exit = null;
let whiteTiles = new Set();
let activeCurses = new Set();

// Generate unique player ID
let nextPlayerId = 1;

// --- BROADCAST TO EVERYONE ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// --- LEVEL INITIALIZATION ---
function startLevel() {
  worldGrid = 24 + (level - 1) * 6;
  whiteTiles.clear();
  yellowDots = [];
  purpleDots = [];
  exit = null;
  phase = "COLLECT";

  // Curses
  if (level >= 3) activeCurses.add("temperature");
  if (level >= 5) activeCurses.add("nullscape");
  if (level >= 7) activeCurses.add("nothing");

  // Spawn all players (including spectators waiting in air-lock)
  let mid = Math.floor(worldGrid / 2);
  let offset = 0;

  Object.values(players).forEach(p => {
    p.isSpectator = false;
    p.alive = true;
    p.ready = false;
    p.dir = { x: 0, y: -1 };
    p.snake = [
      { x: mid + offset, y: mid },
      { x: mid + offset, y: mid + 1 }
    ];
    offset += 2; // don't spawn directly on top of each other
  });

  // Spawn red dots
  normalDots = [];
  let dotCount = 8 + (level * 3);
  for (let i = 0; i < dotCount; i++) {
    spawnDot(normalDots);
  }

  // Nullscape purple dots
  if (activeCurses.has("nullscape")) {
    let pCount = Math.floor(normalDots.length * 0.35);
    for (let i = 0; i < pCount; i++) {
      let d = normalDots.pop();
      if (d) purpleDots.push(d);
    }
  }

  broadcast({
    type: "LEVEL_START",
    level,
    worldGrid,
    normalDots,
    purpleDots,
    activeCurses: Array.from(activeCurses),
    players
  });
}

function spawnDot(list) {
  let rx = Math.floor(Math.random() * (worldGrid - 4)) + 2;
  let ry = Math.floor(Math.random() * (worldGrid - 4)) + 2;
  list.push({ x: rx, y: ry });
}

// --- CLIENT CONNECTION ---
wss.on('connection', (ws) => {
  const id = "p_" + (nextPlayerId++);
  console.log(`Player connected: ${id}`);

  // If game is in progress, join as Spectator in Air-Lock!
  const isSpectator = (phase !== "INTERMISSION" && Object.keys(players).length > 0);

  players[id] = {
    id,
    name: `Snake_${id.slice(-2)}`,
    skin: "default",
    snake: [],
    dir: { x: 0, y: 0 },
    alive: false,
    ready: false,
    isSpectator
  };

  // Welcome message with current state
  ws.send(JSON.stringify({
    type: "INIT",
    yourId: id,
    isSpectator,
    phase,
    level,
    worldGrid,
    normalDots,
    purpleDots,
    yellowDots,
    whiteTiles: Array.from(whiteTiles),
    exit,
    players
  }));

  // If first player ever, start level 1!
  if (Object.keys(players).length === 1 && phase !== "INTERMISSION") {
    startLevel();
  }

  // Incoming Messages from Client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 1. DIRECTION INPUT
      if (data.type === "MOVE" && players[id] && players[id].alive) {
        players[id].dir = data.dir;
      }

      // 2. CHAT MESSAGE
      if (data.type === "CHAT") {
        broadcast({
          type: "CHAT",
          sender: players[id] ? players[id].name : "Unknown",
          text: data.text
        });
      }

      // 3. VOTED READY (Intermission)
      if (data.type === "VOTE_READY" && players[id]) {
        players[id].ready = true;
        checkVotes();
      }

      // 4. CHANGE SKIN (e.g. Purple King)
      if (data.type === "SET_SKIN" && players[id]) {
        players[id].skin = data.skin;
        broadcast({ type: "PLAYER_UPDATE", player: players[id] });
      }

    } catch (e) {
      console.error("Error processing message:", e);
    }
  });

  // Disconnect
  ws.on('close', () => {
    console.log(`Player left: ${id}`);
    delete players[id];
    broadcast({ type: "PLAYER_LEFT", id });

    // If all players leave, reset game
    if (Object.keys(players).length === 0) {
      level = 1;
      activeCurses.clear();
      phase = "COLLECT";
    }
  });
});

// Check majority votes to launch next level
function checkVotes() {
  const activeList = Object.values(players);
  const readyCount = activeList.filter(p => p.ready).length;
  const needed = Math.ceil(activeList.length * (2 / 3));

  broadcast({
    type: "VOTE_UPDATE",
    readyCount,
    total: activeList.length,
    needed
  });

  if (readyCount >= needed) {
    level++;
    startLevel();
  }
}

// 60-Tick Server Update Loop
setInterval(() => {
  if (phase === "COLLECT" || phase === "GREED") {
    updateGame();
  }
}, 100);

function updateGame() {
  // Move all alive snakes
  Object.values(players).forEach(p => {
    if (!p.alive || (p.dir.x === 0 && p.dir.y === 0)) return;

    const head = { x: p.snake[0].x + p.dir.x, y: p.snake[0].y + p.dir.y };

    // Wall hit
    if (head.x < 0 || head.x >= worldGrid || head.y < 0 || head.y >= worldGrid) {
      p.alive = false;
      broadcast({ type: "PLAYER_DIED", id: p.id, reason: "Crashed into the border!" });
      return;
    }

    // Void hit
    if (whiteTiles.has(`${head.x},${head.y}`)) {
      p.alive = false;
      broadcast({ type: "PLAYER_DIED", id: p.id, reason: "Swallowed by the void!" });
      return;
    }

    p.snake.unshift(head);

    // Eat Normal Dot
    let nIdx = normalDots.findIndex(d => d.x === head.x && d.y === head.y);
    if (nIdx !== -1) {
      normalDots.splice(nIdx, 1);
      if (normalDots.length === 0) {
        startGreedPhase();
      }
    } else {
      p.snake.pop();
    }

    // Touch Gold Exit -> Triggers Intermission!
    if (phase === "GREED" && exit && head.x === exit.x && head.y === exit.y) {
      triggerIntermission();
    }
  });

  // Broadcast state
  broadcast({
    type: "TICK",
    players,
    normalDots,
    whiteTiles: Array.from(whiteTiles)
  });
}

function startGreedPhase() {
  phase = "GREED";
  exit = {
    x: Math.floor(Math.random() * (worldGrid - 4)) + 2,
    y: Math.floor(Math.random() * (worldGrid - 4)) + 2
  };
  broadcast({ type: "GREED_START", exit });
}

function triggerIntermission() {
  phase = "INTERMISSION";
  broadcast({ type: "INTERMISSION_START", level });
}
