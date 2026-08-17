function isInternalStateReply(message) {
  return (
    /(?:Daytime is|The time is) \d+/u.test(message) ||
    /There are \d+(?:\/\d+| of a max of \d+) players online/u.test(message)
  );
}

function splitLogLine(line) {
  const separator = line.indexOf(" ");
  return {
    at: separator > 0 ? line.slice(0, separator) : "",
    message: separator > 0 ? line.slice(separator + 1) : line,
  };
}

// State observation is intentionally absent from the client transcript, but
// its replies still exist in Docker's raw log and can crowd useful history out
// of a small `docker logs --tail` window. Read a larger raw window, discard
// that noise, and only forward the requested number of meaningful lines.
function trimVisibleLogHistory(data, limit) {
  if (limit <= 0) return "";
  const visible = data.split(/\r?\n/u).filter((line) => {
    const { message } = splitLogLine(line);
    return message && !isInternalStateReply(message);
  });
  return visible.slice(-limit).join("\n");
}

module.exports = {
  isInternalStateReply,
  splitLogLine,
  trimVisibleLogHistory,
};
