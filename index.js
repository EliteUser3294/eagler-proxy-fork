const WebSocket = require("ws");
const { createServer } = require("node:http");

// Create HTTP server for platform health checks
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

// Map routes to target public servers
const servers = {
  "/webmc": "wss://play.webmc.fun",
  "/arch": "wss://arch.mc"
};

// Customizable MOTD settings
const MOTD_SETTINGS = {
  "/webmc": {
    line1: "§b§lWebMC Proxy",
    line2: "§7Connected via EaglerProxy on Render"
  },
  "/arch": {
    line1: "§a§lArchMC Proxy",
    line2: "§7Connected via EaglerProxy on Render"
  }
};

const PORT = process.env.PORT || 25565;
app.listen(PORT, "0.0.0.0");

const wss = new WebSocket.Server({ 
  server: app,
  perMessageDeflate: false 
});

wss.on("connection", (ws, req) => {
  const path = req.url;

  if (req.socket) {
    req.socket.setNoDelay(true);
  }

  if (!servers[path]) {
    ws.close();
    return;
  }

  const targetUrl = new URL(servers[path]);

  const targetWs = new WebSocket(servers[path], {
    perMessageDeflate: false,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": `${targetUrl.protocol}//${targetUrl.host}`
    }
  });

  const messageQueue = [];

  ws.on("message", (data) => {
    // Eaglercraft sends string packets (JSON) for MOTD ping requests
    if (typeof data === "string" || Buffer.isBuffer(data)) {
      const strData = data.toString();

      // Check for Eaglercraft query/MOTD packet request
      if (strData.includes("Accept: MOTD") || strData.includes("Accept: motd") || strData.startsWith("{")) {
        try {
          const parsed = JSON.parse(strData);
          if (parsed.accept === "motd" || parsed.type === "motd") {
            const motdInfo = MOTD_SETTINGS[path] || {
              line1: "§e§lEaglerProxy",
              line2: "§7Online"
            };

            const response = {
              brand: "EaglerProxy",
              cracked: true,
              name: "EaglerProxy",
              motd: [motdInfo.line1, motdInfo.line2],
              type: "motd",
              online: 1,
              max: 100,
              players: []
            };

            ws.send(JSON.stringify(response));
            ws.close();
            return;
          }
        } catch (e) {
          // If it's normal binary game traffic, forward it normally
        }
      }
    }

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
