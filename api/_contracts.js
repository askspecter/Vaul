// Contract addresses for the API, read from the site's own config.js so there is one place to
// change them. Env vars (LAUNCHER, EXTERNAL_LAUNCHER, RPC_URL) override it when set.
const fs = require("fs");
const path = require("path");

let cached;
function fromConfig() {
  if (cached) return cached;
  let src = "";
  try { src = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8"); } catch { /* not bundled */ }
  const pick = (key) => (src.match(new RegExp(`\\b${key}:\\s*"([^"]*)"`)) || [])[1] || "";
  cached = { launcher: pick("launcher"), externalLauncher: pick("externalLauncher"), rpcUrl: pick("rpcUrl") };
  return cached;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const valid = (a) => (ADDRESS_RE.test(a || "") ? a : "");

function contracts() {
  const c = fromConfig();
  return {
    rpcUrl: process.env.RPC_URL || c.rpcUrl || "https://rpc.mainnet.chain.robinhood.com",
    launcher: valid(process.env.LAUNCHER || c.launcher),
    externalLauncher: valid(process.env.EXTERNAL_LAUNCHER || c.externalLauncher),
  };
}

module.exports = { contracts };
