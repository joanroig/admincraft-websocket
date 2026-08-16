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

function runFile(execFileImpl, file, args) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, (error, stdout = "", stderr = "") => {
      if (error) {
        const detail = stderr.toString().trim() || error.message;
        reject(new Error(detail));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function dockerTools(containerName, enabled, dependencies) {
  const execFileImpl = dependencies.execFile || execFile;
  const spawnImpl = dependencies.spawn || spawn;

  return {
    async restart() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["restart", containerName]);
    },

    followLogs(onData, onError, onClose) {
      if (!enabled) return null;
      // Only forward lines produced after this client connected. Replaying the
      // container's full log polluted every new app session with old command
      // replies and made the console jump while thousands of lines arrived.
      const process = spawnImpl("docker", [
        "logs",
        "--follow",
        "--tail",
        "0",
        containerName,
      ]);
      process.stdout.on("data", (data) => onData(data.toString()));
      process.stderr.on("data", (data) => onError(data.toString()));
      process.on("close", onClose);
      return process;
    },
  };
}

function createBedrockBackend(config, dependencies = {}) {
  const containerName = config.containerName || "minecraft";
  const docker = dockerTools(containerName, true, dependencies);
  const execFileImpl = dependencies.execFile || execFile;

  return {
    edition: "bedrock",
    capabilities: ["commands", "logs", "restart"],
    execute(command) {
      return runFile(execFileImpl, "docker", [
        "exec",
        containerName,
        "send-command",
        command,
      ]);
    },
    restart: docker.restart,
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

  return {
    edition: "java",
    capabilities: [
      "commands",
      ...(dockerEnabled ? ["logs", "restart"] : []),
    ],
    async execute(command) {
      const client = await Rcon.connect({
        host: config.rconHost || containerName,
        port: config.rconPort || 25575,
        password: config.rconPassword,
      });
      try {
        return (await client.send(command)) || "";
      } finally {
        client.end();
      }
    },
    restart: docker.restart,
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
};
