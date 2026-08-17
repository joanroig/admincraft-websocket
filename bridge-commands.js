const { version: BRIDGE_VERSION } = require("./package.json");
const { hasScope } = require("./bridge-auth");

function availableCommands(scope, capabilities = []) {
  const commandByCapability = [
    ["help", "admincraft help"],
    ["status", "admincraft status"],
    ["health", "admincraft health"],
    ["info", "admincraft info"],
    ["uptime", "admincraft uptime"],
    ["version", "admincraft version"],
    ["logs", "admincraft logs [count]"],
  ];
  const commands = commandByCapability
    .filter(([capability]) => capabilities.includes(capability))
    .map(([, command]) => command);
  if (hasScope(scope, "admin")) {
    for (const action of ["start", "stop", "restart"]) {
      if (capabilities.includes(action)) {
        commands.push(`admincraft ${action}-server`);
      }
    }
  }
  return commands;
}

async function executeBridgeCommand(command, backend, context = {}) {
  const scope = context.scope || "admin";
  const capabilities = context.capabilities || backend.capabilities || [];
  switch (command) {
    case "admincraft help":
      return (
        "Admincraft bridge commands:\n" +
        availableCommands(scope, capabilities).join("\n")
      );
    case "admincraft status": {
      const status = await backend.status();
      return `Minecraft ${backend.edition} server status: ${status}.`;
    }
    case "admincraft health": {
      const health = await backend.health();
      return `Minecraft ${backend.edition} server health: ${health}.`;
    }
    case "admincraft info": {
      const [status, uptime] = await Promise.all([
        backend.status(),
        backend.uptime(),
      ]);
      return [
        `Admincraft WebSocket bridge v${BRIDGE_VERSION}`,
        `Protocol: ${context.protocol || 1}`,
        `Permission: ${scope}`,
        `Edition: ${backend.edition}`,
        `Container: ${backend.containerName || "unavailable"}`,
        `Server status: ${status}`,
        `Server uptime: ${uptime}`,
        `Capabilities: ${capabilities.join(", ")}`,
      ].join("\n");
    }
    case "admincraft uptime": {
      const uptime = await backend.uptime();
      return `Minecraft ${backend.edition} server uptime: ${uptime}.`;
    }
    case "admincraft version":
      return `Admincraft WebSocket bridge v${BRIDGE_VERSION}.`;
    case "admincraft start-server":
      if (!hasScope(scope, "admin")) {
        return "Permission denied: admin access required.";
      }
      await backend.start();
      return "Server start initiated.";
    case "admincraft stop-server":
      if (!hasScope(scope, "admin")) {
        return "Permission denied: admin access required.";
      }
      await backend.stop();
      return "Server stop initiated.";
    case "admincraft restart-server":
      if (!hasScope(scope, "admin")) {
        return "Permission denied: admin access required.";
      }
      await backend.restart();
      return "Server restart initiated.";
    default:
      if (
        command === "admincraft logs" ||
        command.startsWith("admincraft logs ")
      ) {
        const rawCount = command.slice("admincraft logs".length).trim();
        const count = rawCount === "" ? 250 : Number.parseInt(rawCount, 10);
        if (!Number.isInteger(count) || count < 1 || count > 1000) {
          return "Usage: admincraft logs [count], where count is 1 to 1000.";
        }
        if (typeof context.replayLogs !== "function") {
          return "Recent log replay is unavailable on this bridge.";
        }
        await context.replayLogs(count);
        return `Replayed up to ${count} recent server log lines.`;
      }
      if (command.startsWith("admincraft ")) {
        return "Unknown Admincraft bridge command. Run admincraft help.";
      }
      return null;
  }
}

module.exports = { availableCommands, executeBridgeCommand };
