const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;
const wss = new WebSocketServer({ port: PORT });

console.log(`Universal Multiplayer Server running on port ${PORT}`);

let players = {};
let phase = "LOBBY"; // "LOBBY", "COLLECT", "GREED", "INTERMISSION", "TEAM_WIPED"
let level = 1;
let worldGrid = 24;
let normalDots = [];
let purpleDots = [];
let yellowDots = [];
let exit = null;
let whiteTiles = new Set();
let activeCurses = new Set();
let nextPlayerId = 1;

// 5-Minute Inactivity limit (300,000 milliseconds)
const INACTIVITY_LIMIT = 5 * 60 * 1000;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function resetServer() {
  level = 1;
  phase = "LOBBY";
  worldGrid = 24;
  whiteTiles.clear();
  activeCurses.clear();
  normalDots = [];
  purpleDots = [];
  yellowDots = [];
  exit = null;
  console.log("Server completely reset to clean Level 1 Lobby.");
}

function startLevel() {
  worldGrid = 24 + (level - 1) * 6;
  whiteTiles.clear();
  yellowDots = [];
  purpleDots = [];
  exit = null;
  phase = "COLLECT";

  if (level >= 3) activeCurses.add("temperature");
  if (level >= 5) activeCurses.add("nullscape");
  if (level >= 7) activeCurses.add("nothing");

  let mid = Math.floor(worldGrid / 2);
  let offset = 0;

  Object.values(players).forEach(p => {
    p.alive = true;
    p.ready = false;
    p.dir = { x: 0, y: -1 };
    p.snake = [
      { x: mid + offset, y: mid },
      { x: mid + offset, y: mid + 1 }
    ];
    offset += 2;
  });

  normalDots = [];
  let dotCount = 8 + (level * 3);
  for (let i = 0; i < dotCount; i++) {
    let rx = Math.floor(Math.random() * (worldGrid - 4)) + 2;
    let ry = Math.floor(Math.random() * (worldGrid - 4)) + 2;
    normalDots.push({ x: rx, y: ry });
  }

  broadcast({
    type: "LEVEL_START",
    level,
    worldGrid,
    normalDots,
    purpleDots,
    players
  });
}

function checkTeamWipe() {
  const playerList = Object.values(players);
  if (playerList.length === 0) return;

  const allDead = playerList.every(p => !p.alive);
  if (allDead && (phase === "COLLECT" || phase === "GREED")) {
    phase = "TEAM_WIPED";
    console.log(`Team wipe on Level ${level}.`);
    broadcast({
      type: "TEAM_WIPED",
      level,
      message: "EVERYONE DIED! The team has been eliminated."
    });

    // Automatically return to Lobby after 6 seconds
    setTimeout(() => {
      resetServer();
      Object.values(players).forEach(p => { p.ready = false; p.alive = false; });
      broadcast({ type: "RETURN_TO_LOBBY", players });
    }, 6000);
  }
}

wss.on('connection', (ws) => {
  const id = "p_" + (nextPlayerId++);
  console.log(`Player connected: ${id}`);

  players[id] = {
    id,
    name: `Snake_${id.slice(-2)}`,
    snake: [],
    dir: { x: 0, y: 0 },
    alive: false,
    ready: false,
    lastActive: Date.now(),
    ws
  };

  ws.send(JSON.stringify({
    type: "INIT",
    yourId: id,
    worldGrid,
    level,
    phase,
    players: getPublicPlayers()
  }));

  broadcast({ type: "PLAYER_UPDATE", players: getPublicPlayers() });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (!players[id]) return;

      // Update player activity timestamp
      players[id].lastActive = Date.now();

      if (data.type === "MOVE" && players[id].alive) {
        players[id].dir = data.dir;
      }

      if (data.type === "EAT_DOT") {
        let idx = normalDots.findIndex(d => d.x === data.x && d.y === data.y);
        if (idx !== -1) {
          normalDots.splice(idx, 1);
          broadcast({ type: "DOT_REMOVED", x: data.x, y: data.y });

          if (normalDots.length === 0 && phase === "COLLECT") {
            phase = "GREED";
            exit = {
              x: Math.floor(Math.random() * (worldGrid - 4)) + 2,
              y: Math.floor(Math.random() * (worldGrid - 4)) + 2
            };
            broadcast({ type: "GREED_START", exit });
          }
        }
      }

      // INSTANT MULTIPLAYER EXIT TRIGGER
      if (data.type === "TOUCH_EXIT" && phase === "GREED") {
        phase = "INTERMISSION";
        broadcast({ type: "INTERMISSION_START", level });
      }

      if (data.type === "PLAYER_DIED") {
        players[id].alive = false;
        broadcast({
          type: "PLAYER_FELL",
          id,
          name: players[id].name,
          reason: data.reason || "died"
        });
        checkTeamWipe();
      }

      if (data.type === "VOTE_READY") {
        players[id].ready = !players[id].ready;
        checkVotes();
      }

      if (data.type === "CHAT") {
        broadcast({
          type: "CHAT",
          sender: players[id].name,
          text: data.text
        });
      }

    } catch (e) {
      console.error("Error processing packet:", e);
    }
  });

  ws.on('close', () => {
    console.log(`Player disconnected: ${id}`);
    delete players[id];

    // RESET SERVER ONCE EVERYONE LEAVES
    if (Object.keys(players).length === 0) {
      resetServer();
    } else {
      broadcast({ type: "PLAYER_UPDATE", players: getPublicPlayers() });
      checkTeamWipe();
    }
  });
});

function checkVotes() {
  const activeList = Object.values(players);
  const readyCount = activeList.filter(p => p.ready).length;
  const needed = Math.ceil(activeList.length * (2 / 3));

  broadcast({
    type: "VOTE_UPDATE",
    readyCount,
    total: activeList.length,
    needed,
    players: getPublicPlayers()
  });

  if (readyCount >= needed && activeList.length > 0) {
    if (phase === "INTERMISSION") level++;
    startLevel();
  }
}

// INACTIVITY CHECKER: Kicks players after 5 minutes of no actions
setInterval(() => {
  const now = Date.now();
  Object.values(players).forEach(p => {
    if (now - p.lastActive > INACTIVITY_LIMIT) {
      console.log(`Kicking ${p.name} for 5m of inactivity.`);
      p.ws.send(JSON.stringify({
        type: "KICKED",
        reason: "You were kicked due to 5 minutes of inactivity."
      }));
      p.ws.close();
    }
  });
}, 15000);

// Helper to scrub circular WS reference from broadcast
function getPublicPlayers() {
  let clean = {};
  Object.keys(players).forEach(k => {
    clean[k] = {
      id: players[k].id,
      name: players[k].name,
      snake: players[k].snake,
      dir: players[k].dir,
      alive: players[k].alive,
      ready: players[k].ready
    };
  });
  return clean;
}

// 100ms Game Loop
setInterval(() => {
  if (phase === "COLLECT" || phase === "GREED") {
    broadcast({
      type: "TICK",
      players: getPublicPlayers(),
      normalDots
    });
  }
}, 100);
