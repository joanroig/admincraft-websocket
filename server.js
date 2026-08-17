const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const path = require("path");
const {
  authenticate,
  capabilitiesFor,
  credentialsFromEnvironment,
  hasScope,
} = require("./bridge-auth");
const { executeBridgeCommand } = require("./bridge-commands");
const { createBackend, validateMessage } = require("./minecraft-backend");
const { version: BRIDGE_VERSION } = require("./package.json");

const USE_SSL = process.env.USE_SSL === "true";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const CERT_PATH = "./certs/server.crt";
const KEY_PATH = "./certs/server.key";
const MAX_MESSAGES_PER_SECOND = 5;
const MC_NAME = process.env.MC_NAME || "minecraft";
const SERVER_TYPE = (process.env.SERVER_TYPE || "bedrock").toLowerCase();

const credentials = credentialsFromEnvironment();
if (credentials.length === 0) {
  throw new Error(
    "Configure SECRET_KEY, ADMIN_SECRET_KEY, COMMAND_SECRET_KEY, or READ_ONLY_SECRET_KEY.",
  );
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

function sendEvent(ws, type, fields = {}) {
  send(ws, JSON.stringify({ type, ...fields }));
}

function eventId(stream, at, message) {
  return crypto
    .createHash("sha256")
    .update(`${stream}\0${at}\0${message}`)
    .digest("hex")
    .slice(0, 24);
}

function isInternalStateReply(message) {
  return (
    /(?:Daytime is|The time is) \d+/u.test(message) ||
    /There are \d+(?:\/\d+| of a max of \d+) players online/u.test(message)
  );
}

/// Converts Docker's `--timestamps` stream into complete, deduplicatable log
/// frames. Docker may split a line across arbitrary data chunks, so the final
/// fragment is retained until its newline arrives.
function createLogForwarder(ws, stream) {
  let remainder = "";

  function emit(line) {
    const separator = line.indexOf(" ");
    const at = separator > 0 ? line.slice(0, separator) : "";
    const message = separator > 0 ? line.slice(separator + 1) : line;
    if (!message || isInternalStateReply(message)) return;
    sendEvent(ws, "admincraft.log", {
      id: eventId(stream, at, message),
      at,
      stream,
      message,
    });
  }

  return {
    push(data) {
      const lines = `${remainder}${data}`.split(/\r?\n/u);
      remainder = lines.pop() || "";
      for (const line of lines) emit(line);
    },
    flush() {
      if (remainder) emit(remainder);
      remainder = "";
    },
  };
}

wss.on("connection", (ws, request) => {
  const url = new URL(
    request.url,
    `${useSSL ? "wss" : "ws"}://${request.headers.host}`,
  );
  const authenticated = authenticate(
    url.searchParams.get("token"),
    credentials,
  );
  if (!authenticated) {
    console.error("Authentication failed");
    ws.close(4001, "Authentication failed");
    return;
  }
  const user = authenticated.claims;
  const scope = authenticated.scope;
  const capabilities = capabilitiesFor(backend.capabilities, scope);

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

  const protocol = Number(user.protocol) >= 2 ? 2 : 1;
  const requestedTail = Number.parseInt(user.logTail, 10);
  const logTail = Number.isInteger(requestedTail)
    ? Math.max(0, Math.min(requestedTail, 1000))
    : 250;

  console.log(`New ${backend.edition} client connected`);
  if (protocol >= 2) {
    sendEvent(ws, "admincraft.hello", {
      protocol,
      edition: backend.edition,
      capabilities,
      scope,
      version: BRIDGE_VERSION,
      connectedAt: new Date().toISOString(),
    });
  } else {
    send(
      ws,
      `${user.userId} connected to ${backend.edition} bridge (${capabilities.join(", ")})`,
    );
  }

  const stdout = protocol >= 2 ? createLogForwarder(ws, "stdout") : null;
  const stderr = protocol >= 2 ? createLogForwarder(ws, "stderr") : null;
  let closed = false;
  let logProcess = null;
  let logRetry = null;
  let stateTimer = null;
  let stateCheckInFlight = false;
  let lastServerState = null;
  let replayingHistory = protocol >= 2;
  const pendingLiveLogs = [];

  function forwardLiveLog(stream, data) {
    if (replayingHistory) {
      pendingLiveLogs.push({ stream, data });
      return;
    }
    (stream === "stdout" ? stdout : stderr)?.push(data);
  }

  async function replayLogs(tail, { signalComplete = true } = {}) {
    const history = await backend.readLogs({ tail, timestamps: true });
    if (closed) return;
    const historyStdout = createLogForwarder(ws, "stdout");
    const historyStderr = createLogForwarder(ws, "stderr");
    historyStdout.push(history.stdout || "");
    historyStderr.push(history.stderr || "");
    historyStdout.flush();
    historyStderr.flush();
    if (signalComplete) {
      sendEvent(ws, "admincraft.history-complete", {
        requested: tail,
        manual: true,
      });
    }
  }

  function attachLogs() {
    if (closed || ws.readyState !== WebSocket.OPEN) return;
    logProcess = backend.followLogs(
      (data) => (stdout ? forwardLiveLog("stdout", data) : send(ws, data)),
      (data) =>
        stderr
          ? forwardLiveLog("stderr", data)
          : send(ws, `Log error: ${data}`),
      (code) => {
        stdout?.flush();
        stderr?.flush();
        logProcess = null;
        console.log(`Log process exited with code ${code}`);
        // Stopping Minecraft also ends `docker logs --follow`, but the bridge
        // remains reachable so the same client can start it again. Reattach
        // until the container returns instead of requiring a reconnect.
        if (!closed) {
          logRetry = setTimeout(attachLogs, 2000);
          logRetry.unref?.();
        }
      },
      // Protocol v2 replays an explicit snapshot below. Starting the follower
      // first and buffering it prevents lines written during that snapshot
      // from falling into a gap between two Docker commands.
      { tail: 0, timestamps: protocol >= 2 },
    );
  }

  attachLogs();

  if (protocol >= 2) {
    Promise.resolve(replayLogs(logTail, { signalComplete: false }))
      .catch((error) => {
        console.error(`Could not read initial log history: ${error.message}`);
        sendEvent(ws, "admincraft.history-error", {
          message: "Recent server logs could not be loaded.",
        });
      })
      .finally(() => {
        if (closed) return;
        replayingHistory = false;
        for (const { stream, data } of pendingLiveLogs.splice(0)) {
          (stream === "stdout" ? stdout : stderr)?.push(data);
        }
        sendEvent(ws, "admincraft.history-complete", { requested: logTail });
      });

    const observeServerState = async () => {
      if (closed || stateCheckInFlight) return;
      stateCheckInFlight = true;
      try {
        const observation = await backend.observeState();
        const fingerprint = JSON.stringify(observation);
        if (fingerprint !== lastServerState) {
          lastServerState = fingerprint;
          sendEvent(ws, "admincraft.server-state", {
            ...observation,
            observedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (lastServerState !== "unknown") {
          lastServerState = "unknown";
          sendEvent(ws, "admincraft.server-state", {
            state: "unknown",
            observedAt: new Date().toISOString(),
          });
        }
        console.error(`Could not observe server state: ${error.message}`);
      } finally {
        stateCheckInFlight = false;
      }
    };
    void observeServerState();
    stateTimer = setInterval(observeServerState, 30000);
    stateTimer.unref?.();
  }

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
      console.log(`Command from ${user.userId} [${scope}]: ${command}`);
      if (command === "admincraft ping") {
        protocol >= 2
          ? sendEvent(ws, "admincraft.pong")
          : send(ws, "Admincraft pong");
      } else {
        const bridgeResponse = await executeBridgeCommand(command, backend, {
          capabilities,
          protocol,
          replayLogs,
          scope,
        });
        const response =
          bridgeResponse === null
            ? hasScope(scope, "command")
              ? await backend.execute(command)
              : "Permission denied: command access required."
            : bridgeResponse;
        send(ws, response);
      }
    } catch (error) {
      console.error(`Command failed: ${error.message}`);
      send(ws, `Command failed: ${error.message}`);
    }
  });

  ws.on("close", () => {
    closed = true;
    console.log("Client disconnected");
    stdout?.flush();
    stderr?.flush();
    if (logRetry) clearTimeout(logRetry);
    if (stateTimer) clearInterval(stateTimer);
    if (logProcess) logProcess.kill();
  });
  ws.on("error", (error) => console.error("WebSocket error:", error.message));
});

server.listen(PORT, () => {
  console.log(
    `Admincraft ${backend.edition} bridge listening on port ${PORT}${useSSL ? " with SSL" : ""}`,
  );
});
