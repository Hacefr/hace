const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;
const wss = new WebSocketServer({ port: PORT });

console.log(`Universal Multiplayer Server running on port ${PORT}`);

// SERVER-SIDED ACCOUNTS DATABASE (Tracks levels and EXP securely)
let serverAccounts = {}; // username -> { password, accountLevel, exp }

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

const INACTIVITY_LIMIT = 5 * 60 * 1000;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function getExpRequired(lvl) {
  return lvl * 60; // Level 1->2 takes 60 EXP (4 floors), Level 2->3 takes 120 EXP, etc.
}

function awardAccountExp(username, amount) {
  if (!username || username.startsWith("Guest_") || !serverAccounts[username]) return;

  const acc = serverAccounts[username];
  acc.exp += amount;

  while (acc.exp >= getExpRequired(acc.accountLevel)) {
    acc.exp -= getExpRequired(acc.accountLevel);
    acc.accountLevel++;
    console.log(`User ${username} leveled up to Account Level ${acc.accountLevel}!`);
  }

  // Find player socket and send updated profile
  Object.values(players).forEach(p => {
    if (p.accountUser === username && p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.accountLevel = acc.accountLevel;
      p.ws.send(JSON.stringify({
        type: "ACCOUNT_UPDATE",
        accountLevel: acc.accountLevel,
        exp: acc.exp,
        expNeeded: getExpRequired(acc.accountLevel)
      }));
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
  Object.values(players).forEach(p => {
    p.alive = false;
    p.escaped = false;
    p.ready = false;
    p.snake = [];
  });
  console.log("Server state reset to clean Level 1 Lobby.");
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
    p.escaped = false;
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
    players: getPublicPlayers()
  });
}

function checkRoundCompletion() {
  const playerList = Object.values(players);
  if (playerList.length === 0) return;

  const allFinished = playerList.every(p => p.escaped || !p.alive);

  if (allFinished && (phase === "COLLECT" || phase === "GREED")) {
    const anyEscaped = playerList.some(p => p.escaped);

    if (anyEscaped) {
      // Award 15 EXP to all authenticated players who survived or participated!
      playerList.forEach(p => {
        if (p.accountUser) awardAccountExp(p.accountUser, 15);
      });

      phase = "INTERMISSION";
      broadcast({ type: "INTERMISSION_START", level });
    } else {
      phase = "TEAM_WIPED";
      broadcast({
        type: "TEAM_WIPED",
        level,
        message: "TEAM WIPED! All players died."
      });

      setTimeout(() => {
        resetServer();
        broadcast({ type: "RETURN_TO_LOBBY", level: 1, players: getPublicPlayers() });
      }, 5000);
    }
  }
}

wss.on('connection', (ws) => {
  const id = "p_" + (nextPlayerId++);
  console.log(`Player connected: ${id}`);

  players[id] = {
    id,
    name: `Snake_${id.slice(-2)}`,
    accountUser: null,
    accountLevel: 1,
    snake: [],
    dir: { x: 0, y: 0 },
    alive: false,
    escaped: false,
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

      players[id].lastActive = Date.now();

      // SERVER AUTHENTICATION & ACCOUNT DATA
      if (data.type === "LOGIN" || data.type === "SIGNUP") {
        const u = data.username.trim();
        if (!serverAccounts[u]) {
          serverAccounts[u] = { password: data.password, accountLevel: 1, exp: 0 };
        }
        const acc = serverAccounts[u];
        players[id].accountUser = u;
        players[id].name = u;
        players[id].accountLevel = acc.accountLevel;

        ws.send(JSON.stringify({
          type: "AUTH_SUCCESS",
          username: u,
          accountLevel: acc.accountLevel,
          exp: acc.exp,
          expNeeded: getExpRequired(acc.accountLevel)
        }));
        broadcast({ type: "PLAYER_UPDATE", players: getPublicPlayers() });
      }

      if (data.type === "MOVE" && players[id].alive && !players[id].escaped) {
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

      if (data.type === "TOUCH_EXIT" && phase === "GREED" && players[id].alive && !players[id].escaped) {
        players[id].escaped = true;
        players[id].alive = false;
        players[id].snake = [];

        broadcast({
          type: "PLAYER_ESCAPED",
          id,
          name: players[id].name,
          players: getPublicPlayers()
        });

        checkRoundCompletion();
      }

      if (data.type === "PLAYER_DIED" && players[id].alive) {
        players[id].alive = false;
        players[id].snake = [];

        broadcast({
          type: "PLAYER_FELL",
          id,
          name: players[id].name,
          reason: data.reason || "crashed",
          players: getPublicPlayers()
        });

        checkRoundCompletion();
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
    console.log(`Player left: ${id}`);
    delete players[id];

    if (Object.keys(players).length === 0) {
      resetServer();
    } else {
      broadcast({ type: "PLAYER_UPDATE", players: getPublicPlayers() });
      checkRoundCompletion();
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

// Inactivity Monitor
setInterval(() => {
  const now = Date.now();
  Object.values(players).forEach(p => {
    if (now - p.lastActive > INACTIVITY_LIMIT) {
      p.ws.send(JSON.stringify({
        type: "KICKED",
        reason: "You were kicked due to 5 minutes of inactivity."
      }));
      p.ws.close();
    }
  });
}, 15000);

function getPublicPlayers() {
  let clean = {};
  Object.keys(players).forEach(k => {
    clean[k] = {
      id: players[k].id,
      name: players[k].name,
      accountLevel: players[k].accountLevel || 1,
      snake: players[k].snake,
      dir: players[k].dir,
      alive: players[k].alive,
      escaped: players[k].escaped,
      ready: players[k].ready
    };
  });
  return clean;
}

setInterval(() => {
  if (phase === "COLLECT" || phase === "GREED") {
    broadcast({
      type: "TICK",
      players: getPublicPlayers(),
      normalDots
    });
  }
}, 100);
