const WebSocket = require("ws");
const { createServer } = require("node:http");

const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

const servers = {
  "/webmc": "wss://play.webmc.fun",
  "/arch": "wss://arch.mc"
};

const MOTD_SETTINGS = {
  "/webmc": {
    name: "WebMC Proxy",
    line1: "§b§lWebMC Proxy",
    line2: "§7Connected via Render Proxy"
  },
  "/arch": {
    name: "ArchMC Proxy",
    line1: "§a§lArchMC Proxy",
    line2: "§7Connected via Render Proxy"
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

  let targetWs = null;
  const messageQueue = [];

  ws.on("message", (data) => {
    // 1. Check if the message is a string/JSON MOTD request
    if (typeof data === "string" || Buffer.isBuffer(data)) {
      const strData = data.toString();

      if (strData.includes("Accept:") || strData.includes("motd") || strData.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(strData);
          if (parsed.accept === "motd" || parsed.type === "motd") {
            const motdInfo = MOTD_SETTINGS[path] || {
              name: "EaglerProxy",
              line1: "§e§lEaglerProxy",
              line2: "§7Online"
            };

            // Structure expected by Eaglercraft clients
            const response = {
              brand: "EaglerProxy",
              cracked: true,
              name: motdInfo.name,
              motd: [motdInfo.line1, motdInfo.line2],
              type: "motd",
              online: 1,
              max: 100,
              players: [],
              secure: false,
              icon: false
            };

            ws.send(JSON.stringify(response));
            ws.close();
            return;
          }
        } catch (e) {
          // Not an MOTD query packet; proceed to game connection
        }
      }
    }

    // 2. If it's actual game traffic, initialize target connection lazily
    if (!targetWs) {
      const targetUrl = new URL(servers[path]);
      targetWs = new WebSocket(servers[path], {
        perMessageDeflate: false,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": `${targetUrl.protocol}//${targetUrl.host}`
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

      targetWs.on("message", (msg) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      });

      targetWs.on("error", (err) => {
        console.error(`Target WS Error for ${path}:`, err.message);
      });

      targetWs.on("close", () => {
        ws.close();
      });
    }

    // Forward packet to target server
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    } else if (targetWs.readyState === WebSocket.CONNECTING) {
      messageQueue.push(data);
    }
  });

  ws.on("close", () => {
    if (targetWs) {
      targetWs.close();
    }
  });
});
