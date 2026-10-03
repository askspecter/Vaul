import {
  CONFIG, ABI, client, $, esc, toast, renderChrome, connect, walletClient, getAccount, onAccount,
  isAddress, getAddress, addrLink, txLink, eth, collectionKey, collectionMeta, base58Decode,
} from "../lib.js";
import { parseAbi, encodeDeployData } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";

renderChrome("");

const REGISTRY_ADMIN = parseAbi([
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function treasury() view returns (address)",
  "function isCollection(address) view returns (bool)",
  "function setMarketplace(address marketplace, bool allowed)",
  "function setCollection(address collection, bool listed)",
  "function setKeeper(address keeper)",
]);
const ERC165 = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC721_ID = "0x80ac58cd";
const PROGRESS_KEY = "vaul-deploy";

let registry = null;

/** The Launcher to manage: the one deployed from this page, else the one in config.js. */
const myLauncher = () => saved().launcher || CONFIG.launcher;

const saved = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    if (p.seaport === true) p.seaport = "yes"; // progress saved by the first version of this page
    return p;
  } catch { return {}; }
};
const save = (v) => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...saved(), ...v })); } catch {} };

function logStep(text, href) {
  const li = document.createElement("li");
  li.innerHTML = href ? `${esc(text)} — <a href="${href}" target="_blank" rel="noopener">tx</a>` : esc(text);
  $("#deployLog").append(li);
}

async function mustChain() {
  const id = await (await walletClient()).getChainId();
  if (id !== CONFIG.chainId) throw new Error(`Switch your wallet to ${CONFIG.chainName} (chain ${CONFIG.chainId})`);
}

// Wallets on Arbitrum-based chains sometimes under-estimate gas for large deployments,
// so estimate against the RPC ourselves and add a 30% margin.
const withMargin = (g) => (g * 13n) / 10n;

async function send(label, req) {
  const wallet = await walletClient();
  const { request } = await client.simulateContract({ account: wallet.account, ...req });
  const gas = withMargin(await client.estimateContractGas({ account: wallet.account, ...req }));
  const hash = await wallet.writeContract({ ...request, gas });
  logStep(`${label}: sent`, txLink(hash));
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

async function deploy(label, artifact, args) {
  return deployTo(logStep, label, artifact, args);
}

async function deployTo(log, label, artifact, args) {
  const wallet = await walletClient();
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  // Estimating also surfaces a revert reason before anything is sent.
  const gas = withMargin(await client.estimateGas({ account: wallet.account, data }));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, gas });
  log(`${label}: sent (gas limit ${gas})`, txLink(hash));
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) {
    throw new Error(`${label} deploy failed (used ${r.gasUsed} of ${gas} gas) — tap the tx link for details`);
  }
  return r;
}

function showResult({ registry, launcher, block }) {
  $("#deployResult").innerHTML = `
    <h4>Deployed ✓</h4>
    <dl class="addresses">
      <dt>Registry</dt><dd>${addrLink(registry, registry)}</dd>
      <dt>Launcher</dt><dd>${addrLink(launcher, launcher)}</dd>
      <dt>Start block</dt><dd class="mono">${block}</dd>
    </dl>
    <p class="muted">Put these in <code>config.js</code> on GitHub (or send them to your developer), and set the keeper's <code>LAUNCHER</code> / <code>START_BLOCK</code> secrets:</p>
    <pre class="snippet" id="snippet">launcher: "${launcher}",\nstartBlock: ${block},</pre>
    <button class="btn btn-ghost" id="copy">Copy</button>`;
  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#snippet").textContent); toast("Copied"); } catch { toast("Copy failed — select the text manually"); }
  });
}

$("#deploy").addEventListener("click", async (e) => {
  const keeper = $("#keeper").value.trim();
  const treasury = $("#treasury").value.trim();
  if (!isAddress(keeper) || !isAddress(treasury)) return toast("Enter valid keeper and treasury addresses");
  const btn = e.target;
  btn.disabled = true;
  $("#deployLog").innerHTML = "";
  try {
    const owner = getAccount() || (await connect());
    await mustChain();
    if (getAddress(keeper) === owner) throw new Error("Use a separate wallet for the keeper, not the owner");
    const artifacts = await (await fetch("artifacts/deploy.json")).json();
    const escrow = await client.readContract({
      address: CONFIG.ponsFactory, abi: parseAbi(["function feeEscrow() view returns (address)"]), functionName: "feeEscrow",
    });

    // Every step is saved, so an interrupted deploy resumes where it stopped.
    // Each transaction stays under ~1.1M gas so mobile wallets can send it.
    let p = saved();
    if (p.owner !== owner) { p = { owner }; save(p); }
    const step = async (key, label, fn) => {
      if (p[key]) return logStep(`${label}: done (${p[key]})`), p[key];
      const value = await fn();
      p[key] = value;
      save({ [key]: value });
      logStep(`${label}: ${value}`);
      return value;
    };

    const reg = await step("registry", "Registry", async () => {
      const r = await deploy("Registry", artifacts.Registry, [owner, getAddress(keeper), getAddress(treasury)]);
      save({ block: Number(r.blockNumber) });
      p.block = Number(r.blockNumber);
      return r.contractAddress;
    });
    await step("seaport", "Allow Seaport 1.6", async () => {
      await send("Allow Seaport 1.6", { address: reg, abi: REGISTRY_ADMIN, functionName: "setMarketplace", args: [CONFIG.seaport, true] });
      return "yes";
    });
    const raffles = await step("raffles", "Raffles", async () =>
      (await deploy("Raffles", artifacts.Raffles, [reg])).contractAddress);
    const vaultImpl = await step("vaultImpl", "Vault template", async () =>
      (await deploy("Vault template", artifacts.SweepVault, [reg, raffles])).contractAddress);
    const routerImpl = await step("routerImpl", "Fee router template", async () =>
      (await deploy("Fee router template", artifacts.FeeRouter, [reg, escrow])).contractAddress);
    const launcher = await step("launcher", "Launcher", async () =>
      (await deploy("Launcher", artifacts.Launcher, [CONFIG.ponsFactory, reg, vaultImpl, routerImpl])).contractAddress);
    const block = p.block;
    registry = reg;
    showResult({ registry: reg, launcher, block });
    await refreshRegistry();
  } catch (err) {
    toast(err.shortMessage || err.message);
    logStep(`Stopped: ${err.shortMessage || err.message}`);
  } finally {
    btn.disabled = false;
  }
});

async function refreshRegistry() {
  if (!registry && isAddress(myLauncher() || "")) {
    registry = await client.readContract({ address: myLauncher(), abi: ABI.launcher, functionName: "registry" });
  }
  if (!registry) return;
  const [owner, keeper, treasury] = await Promise.all(
    ["owner", "keeper", "treasury"].map((fn) => client.readContract({ address: registry, abi: REGISTRY_ADMIN, functionName: fn })),
  );
  const keeperBal = await client.getBalance({ address: keeper });
  $("#registryInfo").innerHTML = `Registry ${addrLink(registry)} · owner ${addrLink(owner)} · keeper ${addrLink(keeper)} (${eth(keeperBal, 4)} ETH for gas) · treasury ${addrLink(treasury)}`;
}

async function registryWrite(label, fn, args) {
  if (!registry) return toast("No registry yet");
  try {
    await connect();
    await mustChain();
    await send(label, { address: registry, abi: REGISTRY_ADMIN, functionName: fn, args });
    toast(`${label} ✓`);
    await refreshRegistry();
  } catch (err) {
    toast(err.shortMessage || err.message);
  }
}

async function collectionArg() {
  const a = $("#collection").value.trim();
  if (!isAddress(a)) throw new Error("Enter a valid collection address");
  const ok = await client.readContract({ address: a, abi: ERC165, functionName: "supportsInterface", args: [ERC721_ID] }).catch(() => false);
  if (!ok) throw new Error("That address is not an ERC-721 collection on Robinhood Chain");
  return getAddress(a);
}

$("#list").addEventListener("click", async () => {
  try { await registryWrite("List collection", "setCollection", [await collectionArg(), true]); } catch (e) { toast(e.message); }
});
$("#delist").addEventListener("click", async () => {
  try { await registryWrite("Delist collection", "setCollection", [await collectionArg(), false]); } catch (e) { toast(e.message); }
});
$("#setKeeper").addEventListener("click", () => {
  const k = $("#newKeeper").value.trim();
  if (!isAddress(k)) return toast("Enter a valid keeper address");
  registryWrite("Change keeper", "setKeeper", [getAddress(k)]);
});

$("#connect").addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));
onAccount(async (a) => {
  const bal = await client.getBalance({ address: a });
  $("#walletInfo").innerHTML = `${addrLink(a, a)} · ${eth(bal, 5)} ETH on ${CONFIG.chainName}`;
});

const initial = saved();
if (initial.registry && initial.launcher) showResult({ registry: initial.registry, launcher: initial.launcher, block: initial.block });
if (isAddress(CONFIG.launcher)) $("#deployCard").querySelector("#deploy").textContent = "Deploy again (already configured)";
refreshRegistry().catch(() => {});

// ------------------------------------------------------------------ other chains

const EXT_KEY = "vaul-deploy-external";
const extSaved = () => { try { return JSON.parse(localStorage.getItem(EXT_KEY) || "{}"); } catch { return {}; } };
const extSave = (v) => { try { localStorage.setItem(EXT_KEY, JSON.stringify({ ...extSaved(), ...v })); } catch {} };

function extLog(text, href) {
  const li = document.createElement("li");
  li.innerHTML = href ? `${esc(text)} — <a href="${href}" target="_blank" rel="noopener">tx</a>` : esc(text);
  $("#externalLog").append(li);
}

function showExternal(launcher) {
  $("#externalResult").innerHTML = `
    <h4>Deployed ✓</h4>
    <dl class="addresses"><dt>External launcher</dt><dd>${addrLink(launcher, launcher)}</dd></dl>
    <p class="muted">Put this in <code>config.js</code> (or send it to your developer):</p>
    <pre class="snippet">externalLauncher: "${launcher}",</pre>`;
}

$("#deployExternal").addEventListener("click", async (e) => {
  if (!isAddress(myLauncher() || "")) return toast("Deploy the Robinhood contracts first (step 1)");
  const btn = e.target;
  btn.disabled = true;
  $("#externalLog").innerHTML = "";
  try {
    const owner = getAccount() || (await connect());
    await mustChain();
    const artifacts = await (await fetch("artifacts/deploy.json")).json();
    const L = myLauncher();
    const read = (address, fn) => client.readContract({
      address, abi: parseAbi([`function ${fn}() view returns (address)`]), functionName: fn,
    });
    const reg = await read(L, "registry");
    const routerImpl = await read(L, "routerImplementation");
    const raffles = await read(await read(L, "vaultImplementation"), "raffles");

    let p = extSaved();
    if (p.owner !== owner || p.registry !== reg) { p = { owner, registry: reg }; extSave(p); }
    if (!p.vaultImpl) {
      p.vaultImpl = (await deployTo(extLog, "External vault template", artifacts.ExternalVault, [reg, raffles])).contractAddress;
      extSave({ vaultImpl: p.vaultImpl });
    }
    extLog(`External vault template: ${p.vaultImpl}`);
    if (!p.launcher) {
      p.launcher = (await deployTo(extLog, "External launcher", artifacts.ExternalLauncher, [CONFIG.ponsFactory, reg, p.vaultImpl, routerImpl])).contractAddress;
      extSave({ launcher: p.launcher });
    }
    extLog(`External launcher: ${p.launcher}`);
    showExternal(p.launcher);
  } catch (err) {
    toast(err.shortMessage || err.message);
    extLog(`Stopped: ${err.shortMessage || err.message}`);
  } finally {
    btn.disabled = false;
  }
});

async function extCollectionCheck(chainId, address) {
  const chain = CONFIG.chains[chainId];
  if (!chain.evm) { base58Decode(address); return; } // throws if not a Solana address
  if (!isAddress(address)) throw new Error("Enter a valid 0x address");
  // Confirm it is an ERC-721 on that chain via its public RPC.
  const res = await fetch(chain.rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data: "0x01ffc9a780ac58cd00000000000000000000000000000000000000000000000000000000" }, "latest"] }),
  }).then((r) => r.json()).catch(() => null);
  if (!res || res.error || !res.result || BigInt(res.result || "0x0") !== 1n) {
    throw new Error(`That address is not an ERC-721 collection on ${chain.name}`);
  }
}

$("#listExternal").addEventListener("click", async () => {
  const chainId = Number($("#extChain").value);
  const address = $("#extAddress").value.trim();
  const name = $("#extName").value.trim();
  const slug = $("#extSlug").value.trim();
  try {
    if (!name) throw new Error("Enter a name");
    await extCollectionCheck(chainId, address);
    const key = collectionKey(chainId, address);
    await registryWrite(`List ${name}`, "setCollection", [key, true]);
    const image = $("#extImage").value.trim();
    const entry = { chainId, address: CONFIG.chains[chainId].evm ? getAddress(address) : address, name, slug, ...(image ? { image } : {}) };
    $("#extSnippet").hidden = false;
    $("#extSnippet").textContent = JSON.stringify(entry, null, 2) + ",";
  } catch (err) {
    toast(err.shortMessage || err.message);
  }
});

if (extSaved().launcher) showExternal(extSaved().launcher);
if (isAddress(CONFIG.externalLauncher || "")) $("#deployExternal").textContent = "Deploy again (already configured)";

// ------------------------------------------------------------------ bulk listing

const BULK_KEY = "vaul-bulk";
const CHUNK = 30; // ~0.75M gas per chunk, under a 1.2M wallet cap
const LISTER_ABI = parseAbi([
  "function list(address[] keys, bool listed)",
  "function listAndGiveBack(address[] keys)",
  "function giveBack()",
]);
const OWNABLE_ABI = parseAbi(["function owner() view returns (address)", "function transferOwnership(address newOwner)"]);
const bulkSaved = () => { try { return JSON.parse(localStorage.getItem(BULK_KEY) || "{}"); } catch { return {}; } };
const bulkSave = (v) => { try { localStorage.setItem(BULK_KEY, JSON.stringify({ ...bulkSaved(), ...v })); } catch {} };
const bulkLog = (text, href) => {
  const li = document.createElement("li");
  li.innerHTML = href ? `${esc(text)} — <a href="${href}" target="_blank" rel="noopener">tx</a>` : esc(text);
  $("#bulkLog").append(li);
};

async function pendingKeys() {
  const reg = await client.readContract({ address: myLauncher(), abi: ABI.launcher, functionName: "registry" });
  const meta = await collectionMeta();
  const keys = [...new Set(meta.map((c) => collectionKey(c.chainId, c.address)))];
  const listed = await Promise.all(keys.map((k) => client.readContract({ address: reg, abi: ABI.registry, functionName: "isCollection", args: [k] })));
  return { reg, total: keys.length, todo: keys.filter((_, i) => !listed[i]) };
}

async function refreshBulk() {
  if (!isAddress(myLauncher() || "")) return;
  const { reg, total, todo } = await pendingKeys();
  const owner = await client.readContract({ address: reg, abi: OWNABLE_ABI, functionName: "owner" });
  const lent = bulkSaved().lister && getAddress(owner) === getAddress(bulkSaved().lister);
  $("#bulkInfo").textContent = `${total} collections in collections.json, ${total - todo.length} already listed, ${todo.length} to list (${Math.max(1, Math.ceil(todo.length / CHUNK))} listing transaction${todo.length > CHUNK ? "s" : ""} + setup).`;
  $("#bulkList").disabled = todo.length === 0;
  $("#bulkGiveBack").hidden = !lent;
}

async function sendAndWait(label, req) {
  const wallet = await walletClient();
  const { request } = await client.simulateContract({ account: wallet.account, ...req });
  const gas = withMargin(await client.estimateContractGas({ account: wallet.account, ...req }));
  const hash = await wallet.writeContract({ ...request, gas });
  bulkLog(`${label}: sent`, txLink(hash));
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed`);
}

$("#bulkList").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  $("#bulkLog").innerHTML = "";
  try {
    const me = getAccount() || (await connect());
    await mustChain();
    const { reg, todo } = await pendingKeys();
    if (!todo.length) return bulkLog("Everything is already listed");
    let p = bulkSaved();
    if (p.owner !== me || p.registry !== reg) { p = { owner: me, registry: reg }; bulkSave(p); }
    if (!p.lister) {
      const artifacts = await (await fetch("artifacts/deploy.json")).json();
      p.lister = (await deployTo(bulkLog, "Helper contract", artifacts.BatchLister, [reg, me])).contractAddress;
      bulkSave({ lister: p.lister });
    }
    const owner = await client.readContract({ address: reg, abi: OWNABLE_ABI, functionName: "owner" });
    if (getAddress(owner) === getAddress(me)) {
      await sendAndWait("Lend Registry to helper", { address: reg, abi: OWNABLE_ABI, functionName: "transferOwnership", args: [p.lister] });
    } else if (getAddress(owner) !== getAddress(p.lister)) {
      throw new Error("The Registry is owned by another address");
    }
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      const last = i + CHUNK >= todo.length;
      await sendAndWait(`List ${i + 1}–${i + chunk.length} of ${todo.length}${last ? " and give Registry back" : ""}`, {
        address: p.lister, abi: LISTER_ABI, functionName: last ? "listAndGiveBack" : "list", args: last ? [chunk] : [chunk, true],
      });
    }
    bulkLog("Done ✓ — all collections listed and the Registry is yours again");
    toast("All collections listed");
  } catch (err) {
    toast(err.shortMessage || err.message);
    bulkLog(`Stopped: ${err.shortMessage || err.message}`);
  } finally {
    await refreshBulk().catch(() => {});
  }
});

$("#bulkGiveBack").addEventListener("click", async () => {
  try {
    await connect();
    await mustChain();
    await sendAndWait("Give Registry back", { address: bulkSaved().lister, abi: LISTER_ABI, functionName: "giveBack" });
    toast("Registry returned");
  } catch (err) {
    toast(err.shortMessage || err.message);
  } finally {
    await refreshBulk().catch(() => {});
  }
});

refreshBulk().catch(() => ($("#bulkInfo").textContent = "Could not read the Registry."));
