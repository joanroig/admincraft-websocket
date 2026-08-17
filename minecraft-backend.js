const { execFile, spawn } = require("child_process");

const MAX_COMMAND_LENGTH = 2048;

function validateMessage(message) {
  return (
    typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= MAX_COMMAND_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(message)
  );
}

function runFileOutput(execFileImpl, file, args) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, (error, stdout = "", stderr = "") => {
      if (error) {
        const detail = stderr.toString().trim() || error.message;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function runFile(execFileImpl, file, args) {
  const output = await runFileOutput(execFileImpl, file, args);
  return output.stdout;
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "unknown";
  const units = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
    [1, "s"],
  ];
  let remaining = Math.floor(totalSeconds);
  const parts = [];
  for (const [seconds, label] of units) {
    const value = Math.floor(remaining / seconds);
    if (value > 0 || (label === "s" && parts.length === 0)) {
      parts.push(`${value}${label}`);
      remaining %= seconds;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

function parseObservedState(edition, daytimeOutput, playersOutput) {
  const daytimePattern =
    edition === "java" ? /The time is (\d+)/u : /Daytime is (\d+)/u;
  const playersPattern =
    edition === "java"
      ? /There are (\d+) of a max of (\d+) players online(?::\s*(.*))?/u
      : /There are (\d+)\/(\d+) players online(?::\s*(.*))?/u;
  const lastMatch = (pattern, output) => {
    const lines = output.split(/\r?\n/u);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const match = pattern.exec(lines[index]);
      if (match) return match;
    }
    return null;
  };
  const daytimeMatch = lastMatch(daytimePattern, daytimeOutput);
  const playersMatch = lastMatch(playersPattern, playersOutput);
  const result = {};
  if (daytimeMatch) result.daytime = Number.parseInt(daytimeMatch[1], 10);
  if (playersMatch) {
    result.playersOnline = Number.parseInt(playersMatch[1], 10);
    result.playerLimit = Number.parseInt(playersMatch[2], 10);
    result.onlinePlayers = (playersMatch[3] || "")
      .split(",")
      .map((player) => player.trim())
      .filter(Boolean);
  }
  return result;
}

function normalizeDifficulty(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const aliases = {
    "0": "peaceful",
    p: "peaceful",
    peaceful: "peaceful",
    "1": "easy",
    e: "easy",
    easy: "easy",
    "2": "normal",
    n: "normal",
    normal: "normal",
    "3": "hard",
    h: "hard",
    hard: "hard",
  };
  return aliases[normalized] || null;
}

function difficultyFromCommand(command) {
  const match = /^\/?difficulty\s+(\S+)\s*$/iu.exec(command);
  return match ? normalizeDifficulty(match[1]) : null;
}

function dockerTools(containerName, enabled, dependencies) {
  const execFileImpl = dependencies.execFile || execFile;
  const spawnImpl = dependencies.spawn || spawn;

  return {
    async status() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{.State.Status}}",
        containerName,
      ]);
      return output.trim() || "unknown";
    },

    async health() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerName,
      ]);
      return output.trim() || "unknown";
    },

    async uptime() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{.State.StartedAt}}",
        containerName,
      ]);
      const startedAt = Date.parse(output.trim());
      return Number.isNaN(startedAt)
        ? "unknown"
        : formatDuration((Date.now() - startedAt) / 1000);
    },

    async start() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["start", containerName]);
    },

    async stop() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["stop", containerName]);
    },

    async restart() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["restart", containerName]);
    },

    async readServerProperty(name) {
      if (!enabled) return null;
      try {
        const contents = await runFile(execFileImpl, "docker", [
          "exec",
          containerName,
          "cat",
          "/data/server.properties",
        ]);
        for (const rawLine of contents.split(/\r?\n/u)) {
          const line = rawLine.trim();
          if (line.startsWith("#")) continue;
          const separator = line.indexOf("=");
          if (separator < 0) continue;
          if (line.slice(0, separator).trim() === name) {
            return line.slice(separator + 1).trim();
          }
        }
      } catch {
        // A custom image may keep its configuration elsewhere. State polling
        // should still return time and players instead of failing wholesale.
      }
      return null;
    },

    followLogs(onData, onError, onClose, options = {}) {
      if (!enabled) return null;
      const tail = Number.isInteger(options.tail)
        ? Math.max(0, Math.min(options.tail, 1000))
        : 0;
      const args = [
        "logs",
        "--follow",
        "--tail",
        String(tail),
      ];
      // Protocol v2 uses Docker's stable per-line timestamp as an event id.
      // That lets a reconnect replay a useful tail while clients discard the
      // overlap they have already saved. Legacy clients retain --tail 0.
      if (options.timestamps) args.push("--timestamps");
      args.push(containerName);
      const process = spawnImpl("docker", args);
      process.stdout.on("data", (data) => onData(data.toString()));
      process.stderr.on("data", (data) => onError(data.toString()));
      process.on("close", onClose);
      return process;
    },

    async readLogs(options = {}) {
      if (!enabled) return { stdout: "", stderr: "" };
      const tail = Number.isInteger(options.tail)
        ? Math.max(0, Math.min(options.tail, 10000))
        : 250;
      const args = ["logs", "--tail", String(tail)];
      if (options.timestamps) args.push("--timestamps");
      args.push(containerName);
      return runFileOutput(execFileImpl, "docker", args);
    },
  };
}

function createBedrockBackend(config, dependencies = {}) {
  const containerName = config.containerName || "minecraft";
  const docker = dockerTools(containerName, true, dependencies);
  const execFileImpl = dependencies.execFile || execFile;
  const waitForCommandOutput =
    dependencies.waitForCommandOutput ||
    (() => new Promise((resolve) => setTimeout(resolve, 150)));

  let observedDifficulty = null;

  async function backendExecute(command) {
    const response = await runFile(execFileImpl, "docker", [
      "exec",
      containerName,
      "send-command",
      command,
    ]);
    observedDifficulty = difficultyFromCommand(command) || observedDifficulty;
    return response;
  }

  return {
    edition: "bedrock",
    capabilities: [
      "commands",
      "logs",
      "status",
      "version",
      "help",
      "health",
      "info",
      "uptime",
      "state",
      "start",
      "stop",
      "restart",
    ],
    execute: backendExecute,
    async observeState() {
      const status = await docker.status();
      if (status !== "running") return { state: status };
      await Promise.all([
        backendExecute("time query daytime"),
        backendExecute("list"),
      ]);
      // The Bedrock container's send-command helper writes to the server's
      // stdin and returns before the reply reaches stdout. Read the latest
      // bounded log tail after that reply lands instead of treating the empty
      // helper output as an unknown state.
      await waitForCommandOutput();
      const [recentLogs, configuredDifficulty] = await Promise.all([
        docker.readLogs({ tail: 80 }),
        docker.readServerProperty("difficulty"),
      ]);
      observedDifficulty =
        observedDifficulty || normalizeDifficulty(configuredDifficulty);
      const observedOutput = `${recentLogs.stdout}\n${recentLogs.stderr}`;
      return {
        state: status,
        ...parseObservedState("bedrock", observedOutput, observedOutput),
        ...(observedDifficulty ? { difficulty: observedDifficulty } : {}),
      };
    },
    start: docker.start,
    stop: docker.stop,
    restart: docker.restart,
    status: docker.status,
    health: docker.health,
    uptime: docker.uptime,
    containerName,
    readLogs: docker.readLogs,
    followLogs: docker.followLogs,
  };
}

function createJavaBackend(config, dependencies = {}) {
  const Rcon = dependencies.Rcon || require("rcon-client").Rcon;
  const containerName = config.containerName || "minecraft";
  const dockerEnabled = config.dockerEnabled !== false;
  const docker = dockerTools(containerName, dockerEnabled, dependencies);

  if (!config.rconPassword) {
    throw new Error("RCON_PASSWORD is required when SERVER_TYPE is java.");
  }

  let observedDifficulty = null;

  async function backendExecute(command) {
    const client = await Rcon.connect({
      host: config.rconHost || containerName,
      port: config.rconPort || 25575,
      password: config.rconPassword,
    });
    try {
      const response = (await client.send(command)) || "";
      observedDifficulty = difficultyFromCommand(command) || observedDifficulty;
      return response;
    } finally {
      client.end();
    }
  }

  return {
    edition: "java",
    capabilities: [
      "commands",
      "status",
      "version",
      "help",
      "health",
      "info",
      "uptime",
      "state",
      ...(dockerEnabled ? ["logs", "start", "stop", "restart"] : []),
    ],
    execute: backendExecute,
    async observeState() {
      const status = dockerEnabled ? await docker.status() : "reachable";
      if (dockerEnabled && status !== "running") return { state: status };
      const [daytime, players, configuredDifficulty] = await Promise.all([
        backendExecute("time query daytime"),
        backendExecute("list"),
        docker.readServerProperty("difficulty"),
      ]);
      observedDifficulty =
        observedDifficulty || normalizeDifficulty(configuredDifficulty);
      return {
        state: status,
        ...parseObservedState("java", daytime, players),
        ...(observedDifficulty ? { difficulty: observedDifficulty } : {}),
      };
    },
    start: docker.start,
    stop: docker.stop,
    restart: docker.restart,
    status: docker.status,
    health: dockerEnabled
      ? docker.health
      : async () => {
          await backendExecute("list");
          return "reachable over RCON";
        },
    uptime: docker.uptime,
    containerName,
    readLogs: docker.readLogs,
    followLogs: docker.followLogs,
  };
}

function createBackend(config, dependencies = {}) {
  if (config.edition === "java") {
    return createJavaBackend(config, dependencies);
  }
  if (config.edition === "bedrock") {
    return createBedrockBackend(config, dependencies);
  }
  throw new Error(`Unsupported SERVER_TYPE: ${config.edition}`);
}

module.exports = {
  createBackend,
  createBedrockBackend,
  createJavaBackend,
  validateMessage,
  formatDuration,
  parseObservedState,
  normalizeDifficulty,
};
