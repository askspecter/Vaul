import {
  CONFIG, ABI, client, $, esc, live, toast, renderChrome, loadLaunch, loadRaffles, write,
  eth, short, addrLink, chainName, chainBadge, ROBINHOOD, collectionLogo, coinArt,
  getAccount, onAccount, connect, museId, museEmbed, musePage, loadVideo, saveVideo, loadGrails,
} from "../lib.js";
import {
  loadActivity, addTimes, mountFeed, summarize, wireCopy, copyBtn, geckoPool, geckoEmbed, geckoPage, ponsPage,
} from "../feed.js";

renderChrome("explore");
wireCopy();
const params = new URLSearchParams(location.search);
const id = params.get("id");
// Set by the launch page when the creator skipped signing for the video they entered.
let pendingVideo = museId(musePage(params.get("video") || ""));

function raffleStatus(r) {
  if (r.claimed) return "Delivered";
  if (r.drawn) return "Drawn — delivering";
  if (r.drawBlock) return "Drawing";
  const ready = r.publishedAt + 15 * 60;
  return Date.now() / 1000 < ready ? `Snapshot public until ${new Date(ready * 1000).toLocaleTimeString()}` : "Ready to draw";
}

const pct = (part, whole) => (whole ? `${(Number((part * 10_000n) / whole) / 100).toFixed(1)}%` : "—");

function addressRow(label, addr, href) {
  const link = href || `${CONFIG.explorer}/address/${addr}`;
  return `<div class="addr-row"><span>${label}</span><a class="mono" href="${link}" target="_blank" rel="noopener">${short(addr)}</a>${copyBtn(addr, "⧉")}</div>`;
}

/** Grail Mode: how far the vault is towards its grail (vault balance plus ETH already bridged). */
function grailProgress(l, grails) {
  const g = grails?.byTag.get(l.tag);
  const saved = Number(l.vaultBalance + (l.withdrawn - l.spent)) / 1e18;
  if (l.nfts > 0) return `<div class="grail-progress"><img src="${esc(l.collectionImage || "")}" alt="" /><div>
    <span class="gp-k">GRAIL MODE</span><h3>Grail secured</h3><p>The vault bought its grail${l.policy === "Raffle" ? "; it goes to one holder in the giveaway below" : ""}.</p></div></div>`;
  const pctDone = g?.priceEth ? Math.min(100, (saved / g.priceEth) * 100) : 0;
  return `<div class="grail-progress">
    <img src="${esc(g?.image || l.collectionImage || "")}" alt="" onerror="this.style.visibility='hidden'" />
    <div>
      <span class="gp-k">GRAIL MODE · SAVING FOR</span>
      <h3>${esc(l.collectionName)}</h3>
      <div class="gp-pct">${g?.priceEth ? `${pctDone.toFixed(pctDone < 10 ? 1 : 0)}%` : "—"}</div>
      <div class="gp-bar"><i style="width:${pctDone}%"></i></div>
      <p>${g?.priceEth
        ? `${saved.toFixed(4)} ETH saved of ≈ ${g.priceEth.toFixed(3)} ETH (cheapest listed: $${Math.round(g.priceUsd).toLocaleString()}${g.card ? `, ${esc(g.card)}` : ""}). The vault buys nothing else until then.`
        : `${saved.toFixed(4)} ETH saved. No card meeting the grail is listed right now; the vault keeps saving.`}</p>
    </div>
  </div>`;
}

async function render() {
  if (!live) return ($("#coin").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`);
  if (id == null) return ($("#coin").innerHTML = `<p class="empty">No coin selected. <a href="explore">Explore coins</a>.</p>`);

  const l = await loadLaunch(id);
  document.title = `$${l.symbol} · Vaul`;
  const registry = await client.readContract({ address: CONFIG.launcher, abi: ABI.launcher, functionName: "registry" });
  const [treasury, supply, raffles, activity, pool, video, grails] = await Promise.all([
    client.readContract({ address: registry, abi: ABI.registry, functionName: "treasury" }).catch(() => null),
    client.readContract({ address: l.token, abi: ABI.erc20, functionName: "totalSupply" }).catch(() => 0n),
    l.policy === "Raffle" ? loadRaffles(l).catch(() => []) : [],
    loadActivity([l]).catch(() => []),
    geckoPool(l.token, l.curve),
    loadVideo(l.id),
    l.kind === "grail" ? loadGrails() : null,
  ]);
  const s = summarize(activity);
  const drawsDone = raffles.filter((r) => r.claimed).length;
  const waiting = l.external ? Math.max(0, s.bought - s.given - s.burned) : l.nfts;
  const chainId = l.external ? l.chainId : ROBINHOOD;
  const collectionHref = l.external
    ? (CONFIG.chains[chainId]?.evm && l.collectionAddress ? `${CONFIG.chains[chainId].explorer}/address/${l.collectionAddress}` : l.collectionAddress ? `${CONFIG.chains[chainId].explorer}/account/${l.collectionAddress}` : null)
    : `${CONFIG.explorer}/address/${l.collection}`;

  $("#coin").innerHTML = `
    <section class="coin-hero">
      <div class="ch-top">
        ${coinArt(l, "coin-badge")}
        <div class="ch-id">
          <h1 class="page-title">${esc(l.name)}</h1>
          <span class="ticker mono">$${esc(l.symbol)}</span>
        </div>
      </div>
      <div class="ch-meta">
        <span class="meta-chip">${collectionLogo(l.collectionName, l.collectionImage, 24)}<span>Feeds <b>${esc(l.collectionName)}</b></span></span>
        ${chainBadge(chainId)}
        <span class="meta-chip plain">${l.policy === "Raffle" ? "NFTs go to holders" : l.policy === "Burn" ? "NFTs are burned" : "NFTs stay in the vault"}</span>
      </div>
      ${l.description ? `<p class="coin-desc">${esc(l.description)}</p>` : ""}
      <div class="token-line">
        <span class="tl-label">CA</span><span class="mono">${l.token}</span>${copyBtn(l.token, "Copy")}
      </div>
      <div class="ch-actions">
        <a class="btn btn-dark" href="${ponsPage(l.token)}" target="_blank" rel="noopener">Buy / sell on Pons ↗</a>
        <a class="btn btn-ghost" href="${geckoPage(pool)}" target="_blank" rel="noopener">Chart ↗</a>
        <a class="btn btn-ghost" href="${CONFIG.explorer}/token/${l.token}" target="_blank" rel="noopener">Explorer ↗</a>
      </div>
    </section>

    <div class="coin-grid">
      <div class="coin-main">
        <div id="videoBox"></div>
        <div class="chart-card">
          <iframe id="chart" title="$${esc(l.symbol)} price chart" src="${geckoEmbed(pool)}" loading="lazy" allow="clipboard-write" allowfullscreen></iframe>
        </div>

        ${l.kind === "grail" ? grailProgress(l, grails) : ""}
        <div class="kpis">
          <div class="kpi"><span>In the vault now</span><b>${eth(l.vaultBalance, 4)} ETH</b></div>
          <div class="kpi"><span>NFTs bought</span><b>${s.bought}</b></div>
          <div class="kpi"><span>Spent on floors</span><b>${eth(s.spent, 4)} ETH</b></div>
          <div class="kpi"><span>Given to holders</span><b>${s.given}</b></div>
        </div>
        ${l.external && l.pendingAmount > 0n ? `<div class="card notice">A withdrawal of <b>${eth(l.pendingAmount, 4)} ETH</b> is queued. After ${new Date(l.pendingReadyAt * 1000).toLocaleString()} it can leave the vault to buy on ${esc(chainName(l.chainId))}; the registry owner can still cancel it before then.</div>` : ""}

        <h2 class="sub">Activity</h2>
        <div id="feed"></div>

        ${l.policy === "Raffle" ? `<h2 class="sub">Giveaways</h2>
        ${raffles.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>NFT</th><th>Status</th></tr></thead><tbody>
          ${raffles.slice().reverse().map((r) => `<tr><td>${r.id}</td><td>#${String(r.tokenId).length > 12 ? short(`0x${r.tokenId.toString(16)}`) : r.tokenId}</td><td>${raffleStatus(r)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="empty">No giveaways yet. One opens each time the vault gets an NFT.</p>`}` : ""}
      </div>

      <aside class="coin-side">
        <div class="side-card">
          <h3>Fees ready to collect</h3>
          <p class="big">${eth(l.pending, 5)} <small>ETH</small></p>
          <p class="muted small">Creator fees waiting in the Pons escrow and the fee router. Harvesting sends 80% to the vault and 20% to the treasury. Anyone can do it; the keeper also does it every 30 minutes.</p>
          <button class="btn btn-dark wide" id="harvest">Harvest now</button>
        </div>

        <div class="side-card">
          <h3>Where the fees went</h3>
          <div class="stat-list">
            <div><span>NFTs bought</span><b>${s.bought}</b></div>
            <div><span>Given away</span><b>${s.given}</b></div>
            <div><span>${l.policy === "Burn" ? "Burned" : "Waiting in vault"}</span><b>${l.policy === "Burn" ? s.burned : waiting}</b></div>
            <div><span>Draws finished</span><b>${drawsDone}</b></div>
            ${l.external ? `<div><span>Bridged to ${esc(chainName(l.chainId))}</span><b>${eth(l.withdrawn, 4)} ETH</b></div>` : ""}
          </div>
        </div>

        <div class="side-card">
          <h3>Fee router</h3>
          <div class="stat-list">
            <div><span>Harvested in total</span><b>${eth(s.harvested, 5)} ETH</b></div>
            <div><span>Sent to vault</span><b>${eth(s.toVault, 5)} ETH</b></div>
            <div><span>Sent to treasury</span><b>${eth(s.toTreasury, 5)} ETH</b></div>
            <div><span>Harvests</span><b>${s.harvests}</b></div>
          </div>
          <div class="split-bar" title="Actual split so far"><i style="width:${s.harvested ? pct(s.toVault, s.harvested) : "80%"}"></i></div>
          <p class="muted small">Actual split so far: ${pct(s.toVault, s.harvested)} vault · ${pct(s.toTreasury, s.harvested)} treasury (target 80 / 20).</p>
        </div>

        <div class="side-card">
          <h3>Addresses</h3>
          ${addressRow("Token", l.token)}
          ${addressRow("Creator", l.creator)}
          ${l.collectionAddress || !l.external ? addressRow(`Collection${l.external ? ` (${esc(chainName(chainId))})` : ""}`, l.external ? l.collectionAddress : l.collection, collectionHref) : ""}
          ${addressRow("Vault", l.vault)}
          ${addressRow("Pons curve", l.curve)}
          ${addressRow("Fee router", l.router)}
          ${treasury ? addressRow("Treasury", treasury) : ""}
          <div class="addr-row"><span>Supply</span><b>${supply ? Number(supply / 10n ** 18n).toLocaleString() : "—"}</b></div>
        </div>
      </aside>
    </div>`;

  mountVideo(l, video);

  mountFeed($("#feed"), activity);
  addTimes(activity).then(() => mountFeed($("#feed"), activity)).catch(() => {});

  $("#harvest").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await write({ address: l.router, abi: ABI.router, functionName: "harvest" });
      toast("Harvested. The fees are in the vault now");
      await render();
    } catch (err) {
      toast(err.shortMessage || err.message);
      e.target.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ muse.ai video

function mountVideo(l, initial) {
  let video = initial;
  const box = $("#videoBox");
  const isCreator = () => !!getAccount() && getAccount().toLowerCase() === l.creator.toLowerCase();

  const draw = () => {
    const player = video
      ? `<div class="video-card"><iframe title="$${esc(l.symbol)} video" src="${museEmbed(video)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
      : "";
    let edit = "";
    if (isCreator()) {
      edit = `<details class="video-edit"${pendingVideo ? " open" : ""}>
        <summary>${video ? "Change the video" : "Add a muse.ai video"}</summary>
        <div class="video-form">
          <input id="videoLink" type="url" placeholder="https://muse.ai/v/…" value="${pendingVideo ? esc(musePage(pendingVideo)) : ""}" />
          <button class="btn btn-dark" id="videoSave">Save</button>
          ${video ? `<button class="btn btn-ghost" id="videoRemove">Remove</button>` : ""}
        </div>
        <p class="muted small">You sign a message with the wallet that launched this coin. No gas.</p>
      </details>`;
    } else if (pendingVideo && !getAccount()) {
      edit = `<div class="card notice">Your video is not attached yet. <button class="btn btn-dark" id="videoConnect">Connect wallet</button></div>`;
    }
    box.innerHTML = player + edit;

    $("#videoConnect", box)?.addEventListener("click", () => connect().catch((err) => toast(err.shortMessage || err.message)));
    const save = async (btn, next) => {
      btn.disabled = true;
      try {
        video = await saveVideo(l.id, next);
        pendingVideo = null;
        params.delete("video");
        history.replaceState(null, "", `${location.pathname}?${params}`);
        toast(video ? "Video saved" : "Video removed");
        draw();
      } catch (err) {
        toast(err.shortMessage || err.message);
        btn.disabled = false;
      }
    };
    $("#videoSave", box)?.addEventListener("click", (e) => {
      const next = museId($("#videoLink", box).value);
      if (!next) return toast("Paste a muse.ai link like https://muse.ai/v/abc123");
      save(e.target, next);
    });
    $("#videoRemove", box)?.addEventListener("click", (e) => save(e.target, ""));
  };

  draw();
  // render() rebuilds the page after a harvest; listeners for a replaced box just do nothing.
  onAccount(() => document.body.contains(box) && draw());
}

render().catch((e) => ($("#coin").innerHTML = `<p class="empty">Could not load coin: ${esc(e.shortMessage || e.message)}</p>`));
