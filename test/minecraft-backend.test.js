const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  createBedrockBackend,
  createJavaBackend,
  formatDuration,
  normalizeDifficulty,
  parseObservedState,
  validateMessage,
} = require("../minecraft-backend");

test("structured observations parse Bedrock and Java world state", () => {
  assert.deepEqual(
    parseObservedState(
      "bedrock",
      "Daytime is 7076",
      "There are 2/10 players online: Alex, Steve",
    ),
    {
      daytime: 7076,
      playersOnline: 2,
      playerLimit: 10,
      onlinePlayers: ["Alex", "Steve"],
    },
  );
  assert.deepEqual(
    parseObservedState(
      "java",
      "The time is 12000",
      "There are 0 of a max of 20 players online:",
    ),
    {
      daytime: 12000,
      playersOnline: 0,
      playerLimit: 20,
      onlinePlayers: [],
    },
  );
});

test("difficulty values normalize from names, aliases, and numeric levels", () => {
  assert.equal(normalizeDifficulty("normal"), "normal");
  assert.equal(normalizeDifficulty("H"), "hard");
  assert.equal(normalizeDifficulty("0"), "peaceful");
  assert.equal(normalizeDifficulty("invalid"), null);
});

test("Bedrock state reads difficulty without issuing an invalid command", async () => {
  const commands = [];
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        if (args[0] === "inspect") return callback(null, "running\n", "");
        if (args[0] === "logs") {
          return callback(
            null,
            "[INFO] Daytime is 7076\n[INFO] There are 0/10 players online:\n",
            "",
          );
        }
        if (args.includes("cat")) {
          return callback(null, "server-name=Test\ndifficulty=normal\n", "");
        }
        const command = args.at(-1);
        commands.push(command);
        return callback(null, "", "");
      },
      waitForCommandOutput: async () => {},
    },
  );

  const state = await backend.observeState();
  assert.equal(state.daytime, 7076);
  assert.equal(state.playersOnline, 0);
  assert.equal(state.difficulty, "normal");
  assert.deepEqual(commands, ["time query daytime", "list"]);
});

test("accepts Minecraft syntax without allowing control characters", () => {
  assert.equal(validateMessage("give @a minecraft:stone 1"), true);
  assert.equal(validateMessage("say Olá, miners!"), true);
  assert.equal(validateMessage("say first\nstop"), false);
  assert.equal(validateMessage(""), false);
});

test("Bedrock commands use argument-safe docker execution", async () => {
  let invocation;
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        invocation = { file, args };
        callback(null, "ok", "");
      },
    },
  );

  assert.equal(await backend.execute("give @a stone 1"), "ok");
  assert.deepEqual(invocation, {
    file: "docker",
    args: ["exec", "bedrock-server", "send-command", "give @a stone 1"],
  });
});

test("legacy log streaming follows only lines produced after connection", () => {
  let invocation;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      spawn(file, args) {
        invocation = { file, args };
        return child;
      },
    },
  );

  assert.equal(backend.followLogs(() => {}, () => {}, () => {}), child);
  assert.deepEqual(invocation, {
    file: "docker",
    args: ["logs", "--follow", "--tail", "0", "bedrock-server"],
  });
});

test("protocol v2 log streaming includes a bounded timestamped backlog", () => {
  let invocation;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      spawn(file, args) {
        invocation = { file, args };
        return child;
      },
    },
  );

  backend.followLogs(() => {}, () => {}, () => {}, {
    tail: 250,
    timestamps: true,
  });
  assert.deepEqual(invocation, {
    file: "docker",
    args: [
      "logs",
      "--follow",
      "--tail",
      "250",
      "--timestamps",
      "bedrock-server",
    ],
  });
});

test("initial log history is read as a bounded timestamped snapshot", async () => {
  let invocation;
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        invocation = { file, args };
        callback(null, "2026-08-17T10:00:00Z Server ready\n", "");
      },
    },
  );

  const history = await backend.readLogs({ tail: 250, timestamps: true });
  assert.deepEqual(invocation, {
    file: "docker",
    args: [
      "logs",
      "--tail",
      "250",
      "--timestamps",
      "bedrock-server",
    ],
  });
  assert.deepEqual(history, {
    stdout: "2026-08-17T10:00:00Z Server ready\n",
    stderr: "",
  });
});

test("history reader permits an amplified raw window for filtered replay", async () => {
  let invocation;
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        invocation = { file, args };
        callback(null, "", "");
      },
    },
  );

  await backend.readLogs({ tail: 10000, timestamps: true });
  assert.deepEqual(invocation.args, [
    "logs",
    "--tail",
    "10000",
    "--timestamps",
    "bedrock-server",
  ]);
});

test("Docker-backed servers report status and support lifecycle controls", async () => {
  const invocations = [];
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        invocations.push({ file, args });
        callback(null, args[0] === "inspect" ? "running\n" : "", "");
      },
    },
  );

  assert.equal(await backend.status(), "running");
  await backend.start();
  await backend.stop();
  await backend.restart();
  assert.deepEqual(invocations, [
    {
      file: "docker",
      args: [
        "inspect",
        "--format",
        "{{.State.Status}}",
        "bedrock-server",
      ],
    },
    { file: "docker", args: ["start", "bedrock-server"] },
    { file: "docker", args: ["stop", "bedrock-server"] },
    { file: "docker", args: ["restart", "bedrock-server"] },
  ]);
});

test("Docker health uses the container healthcheck and uptime is compact", async () => {
  const invocations = [];
  const backend = createBedrockBackend(
    { containerName: "bedrock-server" },
    {
      execFile(file, args, callback) {
        invocations.push({ file, args });
        callback(null, "healthy\n", "");
      },
    },
  );

  assert.equal(await backend.health(), "healthy");
  assert.deepEqual(invocations[0].args, [
    "inspect",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    "bedrock-server",
  ]);
  assert.equal(formatDuration(90061), "1d 1h");
  assert.equal(formatDuration(65), "1m 5s");
});

test("Java commands use RCON and close the connection", async () => {
  let options;
  let command;
  let ended = false;
  const backend = createJavaBackend(
    {
      containerName: "java-server",
      dockerEnabled: false,
      rconHost: "java.internal",
      rconPort: 25576,
      rconPassword: "secret",
    },
    {
      Rcon: {
        async connect(received) {
          options = received;
          return {
            async send(receivedCommand) {
              command = receivedCommand;
              return "There are 0 of a max of 20 players online:";
            },
            end() {
              ended = true;
            },
          };
        },
      },
    },
  );

  const response = await backend.execute("list");
  assert.deepEqual(options, {
    host: "java.internal",
    port: 25576,
    password: "secret",
  });
  assert.equal(command, "list");
  assert.match(response, /20 players/);
  assert.equal(ended, true);
  assert.equal(
    await backend.status(),
    "unavailable (Docker management is disabled)",
  );
  assert.deepEqual(backend.capabilities, [
    "commands",
    "status",
    "version",
    "help",
    "health",
    "info",
    "uptime",
    "state",
  ]);
});

test("Java RCON requires a password", () => {
  assert.throws(
    () => createJavaBackend({ dockerEnabled: false }, { Rcon: {} }),
    /RCON_PASSWORD/,
  );
});
