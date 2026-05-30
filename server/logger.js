// In-memory ring buffer that captures all console output.
// Must be required before any other module so the patches are in place first.

const MAX = 500;
const buffer = [];

function push(level, args) {
  buffer.push({ level, msg: args.map(String).join(" "), ts: Date.now() });
  if (buffer.length > MAX) buffer.shift();
}

const orig = { log: console.log, warn: console.warn, error: console.error };
console.log   = (...a) => { orig.log(...a);   push("info",  a); };
console.warn  = (...a) => { orig.warn(...a);  push("warn",  a); };
console.error = (...a) => { orig.error(...a); push("error", a); };

function getLogs(limit = 200) {
  return buffer.slice(-Math.min(limit, MAX));
}

module.exports = { getLogs };
