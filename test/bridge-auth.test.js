const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const {
  authenticate,
  capabilitiesFor,
  credentialsFromEnvironment,
  hasScope,
} = require("../bridge-auth");

test("legacy SECRET_KEY remains an admin credential", () => {
  const credentials = credentialsFromEnvironment({ SECRET_KEY: "legacy" });
  const authenticated = authenticate(
    jwt.sign({ userId: "Admincraft" }, "legacy"),
    credentials,
  );

  assert.equal(authenticated.scope, "admin");
  assert.equal(authenticated.claims.userId, "Admincraft");
});

test("scoped credentials expose only permitted capabilities", () => {
  const base = ["logs", "commands", "status", "start", "stop", "restart"];

  assert.deepEqual(capabilitiesFor(base, "readonly"), ["logs", "status"]);
  assert.deepEqual(capabilitiesFor(base, "command"), [
    "logs",
    "commands",
    "status",
  ]);
  assert.deepEqual(capabilitiesFor(base, "admin"), base);
  assert.equal(hasScope("command", "admin"), false);
  assert.equal(hasScope("admin", "command"), true);
});
