const WebSocket = require("ws");
const { createServer } = require("node:http");

// HTTP server for Render platform health checks
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

// Pre-computed server mappings to avoid URL parsing overhead on every connection
const servers = {
  "/webmc": { 
    url: "wss://play.webmc.fun",
    origin: "https://play.webmc.fun"
  },
  "/arch": { 
    url: "wss://arch.mc",
    origin: "https://arch.mc"
  }
};

const PORT = process.env.PORT || 25565;
app.listen(PORT, "0.0.0.0");

// Optimization: 
// - perMessageDeflate: false disables compression overhead for low latency
// - skipUTF8Validation: true skips CPU-intensive UTF-8 checks for binary game data
// - maxPayload: prevents memory exhaustion from malicious/oversized payloads
const wss = new WebSocket.Server({ 
  server: app,
  perMessageDeflate: false,
  skipUTF8Validation: true,
  maxPayload: 10 * 1024 * 1024 // 10MB safety limit
});

wss.on("connection", (ws, req) => {
  const path = req.url;
  const serverConfig = servers[path];

  // Optimization: Disable Nagle's algorithm to send packets instantly
  if (req.socket) {
    req.socket.setNoDelay(true);
  }

  if (!serverConfig) {
    ws.close(1008, "Invalid path");
    return;
  }

  // Extract client subprotocols (e.g., 'eaglercraft') so backend accepts the handshake
  const clientProtocols = req.headers["sec-websocket-protocol"];
  const protocols = clientProtocols ? clientProtocols.split(',').map(s => s.trim()) : undefined;

  // Connect instantly to the target server with optimized settings
  const targetWs = new WebSocket(serverConfig.url, protocols, {
    perMessageDeflate: false,
    skipUTF8Validation: true,
    maxPayload: 10 * 1024 * 1024,
    headers: {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      "Origin": serverConfig.origin
    }
  });

  const messageQueue = [];

  ws.on("message", (data) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      // Explicitly declare binary to skip type-checking overhead
      targetWs.send(data, { binary: true });
    } else if (targetWs.readyState === WebSocket.CONNECTING) {
      // Cap queue size to prevent memory exhaustion on slow handshakes
      if (messageQueue.length < 100) {
        messageQueue.push(data);
      } else {
        ws.close(1013, "Proxy queue full");
      }
    }
  });

  targetWs.on("open", () => {
    if (targetWs._socket) {
      targetWs._socket.setNoDelay(true);
    }

    // Optimized queue flush: O(N) instead of O(N^2) with shift()
    for (let i = 0; i < messageQueue.length; i++) {
      targetWs.send(messageQueue[i], { binary: true });
    }
    messageQueue.length = 0; // Clear array efficiently
  });

  targetWs.on("message", (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: true });
    }
  });

  // Proper error handling prevents zombie connections and memory leaks
  targetWs.on("error", (err) => {
    // console.error("Target WS error:", err.message); // Uncomment for debugging
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "Target server error");
    }
  });

  targetWs.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on("close", () => {
    if (targetWs.readyState === WebSocket.OPEN || targetWs.readyState === WebSocket.CONNECTING) {
      targetWs.close();
    }
  });
});
