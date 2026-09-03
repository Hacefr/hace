const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;
const wss = new WebSocketServer({ port: PORT });

console.log(`Universal Multiplayer Server running on port ${PORT}`);

let players = {};
let phase = "LOBBY";
let level = 1;
let worldGrid = 24;
let normalDots = [];
let purpleDots = [];
let yellowDots = [];
let exit = null;
let whiteTiles = new Set();
let activeCurses = new Set();
let nextPlayerId = 1;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
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

wss.on('connection', (ws) => {
  const id = "p_" + (nextPlayerId++);
  console.log(`Player connected: ${id}`);

  players[id] = {
    id,
    name: `Snake_${id.slice(-2)}`,
    snake: [],
    dir: { x: 0, y: 0 },
    alive: false,
    ready: false
  };

  ws.send(JSON.stringify({
    type: "INIT",
    yourId: id,
    worldGrid,
    level,
    players
  }));

  broadcast({ type: "PLAYER_UPDATE", players });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "MOVE" && players[id] && players[id].alive) {
        players[id].dir = data.dir;
      }

      // INSTANT DOT REMOVAL HANDLER (Stops ghost dots!)
      if (data.type === "EAT_DOT") {
        let idx = normalDots.findIndex(d => d.x === data.x && d.y === data.y);
        if (idx !== -1) {
          normalDots.splice(idx, 1);
          broadcast({ type: "DOT_REMOVED", x: data.x, y: data.y });

          if (normalDots.length === 0) {
            phase = "GREED";
            exit = {
              x: Math.floor(Math.random() * (worldGrid - 4)) + 2,
              y: Math.floor(Math.random() * (worldGrid - 4)) + 2
            };
            broadcast({ type: "GREED_START", exit });
          }
        }
      }

      if (data.type === "VOTE_READY" && players[id]) {
        players[id].ready = !players[id].ready;
        checkVotes();
      }

      if (data.type === "CHAT") {
        broadcast({
          type: "CHAT",
          sender: players[id] ? players[id].name : "Unknown",
          text: data.text
        });
      }

    } catch (e) {
      console.error("Error processing packet:", e);
    }
  });

  ws.on('close', () => {
    delete players[id];
    broadcast({ type: "PLAYER_UPDATE", players });
    if (Object.keys(players).length === 0) {
      level = 1;
      phase = "LOBBY";
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
    players
  });

  if (readyCount >= needed && activeList.length > 0) {
    startLevel();
  }
}

// 100ms Server Game Sync
setInterval(() => {
  if (phase === "COLLECT" || phase === "GREED") {
    broadcast({
      type: "TICK",
      players,
      normalDots
    });
  }
}, 100);
