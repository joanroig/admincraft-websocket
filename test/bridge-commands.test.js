const assert = require("node:assert/strict");
const test = require("node:test");
const { executeBridgeCommand } = require("../bridge-commands");
const { version } = require("../package.json");

function diagnosticBackend() {
  return {
    capabilities: ["logs", "commands", "status"],
    containerName: "minecraft",
    edition: "bedrock",
    health: async () => "healthy",
    status: async () => "running",
    uptime: async () => "2h 5m",
  };
}

test("reports the Minecraft server status", async () => {
  const response = await executeBridgeCommand("admincraft status", {
    edition: "bedrock",
    status: async () => "running",
  });

  assert.equal(response, "Minecraft bedrock server status: running.");
});

test("reports the installed bridge version", async () => {
  const response = await executeBridgeCommand("admincraft version", {});

  assert.equal(response, `Admincraft WebSocket bridge v${version}.`);
});

test("help and info reflect the authenticated scope", async () => {
  const backend = diagnosticBackend();
  const help = await executeBridgeCommand("admincraft help", backend, {
    scope: "readonly",
  });
  const info = await executeBridgeCommand("admincraft info", backend, {
    capabilities: backend.capabilities,
    protocol: 2,
    scope: "readonly",
  });

  assert.match(help, /admincraft logs \[count\]/);
  assert.doesNotMatch(help, /restart-server/);
  assert.match(info, /Permission: readonly/);
  assert.match(info, /Server uptime: 2h 5m/);
});

test("manual log replay validates and forwards the requested count", async () => {
  let replayed;
  const context = {
    replayLogs: async (count) => {
      replayed = count;
    },
  };

  assert.equal(
    await executeBridgeCommand("admincraft logs 50", {}, context),
    "Replayed up to 50 recent server log lines.",
  );
  assert.equal(replayed, 50);
  assert.match(
    await executeBridgeCommand("admincraft logs 5000", {}, context),
    /1 to 1000/,
  );
});

test("lifecycle commands require admin scope", async () => {
  let restarted = false;
  const response = await executeBridgeCommand(
    "admincraft restart-server",
    { restart: async () => (restarted = true) },
    { scope: "command" },
  );

  assert.equal(response, "Permission denied: admin access required.");
  assert.equal(restarted, false);
});

test("leaves Minecraft commands to the edition backend", async () => {
  assert.equal(await executeBridgeCommand("list", {}), null);
});

test("unknown bridge commands never fall through to Minecraft", async () => {
  const backend = diagnosticBackend();
  assert.match(
    await executeBridgeCommand("admincraft status extra", backend, {
      scope: "admin",
      capabilities: backend.capabilities,
    }),
    /Unknown Admincraft bridge command/u,
  );
});
