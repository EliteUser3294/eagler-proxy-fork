const WebSocket = require("ws");
const fs = require("fs");
const { createServer } = require("node:http");

const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

let servers = {};

const PORT = process.env.PORT || 25565;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Proxy] Server listening on port ${PORT}`);
});

const wss = new WebSocket.Server({ server: app });

wss.on("connection", (ws, req) => {
  const path = req.url;
  console.log(`[Client Connected] Path: "${path}"`);

  if (!servers[path]) {
    console.log(`[Disconnect] Path not mapped in servers.json: ${path}`);
    ws.close();
    return;
  }

  const targetUrl = servers[path];
  console.log(`[Routing] Connecting ${path} -> ${targetUrl}`);

  // Forward origin and user-agent headers to pass target server handshake checks
  const targetWs = new WebSocket(targetUrl, {
    headers: {
      "User-Agent": req.headers["user-agent"] || "",
      "Origin": req.headers["origin"] || ""
    }
  });

  // Queue initial messages from client if target is still opening
  const messageQueue = [];

  ws.on("message", (data) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    } else if (targetWs.readyState === WebSocket.CONNECTING) {
      messageQueue.push(data);
    }
  });

  targetWs.on("open", () => {
    console.log(`[Target Connected] Forwarding queued packets for ${path}`);
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
    console.log(`[Target Closed] Connection to ${targetUrl} ended`);
    ws.close();
  });

  ws.on("close", () => {
    console.log(`[Client Disconnected] Path: ${path}`);
    targetWs.close();
  });
});

setInterval(() => {
  try {
    if (fs.existsSync("servers.json")) {
      servers = JSON.parse(fs.readFileSync("servers.json", "utf8"));
    }
  } catch (err) {
    console.error("[Error] Failed to read servers.json:", err.message);
  }
}, 2000);
