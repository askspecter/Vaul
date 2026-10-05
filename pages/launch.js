import {
  friendlyError, getAddress,
  CONFIG, ABI, client, $, esc, live, toast, renderChrome, walletClient, getAccount, connect,
  listedCollectionsDetailed, loadLaunches, recordLaunch, colorFor, eth, toHex, short, chainName, ROBINHOOD,
  externalLive, collectionId, chainIcon, chainBadge, chainIdByName, collectionLogo, museId, saveVideo,
} from "../lib.js";
import { parseAbi, zeroAddress, encodeFunctionData } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";

renderChrome("");

const PONS_EXTRA = parseAbi([
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function maxCreatorTaxBps() view returns (uint16)",
]);
const CREATOR_SHARE_BPS = 7_000n; // creator's share of the Pons curve fee (Pons V2 docs)
const VAULT_BPS = 8_000n; // FeeRouter.VAULT_BPS
const POLICY_NAMES = { 0: "Raffle to holders", 1: "Keep in the vault", 2: "Burn" };

const state = {
  step: 0,
  collection: null, // { address, name, chain, coins, vaultEth }
  chain: "all",
  collections: [],
  pons: null, // { fee, supply, curveFeeBps, graduation, maxTax }
};

const val = (id) => $(`#${id}`).value.trim();
const policy = () => Number(document.querySelector('input[name="policy"]:checked').value);
const taxBps = () => BigInt($("#tax").value);

// ------------------------------------------------------------------ data

async function loadPons() {
  const [fee, cfg, maxTax] = await Promise.all([
    client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "launchFee" }),
    client.readContract({ address: CONFIG.ponsFactory, abi: PONS_EXTRA, functionName: "getLaunchConfig", args: [0n] }),
    client.readContract({ address: CONFIG.ponsFactory, abi: PONS_EXTRA, functionName: "maxCreatorTaxBps" }),
  ]);
  state.pons = { fee, supply: cfg.supply, curveFeeBps: cfg.curveFeeBps, graduation: cfg.graduationThreshold, maxTax: Number(maxTax) };
  $("#tax").max = String(state.pons.maxTax);
  $("#taxMax").textContent = `max ${(state.pons.maxTax / 100).toFixed(0)}%`;
  $("#launchFee").textContent = `${eth(fee, 6)} ETH`;
  render();
}

async function loadCollections() {
  if (!live) {
    $("#colList").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`;
    return;
  }
  const [listed, launches] = await Promise.all([listedCollectionsDetailed(), loadLaunches(500).catch(() => [])]);
  state.collections = listed
    // Other-chain collections need the "Other chains" contracts deployed to launch.
    .filter((c) => c.chainId === ROBINHOOD || externalLive)
    .map((c) => {
      const coins = launches.filter((l) => l.collection.toLowerCase() === c.key.toLowerCase());
      return { ...c, chain: chainName(c.chainId), coins: coins.length, vaultEth: coins.reduce((s, x) => s + x.vaultBalance, 0n) };
    });
  state.collections.sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
  // Coming from the Collections page ("Launch a coin" on a row): preselect that collection.
  const wanted = new URLSearchParams(location.search).get("collection");
  if (wanted) state.collection = state.collections.find((c) => c.key.toLowerCase() === wanted.toLowerCase()) || null;
  renderCollections();
  renderPreview();
}

// ------------------------------------------------------------------ fee math (per 1 ETH traded)

function split() {
  if (!state.pons) return null;
  const traded = 10n ** 18n;
  const curveFee = (traded * state.pons.curveFeeBps) / 10_000n;
  const creator = (curveFee * CREATOR_SHARE_BPS) / 10_000n + (traded * taxBps()) / 10_000n;
  const vault = (creator * VAULT_BPS) / 10_000n;
  return { vault, treasury: creator - vault, pons: curveFee - (curveFee * CREATOR_SHARE_BPS) / 10_000n };
}

// ------------------------------------------------------------------ rendering

function renderPreview() {
  const s = split();
  const name = val("name") || "Your coin";
  const symbol = (val("symbol") || "TICKER").toUpperCase();
  const logo = val("logo");
  const img = logo
    ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'badge-fallback',textContent:'$'}))" />`
    : `<div class="badge-fallback" style="background:${colorFor(symbol)}">$</div>`;
  const total = s ? s.vault + s.treasury + s.pons : 0n;
  const pct = (x) => (total ? Number((x * 10_000n) / total) / 100 : 0);
  $("#preview").innerHTML = `
    <div class="pv-head">${img}<div><b>${esc(name)}</b><span class="mono">$${esc(symbol)}</span></div></div>
    <dl class="pv-rows">
      <dt>Collects</dt><dd>${state.collection ? `<span class="collects">${collectionLogo(state.collection.name, state.collection.image, 18)}${esc(state.collection.name)} ${chainIcon(state.collection.chainId)}</span>` : "—"}</dd>
      <dt>NFTs</dt><dd>${POLICY_NAMES[policy()]}</dd>
      <dt>Creator tax</dt><dd>${(Number(taxBps()) / 100).toFixed(2)}%</dd>
      <dt>Supply</dt><dd>${state.pons ? Number(state.pons.supply / 10n ** 18n).toLocaleString() : "…"}</dd>
    </dl>
    ${s ? `<div class="split">
      <div class="split-head"><span>Every 1 ETH traded</span><span>estimate</span></div>
      <div class="bar3"><i style="width:${pct(s.vault)}%"></i><i style="width:${pct(s.treasury)}%"></i><i style="width:${pct(s.pons)}%"></i></div>
      <ul>
        <li><span class="dot d1"></span>${state.collection ? esc(state.collection.name) : "Collection"} vault<b>${eth(s.vault, 4)} ETH</b></li>
        <li><span class="dot d2"></span>Vaul treasury<b>${eth(s.treasury, 4)} ETH</b></li>
        <li><span class="dot d3"></span>Pons<b>${eth(s.pons, 4)} ETH</b></li>
      </ul>
      <p class="hint">Pons charges ${(Number(state.pons.curveFeeBps) / 100).toFixed(2)}% per trade and passes 70% of it to your fee router, plus your creator tax. The router sends 80% to the vault and 20% to the treasury. Gas and any Pons launch-block tax are not included.</p>
    </div>` : ""}`;
}

function renderCollections() {
  const chains = ["all", ...new Set(state.collections.map((c) => c.chain))];
  $("#chainChips").innerHTML = chains.map((c) => {
    const n = c === "all" ? state.collections.length : state.collections.filter((x) => x.chain === c).length;
    const label = c === "all" ? "All" : `${chainIcon(chainIdByName(c))}${esc(c)}`;
    return `<button class="chip${state.chain === c ? " active" : ""}" data-chain="${c}">${label} <small>${n}</small></button>`;
  }).join("");
  const q = val("colSearch").toLowerCase();
  const rows = state.collections.filter((c) =>
    (state.chain === "all" || c.chain === state.chain) && (!q || c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)));
  $("#colList").innerHTML = rows.length ? rows.map((c) => `
    <button class="col${state.collection?.key === c.key ? " selected" : ""}" data-key="${c.key}">
      ${collectionLogo(c.name, c.image, 44)}
      <span class="col-main"><b>${esc(c.name)}</b><small class="mono">${short(c.address)}</small>
        <span class="col-meta">${chainBadge(c.chainId)}${c.coins} coin${c.coins === 1 ? "" : "s"} · ${eth(c.vaultEth, 4)} ETH in vaults</span></span>
      <span class="radio"></span>
    </button>`).join("") : `<p class="empty">No collections match.</p>`;
}

function renderSummary() {
  const rows = [
    ["Name", esc(val("name"))],
    ["Ticker", `$${esc(val("symbol").toUpperCase())}`],
    ["Collects", state.collection ? `<span class="collects">${collectionLogo(state.collection.name, state.collection.image, 20)}${esc(state.collection.name)} ${chainBadge(state.collection.chainId)}</span>` : "—"],
    ["NFTs", POLICY_NAMES[policy()]],
    ["Creator tax", `${(Number(taxBps()) / 100).toFixed(2)}%`],
    ...(museId(val("video")) ? [["Video", `muse.ai · ${esc(museId(val("video")))}`]] : []),
  ];
  $("#summary").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const s = split();
  $("#facts").innerHTML = [
    `80% of everything your coin earns goes to the ${state.collection ? esc(state.collection.name) : "collection"} vault and 20% to the treasury. This split is fixed in the fee router's code, and nobody can change it.`,
    state.collection?.kind === "cards"
      ? `Each card the vault buys is the cheapest graded ${esc(state.collection.name.replace(/ Cards$/, ""))} card listed on ${esc(state.collection.source || "the marketplace")} at the time, a real card held in its vault and represented by an NFT on ${esc(state.collection.chain)}. ${CONFIG.chains[state.collection.chainId]?.evm
        ? "Winners receive it at the same wallet address there" : "Winners enter a Solana address on the Giveaways page to receive it"} and can redeem the physical card.` : "",
    state.collection && state.collection.chainId !== ROBINHOOD
      ? `This collection is on ${esc(state.collection.chain)}. The keeper moves the vault's ETH there to buy: every withdrawal is announced 1 hour ahead and can be cancelled, and each purchase is recorded on Robinhood Chain.`
      : "The collection and the NFT rule are permanent. The vault has no withdraw function.",
    state.collection && state.collection.chainId !== ROBINHOOD && !CONFIG.chains[state.collection.chainId]?.evm
      ? "Raffle winners on Solana enter their Solana address on the Giveaways page to receive the NFT." : "",
    state.pons ? `Once ${eth(state.pons.graduation, 2)} ETH is in the curve, the coin moves to a locked Uniswap v4 pool, and fees keep flowing the same way.` : "",
    s ? `With ${(Number(taxBps()) / 100).toFixed(2)}% tax, every 1 ETH of trading sends about ${eth(s.vault, 4)} ETH to the vault.` : "",
  ].filter(Boolean).map((t) => `<li>${t}</li>`).join("");
  $("#launchBtn").textContent = getAccount() ? `Launch $${val("symbol").toUpperCase() || "coin"}` : "Connect wallet";
}

/** Card Vaults buy real cards, so "Burn" is not offered for them. */
function syncPolicyOptions() {
  const burn = document.querySelector('input[name="policy"][value="2"]');
  const cards = state.collection?.kind === "cards";
  burn.disabled = cards;
  burn.closest(".option").hidden = cards;
  if (cards && burn.checked) document.querySelector('input[name="policy"][value="0"]').checked = true;
}

function render() {
  syncPolicyOptions();
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = Number(p.dataset.panel) !== state.step));
  document.querySelectorAll("#stepper li").forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle("active", i === state.step);
    li.classList.toggle("done", i < state.step);
  });
  $("#back").hidden = state.step === 0;
  $("#next").hidden = state.step === 3;
  renderPreview();
  if (state.step === 3) renderSummary();
}

// ------------------------------------------------------------------ validation + navigation

function validate(step) {
  if (step === 0) {
    if (state.uploading) return "Wait for the image to finish uploading";
    if (!val("name")) return "Enter a name";
    if (!/^[A-Za-z0-9]{1,10}$/.test(val("symbol"))) return "Ticker: 1–10 letters or numbers";
    for (const id of ["logo", "website", "twitter", "telegram", "discord"]) {
      const v = val(id);
      if (v && !/^https?:\/\//i.test(v)) return `${id === "logo" ? "Image URL" : id} must start with https://`;
    }
    if (val("video") && !museId(val("video"))) return "Video: paste a muse.ai link like https://muse.ai/v/abc123";
  }
  if (step === 1 && !state.collection) return "Pick a collection";
  return null;
}

$("#next").addEventListener("click", () => {
  const err = validate(state.step);
  if (err) return toast(err);
  state.step = Math.min(3, state.step + 1);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("#back").addEventListener("click", () => { state.step = Math.max(0, state.step - 1); render(); });
$("#stepper").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const target = Number(li.dataset.step);
  for (let s = 0; s < target; s++) {
    const err = validate(s);
    if (err) { state.step = s; render(); return toast(err); }
  }
  state.step = target;
  render();
});

["name", "symbol", "logo"].forEach((id) => $(`#${id}`).addEventListener("input", renderPreview));

// ------------------------------------------------------------------ image upload

/** Shrinks big pictures to 512px so uploads stay small. GIFs are sent as-is to keep animation. */
async function prepareImage(file) {
  if (file.type === "image/gif" && file.size <= 500 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/webp", 0.9));
  return blob?.type === "image/webp" ? blob : new Promise((ok) => canvas.toBlob(ok, "image/png"));
}

const toBase64 = (blob) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = fail;
  r.readAsDataURL(blob);
});

$("#logoFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const title = $("#uploadTitle");
  const thumb = $("#uploadThumb");
  state.uploading = true;
  title.textContent = "Uploading…";
  $("#uploadBox").classList.add("busy");
  try {
    const img = await prepareImage(file);
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: await toBase64(img) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Upload failed (${res.status})`);
    const url = new URL(out.path, location.origin).href; // absolute, since Pons stores it with the coin
    $("#logo").value = url;
    thumb.innerHTML = `<img src="${esc(url)}" alt="" />`;
    title.textContent = "Image ready · tap to change";
    renderPreview();
  } catch (err) {
    title.textContent = "Choose an image";
    toast(err.message);
  } finally {
    state.uploading = false;
    $("#uploadBox").classList.remove("busy");
    e.target.value = "";
  }
});
$("#tax").addEventListener("input", () => {
  $("#taxLabel").textContent = `${(Number(taxBps()) / 100).toFixed(2)}%`;
  renderPreview();
});
document.querySelectorAll('input[name="policy"]').forEach((r) => r.addEventListener("change", renderPreview));
$("#colSearch").addEventListener("input", renderCollections);
$("#chainChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chain]");
  if (!b) return;
  state.chain = b.dataset.chain;
  renderCollections();
});
$("#colList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-key]");
  if (!b) return;
  state.collection = state.collections.find((c) => c.key === b.dataset.key);
  syncPolicyOptions();
  renderCollections();
  renderPreview();
});

// ------------------------------------------------------------------ launch

$("#launchBtn").addEventListener("click", async (e) => {
  if (!live) return toast("Contracts not deployed yet");
  const btn = e.target;
  if (!getAccount()) {
    try { await connect(); renderSummary(); } catch (err) { toast(err.shortMessage || err.message); }
    return;
  }
  for (let s = 0; s < 3; s++) {
    const err = validate(s);
    if (err) { state.step = s; render(); return toast(err); }
  }
  btn.disabled = true;
  try {
    const wallet = await walletClient();
    if ((await wallet.getChainId().catch(() => CONFIG.chainId)) !== CONFIG.chainId) {
      await wallet.switchChain({ id: CONFIG.chainId }).catch(() => {
        throw new Error("Switch your wallet to Robinhood Chain and try again.");
      });
    }
    const [fee, economics] = await Promise.all([
      client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "launchFee" }),
      client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "previewLaunchEconomics", args: [0n, zeroAddress] }),
    ]);
    const external = state.collection.chainId !== ROBINHOOD;
    const base = {
      name: val("name"),
      symbol: val("symbol").toUpperCase(),
      logo: val("logo"),
      description: val("description"),
      socials: { twitter: val("twitter"), telegram: val("telegram"), discord: val("discord"), website: val("website"), farcaster: "" },
      creatorTaxBps: Number(taxBps()),
      launchConfigId: 0n,
      expectedEconomics: economics,
      salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
      policy: policy(),
    };
    const args = [external
      ? { ...base, chainId: BigInt(state.collection.chainId), collection: collectionId(state.collection.chainId, state.collection.address, state.collection.tag), isEvm: !!CONFIG.chains[state.collection.chainId]?.evm }
      : { ...base, collection: state.collection.address }];
    const target = external ? CONFIG.externalLauncher : CONFIG.launcher;
    const abi = external ? ABI.extLauncher : ABI.launcher;
    const req = { address: target, abi, functionName: "launch", args, value: fee, account: wallet.account };
    await client.simulateContract(req); // surfaces a revert reason before the wallet opens
    const gas = ((await client.estimateContractGas(req)) * 13n) / 10n;
    btn.textContent = "Confirm in your wallet…";
    const hash = await wallet.sendTransaction({
      account: wallet.account, to: getAddress(target), value: fee, gas,
      data: encodeFunctionData({ abi, functionName: "launch", args }),
    });
    btn.textContent = "Launching…";
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(receipt.gasUsed >= 1_190_000n && receipt.gasUsed <= 1_200_000n
        ? "Out of gas: your wallet capped the gas limit at 1.2M. Raise it to 4,000,000 in the wallet, or use MetaMask."
        : "Launch transaction failed");
    }
    // Add the coin to Vaul's list; the API reads the id from the tx's Launched event, so a retry is safe.
    let launchId = await recordLaunch(hash).catch(() => recordLaunch(hash)).catch((err) => { console.error(err); return null; });
    if (!launchId) {
      const count = await client.readContract({ address: target, abi, functionName: "launchCount" });
      launchId = `${external ? "e" : ""}${Number(count) - 1}`;
    }
    toast("Launched!");
    const video = museId(val("video"));
    let next = `coin?id=${launchId}`;
    if (video) {
      btn.textContent = "Sign to attach the video…";
      // The coin is already live; if the signature is skipped or fails, the coin page offers to retry.
      await saveVideo(launchId, video).catch((err) => {
        console.error(err);
        next += `&video=${encodeURIComponent(video)}`;
      });
    }
    location.href = next;
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    btn.textContent = `Launch $${val("symbol").toUpperCase()}`;
  } finally {
    btn.disabled = false;
  }
});

render();
loadPons().catch(() => toast("Could not read Pons settings"));
loadCollections().catch((e) => toast("Could not load collections: " + (e.shortMessage || e.message)));
