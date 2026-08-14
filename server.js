const fs = require("fs");
const https = require("https");
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const path = require("path");
const { createBackend, validateMessage } = require("./minecraft-backend");

const SECRET_KEY = process.env.SECRET_KEY;
const USE_SSL = process.env.USE_SSL === "true";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const CERT_PATH = "./certs/server.crt";
const KEY_PATH = "./certs/server.key";
const MAX_MESSAGES_PER_SECOND = 5;
const MC_NAME = process.env.MC_NAME || "minecraft";
const SERVER_TYPE = (process.env.SERVER_TYPE || "bedrock").toLowerCase();

if (!SECRET_KEY) {
  throw new Error("SECRET_KEY is not defined.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const backend = createBackend({
  edition: SERVER_TYPE,
  containerName: MC_NAME,
  dockerEnabled: process.env.DOCKER_ENABLED !== "false",
  rconHost: process.env.RCON_HOST || MC_NAME,
  rconPort: Number.parseInt(process.env.RCON_PORT || "25575", 10),
  rconPassword: process.env.RCON_PASSWORD,
});

function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/getcert" && fs.existsSync(CERT_PATH)) {
    const certFilePath = path.join(__dirname, CERT_PATH);
    res.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="server.crt"',
    });
    fs.createReadStream(certFilePath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
}

function authenticate(token) {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (error) {
    console.error("Authentication error:", error.message);
    return null;
  }
}

let useSSL = USE_SSL;
if (useSSL && (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH))) {
  console.warn("SSL certificates not found. Starting without SSL.");
  useSSL = false;
}

const server = useSSL
  ? https.createServer(
      { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) },
      handleRequest,
    )
  : http.createServer(handleRequest);
const wss = new WebSocket.Server({ server });

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN && message) {
    ws.send(message.toString());
  }
}

wss.on("connection", (ws, request) => {
  const url = new URL(
    request.url,
    `${useSSL ? "wss" : "ws"}://${request.headers.host}`,
  );
  const user = authenticate(url.searchParams.get("token"));
  if (!user) {
    ws.close(4001, "Authentication failed");
    return;
  }

  // Older clients did not include an edition. They remain compatible with the
  // default Bedrock bridge, but cannot accidentally operate a Java bridge.
  const requestedEdition = user.edition || "bedrock";
  if (requestedEdition !== backend.edition) {
    send(
      ws,
      `Configuration error: profile is ${requestedEdition}, but this bridge is ${backend.edition}.`,
    );
    ws.close(
      4002,
      `Profile is ${requestedEdition}, but this bridge is ${backend.edition}`,
    );
    return;
  }

  console.log(`New ${backend.edition} client connected`);
  const logProcess = backend.followLogs(
    (data) => send(ws, data),
    (data) => send(ws, `Log error: ${data}`),
    (code) => console.log(`Log process exited with code ${code}`),
  );

  let messageCount = 0;
  let startTime = Date.now();

  ws.on("message", async (message) => {
    const command = message.toString();
    const currentTime = Date.now();
    if (currentTime - startTime > 1000) {
      messageCount = 0;
      startTime = currentTime;
    }
    if (messageCount >= MAX_MESSAGES_PER_SECOND) {
      send(ws, "Rate limit exceeded. Please slow down.");
      return;
    }
    messageCount += 1;

    if (!validateMessage(command)) {
      send(ws, "Invalid input.");
      return;
    }

    try {
      if (command === "admincraft restart-server") {
        await backend.restart();
        send(ws, "Server restart initiated.");
      } else {
        const response = await backend.execute(command);
        send(ws, response);
      }
    } catch (error) {
      console.error(`Command failed: ${error.message}`);
      send(ws, `Command failed: ${error.message}`);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (logProcess) logProcess.kill();
  });
  ws.on("error", (error) => console.error("WebSocket error:", error.message));

  send(
    ws,
    `${user.userId} connected to ${backend.edition} bridge (${backend.capabilities.join(", ")})`,
  );
});

server.listen(PORT, () => {
  console.log(
    `Admincraft ${backend.edition} bridge listening on port ${PORT}${useSSL ? " with SSL" : ""}`,
  );
});
