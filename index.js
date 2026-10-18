const WebSocket = require("ws");
const fs = require("fs");
const { createServer } = require("node:http");

// Create HTTP server for Render health checks
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

let servers = {};

// Initial load of servers.json
function loadServers() {
  try {
    if (fs.existsSync("servers.json")) {
      servers = JSON.parse(fs.readFileSync("servers.json", "utf8"));
      console.log("[Config] Loaded servers.json successfully");
    }
  } catch (err) {
    console.error("[Error] Failed to read servers.json:", err.message);
  }
}

loadServers();

// Watch for changes in servers.json instead of polling every 2 seconds
if (fs.existsSync("servers.json")) {
  fs.watch("servers.json", (eventType) => {
    if (eventType === "change") {
      loadServers();
    }
  });
}

const PORT = process.env.PORT || 25565;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Proxy] Server listening on port ${PORT}`);
});

// Optimization: perMessageDeflate: false disables compression overhead for low latency
const wss = new WebSocket.Server({ 
  server: app,
  perMessageDeflate: false 
});

wss.on("connection", (ws, req) => {
  const path = req.url;

  // Optimization: Disable Nagle's algorithm to send packets instantly
  if (req.socket) {
    req.socket.setNoDelay(true);
  }

  if (!servers[path]) {
    console.log(`[Disconnect] Path not mapped in servers.json: ${path}`);
    ws.close();
    return;
  }

  const targetUrl = servers[path];

  // Connect to target WebSocket with low latency options
  const targetWs = new WebSocket(targetUrl, {
    perMessageDeflate: false,
    headers: {
      "User-Agent": req.headers["user-agent"] || "",
      "Origin": req.headers["origin"] || ""
    }
  });

  const messageQueue = [];

  ws.on("message", (data) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    } else if (targetWs.readyState === WebSocket.CONNECTING) {
      messageQueue.push(data);
    }
  });

  targetWs.on("open", () => {
    // Enable TCP No Delay on target connection if socket exists
    if (targetWs._socket) {
      targetWs._socket.setNoDelay(true);
    }

    while (messageQueue.length > 0) {
      targetWs.send(messageQueue.shift());
    }
  });

  targetWs.on("message", (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  targetWs.on("error", (err) => {
    console.error(`[Target Error] ${targetUrl}:`, err.message);
  });

  targetWs.on("close", () => {
    ws.close();
  });

  ws.on("close", () => {
    targetWs.close();
  });
});
