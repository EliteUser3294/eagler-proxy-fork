const WebSocket = require("ws");
const fs = require("fs");
const { createServer } = require("node:http");

// Create HTTP server for Render health checks and WebSockets
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EaglerProxy is running!\n");
});

let servers = {};

// Render assigns a dynamic port via process.env.PORT
const PORT = process.env.PORT || 25565;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Proxy] Server listening on port ${PORT}`);
});

const wss = new WebSocket.Server({ server: app });

wss.on("connection", (ws, req) => {
  console.log(`[Client Connected] Incoming request path: "${req.url}"`);

  ws.on("message", (message) => {
    // Check if path exists in servers.json
    if (servers[req.url]) {
      const targetUrl = servers[req.url];
      console.log(`[Routing] Connecting ${req.url} -> ${targetUrl}`);

      const targetWs = new WebSocket(targetUrl);

      targetWs.onerror = (err) => {
        console.error(`[Target Error] Connection failed to ${targetUrl}:`, err.message);
      };

      targetWs.onopen = () => {
        console.log(`[Target Connected] Forwarding traffic for ${req.url}`);
        targetWs.send(message);

        // Forward packets back and forth between client and target
        ws.on("message", (data) => targetWs.send(data));
        targetWs.onmessage = (data) => ws.send(data.data);

        ws.on("close", () => targetWs.close());
        targetWs.onclose = () => ws.close();
      };
    } else {
      // Return MOTD or invalid server error packet to Eaglercraft client
      if (message.toString() === "Accept: MOTD") {
        console.log(`[MOTD Requested] Path not found: ${req.url}`);
        ws.send(
          JSON.stringify({
            name: "Selenite",
            brand: "lax1dude",
            vers: "EaglerXBungee/1.0.10",
            cracked: true,
            secure: false,
            time: Date.now(),
            uuid: "e3ed38dd-303a-41ab-9d1d-fac4f50c10e3",
            type: "motd",
            data: {
              cache: true,
              motd: ["Selenite Proxy", "This server doesnt exist!"],
              icon: false,
              online: 0,
              max: 0,
              players: []
            }
          })
        );
      } else {
        console.log(`[Disconnect] Unmapped path requested: ${req.url}`);
        ws.send(
          Buffer.from(
            "ff003c00540068006900730020006900730020006e006f007400200061002000760061006c0069006400200073006500720076006500720021000a0050006c00650061007300650020007400720079002000770069007400680020006100200064006900660066006500720065006e0074002000550052004c0021",
            "hex"
          )
        );
        ws.send(Buffer.from("ff0113556e6b6e6f776e205061636b65742023323530", "hex"));
        ws.close();
      }
    }
  });
});

// Periodically reload servers.json with error handling
setInterval(() => {
  try {
    if (fs.existsSync("servers.json")) {
      const rawData = fs.readFileSync("servers.json", "utf8");
      servers = JSON.parse(rawData);
    }
  } catch (err) {
    console.error("[Error] Failed to read or parse servers.json:", err.message);
  }
}, 2000);
