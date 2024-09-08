const fs = require("fs");
const https = require("https");
const http = require("http");
const WebSocket = require("ws");
const { exec, spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SECRET_KEY;
const USE_SSL = process.env.USE_SSL === "true";

if (!SECRET_KEY) {
  throw new Error("SECRET_KEY is not defined in docker-compose.yml");
}

const PORT = 8080;
const CERT_PATH = "./certs/server.crt";
const KEY_PATH = "./certs/server.key";

let server;

if (USE_SSL) {
  // Load self-signed SSL certificate
  server = https.createServer({
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH),
  });
} else {
  server = http.createServer();
}

const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`WebSocket server is listening on port ${PORT}${USE_SSL ? " with SSL enabled" : " without SSL"}`);
});

function authenticate(token) {
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    return decoded;
  } catch (e) {
    console.error("Authentication error:", e);
    return null;
  }
}

wss.on("connection", (ws, request) => {
  console.log("New client connected");

  const url = new URL(request.url, `${USE_SSL ? "wss" : "ws"}://${request.headers.host}`);
  const token = url.searchParams.get("token");

  const user = authenticate(token);
  if (!user) {
    ws.close();
    return;
  }

  const logProcess = spawn("docker", ["logs", "-f", "minecraft"]);

  logProcess.stdout.on("data", (data) => {
    ws.send(data.toString());
  });

  logProcess.stderr.on("data", (data) => {
    ws.send(`Error: ${data.toString()}`);
  });

  logProcess.on("close", (code) => {
    console.log(`logProcess exited with code ${code}`);
  });

  ws.on("message", (message) => {
    const msgString = message.toString(); // Convert Buffer to string

    console.log(`Received message: ${msgString}`);

    if (msgString === "admincraft restart-server") {
      restartServer();
    } else {
      executeCommand(`docker exec minecraft send-command ${msgString}`);
    }
  });

  function restartServer() {
    console.log("Restarting the Minecraft server...");
    executeCommand("docker restart minecraft");
  }

  ws.on("close", () => {
    console.log("Client disconnected");
    logProcess.kill(); // Kill the log process when client disconnects
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.send(`${user.userId} connected`);
});

function executeCommand(command) {
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }

    console.log(`stdout: ${stdout}`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(stdout);
      }
    });
  });
}
