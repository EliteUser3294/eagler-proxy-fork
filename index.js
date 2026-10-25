const WebSocket = require("ws");
const { createServer } = require("node:http");

// Create HTTP server for platform health checks
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

// Define your servers directly here to avoid JSON parsing/trailing comma issues
const servers = {
  "/webmc": "wss://play.webmc.fun",
  "/arch": "wss://arch.mc"
};

const PORT = process.env.PORT || 25565;
app.listen(PORT, "0.0.0.0");

// Optimization: perMessageDeflate: false disables compression overhead for low latency
const wss = new WebSocket.Server({ 
  server: app,
  perMessageDeflate: false 
});

wss.on("connection", (ws, req) => {
  const path = req.url;

  // Optimization: Disable Nagle's algorithm to send TCP packets instantly
  if (req.socket) {
    req.socket.setNoDelay(true);
  }

  if (!servers[path]) {
    ws.close();
    return;
  }

  // Parse target URL to construct a proper Origin header for public servers
  const targetUrl = new URL(servers[path]);

  // Connect to target WebSocket with low latency and clean headers
  const targetWs = new WebSocket(servers[path], {
    perMessageDeflate: false,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": `${targetUrl.protocol}//${targetUrl.host}`
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

  // Added error logging to easily catch proxy handshake drops in your console
  targetWs.on("error", (err) => {
    console.error(`Target WS Error for ${path}:`, err.message);
  });

  targetWs.on("close", () => {
    ws.close();
  });

  ws.on("close", () => {
    targetWs.close();
  });
});
