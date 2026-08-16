const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  createBedrockBackend,
  createJavaBackend,
  validateMessage,
} = require("../minecraft-backend");

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

test("log streaming follows only lines produced after connection", () => {
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
  assert.deepEqual(backend.capabilities, ["commands"]);
});

test("Java RCON requires a password", () => {
  assert.throws(
    () => createJavaBackend({ dockerEnabled: false }, { Rcon: {} }),
    /RCON_PASSWORD/,
  );
});
