const fs = require("fs");
const https = require("https");
const http = require("http");
const WebSocket = require("ws");
const { exec, spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const path = require("path");

// Configuration
const SECRET_KEY = process.env.SECRET_KEY;
const USE_SSL = process.env.USE_SSL === "true";
const PORT = 8080;
const CERT_PATH = "./certs/server.crt"; // Public certificate path
const KEY_PATH = "./certs/server.key"; // Private key path
const MAX_MESSAGES_PER_SECOND = 5; // Rate limiting configuration

if (!SECRET_KEY) {
  throw new Error("SECRET_KEY is not defined in docker-compose.yml");
}

// HTTP request handler for serving the certificate
function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/getcert") {
    const certFilePath = path.join(__dirname, CERT_PATH);
    res.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="server.crt"',
    });
    fs.createReadStream(certFilePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
}

// JWT authentication
function authenticate(token) {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (e) {
    console.error("Authentication error:", e.message);
    return null;
  }
}

// Command execution
function executeCommand(command) {
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Execution error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Command error: ${stderr}`);
      return;
    }

    console.log(`Command output: ${stdout}`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(stdout);
      }
    });
  });
}

// Restart server command
function restartServer() {
  console.log("Restarting the Minecraft server...");
  executeCommand("docker restart minecraft");
}

// Validate and sanitize WebSocket messages to prevent command injection
function validateMessage(message) {
  const validCommandPattern = /^[a-zA-Z0-9_\- ]+$/;
  return validCommandPattern.test(message);
}

// Create server with or without SSL
let server;
let useSSL = USE_SSL;

if (useSSL) {
  try {
    fs.accessSync(CERT_PATH, fs.constants.F_OK);
    fs.accessSync(KEY_PATH, fs.constants.F_OK);
  } catch (err) {
    console.warn("=================================================================");
    console.warn("WARNING: SSL certificates not found. Starting server without SSL.");
    console.warn("=================================================================");
    useSSL = false;
  }
}

if (useSSL) {
  server = https.createServer(
    {
      cert: fs.readFileSync(CERT_PATH),
      key: fs.readFileSync(KEY_PATH),
    },
    handleRequest
  );
} else {
  server = http.createServer();
}

// WebSocket server setup
const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`WebSocket server is listening on port ${PORT}${useSSL ? " with SSL enabled" : " with SSL disabled"}`);
});

wss.on("connection", (ws, request) => {
  console.log("New client connected");

  const url = new URL(request.url, `${useSSL ? "wss" : "ws"}://${request.headers.host}`);
  const token = url.searchParams.get("token");

  const user = authenticate(token);
  if (!user) {
    ws.close(4001, "Authentication failed");
    return;
  }

  const logProcess = spawn("docker", ["logs", "-f", "minecraft"]);

  logProcess.stdout.on("data", (data) => {
    ws.send(data.toString());
  });

  logProcess.stderr.on("data", () => {
    ws.send("Error occurred.");
  });

  logProcess.on("close", (code) => {
    console.log(`logProcess exited with code ${code}`);
  });

  let messageCount = 0;
  let startTime = Date.now();

  ws.on("message", (message) => {
    const msgString = message.toString();
    const currentTime = Date.now();

    // Reset message count every second
    if (currentTime - startTime > 1000) {
      messageCount = 0;
      startTime = currentTime;
    }

    // Rate limiting
    if (messageCount >= MAX_MESSAGES_PER_SECOND) {
      ws.send("Rate limit exceeded. Please slow down.");
      return;
    }

    messageCount++;

    console.log(`Received message: ${msgString}`);

    if (!validateMessage(msgString)) {
      ws.send("Invalid input.");
      return;
    }

    if (msgString === "admincraft restart-server") {
      restartServer();
    } else {
      executeCommand(`docker exec minecraft send-command ${msgString}`);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    logProcess.kill();
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });

  ws.send(`${user.userId} connected`);
});
