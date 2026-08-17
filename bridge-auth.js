const jwt = require("jsonwebtoken");

const scopeRank = { readonly: 0, command: 1, admin: 2 };

function credentialsFromEnvironment(environment = process.env) {
  const credentials = [
    {
      scope: "admin",
      key: environment.ADMIN_SECRET_KEY || environment.SECRET_KEY,
    },
    { scope: "command", key: environment.COMMAND_SECRET_KEY },
    { scope: "readonly", key: environment.READ_ONLY_SECRET_KEY },
  ];
  const seen = new Set();
  return credentials.filter(({ key }) => {
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function authenticate(token, credentials) {
  for (const credential of credentials) {
    try {
      return {
        claims: jwt.verify(token, credential.key),
        scope: credential.scope,
      };
    } catch (_) {
      // Try the next configured scope. Only the final failure is reported by
      // the caller, so logs never reveal which scoped keys exist.
    }
  }
  return null;
}

function hasScope(actual, required) {
  return (scopeRank[actual] ?? -1) >= (scopeRank[required] ?? Infinity);
}

function capabilitiesFor(baseCapabilities, scope) {
  return baseCapabilities.filter((capability) => {
    if (["start", "stop", "restart"].includes(capability)) {
      return hasScope(scope, "admin");
    }
    if (capability === "commands") return hasScope(scope, "command");
    return true;
  });
}

module.exports = {
  authenticate,
  capabilitiesFor,
  credentialsFromEnvironment,
  hasScope,
};
