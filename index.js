const WebSocket = require("ws");
const { createServer } = require("node:http");

// HTTP server for Render platform health checks
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

// Hardcoded server mappings
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

  // Optimization: Disable Nagle's algorithm to send packets instantly
  if (req.socket) {
    req.socket.setNoDelay(true);
  }

  if (!servers[path]) {
    ws.close();
    return;
  }

  // Extract client subprotocols (e.g., 'eaglercraft') so backend accepts the handshake
  const clientProtocols = req.headers["sec-websocket-protocol"];
  const targetUrl = new URL(servers[path]);

  // Connect instantly to the target server
  const targetWs = new WebSocket(
    servers[path], 
    clientProtocols ? clientProtocols.split(',').map(s => s.trim()) : undefined, 
    {
      perMessageDeflate: false,
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Origin": `${targetUrl.protocol}//${targetUrl.host}`
      }
    }
  );

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

  targetWs.on("error", () => {});

  targetWs.on("close", () => {
    ws.close();
  });

  ws.on("close", () => {
    targetWs.close();
  });
});
