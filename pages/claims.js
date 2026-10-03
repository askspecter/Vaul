import {
  ABI, $, esc, live, toast, renderChrome, connect, onAccount, getAccount, loadLaunches, loadRaffles,
  loadSnapshot, winnerEntry, write, addrLink, getAddress, client, chainName, base58Decode, toHex,
} from "../lib.js";

renderChrome("claims");
let draws = [];

async function loadDraws() {
  const launches = (await loadLaunches(500)).filter((l) => l.policy === "Raffle");
  const all = await Promise.all(launches.map(async (l) => (await loadRaffles(l)).map((r) => ({ ...r, launch: l }))));
  draws = all.flat().sort((a, b) => b.publishedAt - a.publishedAt);

  // Resolve winners from the published snapshots.
  await Promise.all(draws.map(async (d) => {
    try {
      d.snapshot = await loadSnapshot(d.launch.vault, d.id);
      if (d.drawn) d.winner = winnerEntry(d.snapshot, d.winningTicket);
    } catch { /* snapshot not published yet */ }
    if (d.launch.external && d.claimed) {
      const read = (fn) => client.readContract({ address: d.launch.vault, abi: ABI.extVault, functionName: fn, args: [d.tokenId] });
      const [owed, dest] = await Promise.all([read("prizeOwedTo"), read("prizeDestination")]);
      const chain = chainName(d.launch.chainId);
      if (owed === "0x0000000000000000000000000000000000000000") d.prize = `Delivered on ${chain}`;
      else if (d.launch.isEvm) d.prize = `Sending to your address on ${chain}`;
      else if (/^0x0+$/.test(dest)) d.prize = "solana-needs-address";
      else d.prize = `Destination saved — delivery pending on ${chain}`;
    }
  }));
}

function renderDraws() {
  const body = $("#draws tbody");
  body.innerHTML = draws.length
    ? draws.slice(0, 50).map((d) => `<tr>
        <td><a href="coin?id=${d.launch.id}">$${esc(d.launch.symbol)}</a></td>
        <td>#${d.tokenId}</td>
        <td>${d.claimed ? "Delivered" : d.drawn ? "Drawn" : "Open"}</td>
        <td>${d.winner ? addrLink(d.winner.account) : "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty">No raffles yet.</td></tr>`;
}

function renderMine(account) {
  const mine = draws.filter((d) => d.snapshot?.entries.some((e) => getAddress(e.account) === account));
  if (!mine.length) {
    $("#mine").innerHTML = `<p>No raffle tickets for ${addrLink(account)} yet. Hold a raffle coin when the next snapshot is taken.</p>`;
    return;
  }
  $("#mine").innerHTML = `<h3>Your raffles</h3><div class="table-wrap"><table class="table"><thead><tr><th>Coin</th><th>NFT</th><th>Your odds</th><th></th></tr></thead><tbody>
    ${mine.map((d, i) => {
      const e = d.snapshot.entries.find((x) => getAddress(x.account) === account);
      const odds = Number((BigInt(e.end) - BigInt(e.start)) * 10000n / BigInt(d.snapshot.totalTickets)) / 100;
      const won = d.winner && getAddress(d.winner.account) === account;
      const action = d.claimed ? (won ? (d.launch.external ? d.prize : "Delivered to you") : "—")
        : won ? `<button class="btn btn-dark" data-claim="${i}">Claim NFT</button>`
        : d.drawn ? "Not won" : "Waiting for draw";
      const cell = action === "solana-needs-address"
        ? `<span class="dest"><input placeholder="Your Solana address" /><button class="btn btn-dark" data-dest="${i}">Save</button></span>`
        : action;
      return `<tr><td>$${esc(d.launch.symbol)}</td><td>#${String(d.tokenId).length > 12 ? "NFT" : d.tokenId}</td><td>${odds}%</td><td>${cell}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
  $("#mine").querySelectorAll("[data-dest]").forEach((btn) => btn.addEventListener("click", async () => {
    const d = mine[Number(btn.dataset.dest)];
    const input = btn.previousElementSibling;
    try {
      const dest = toHex(base58Decode(input.value.trim()), { size: 32 });
      btn.disabled = true;
      await write({ address: d.launch.vault, abi: ABI.extVault, functionName: "setPrizeDestination", args: [d.tokenId, dest] });
      toast("Saved — the keeper will send your NFT there");
      d.prize = "Destination saved — delivery pending";
      renderMine(account);
    } catch (err) {
      toast(err.shortMessage || err.message);
      btn.disabled = false;
    }
  }));
  $("#mine").querySelectorAll("[data-claim]").forEach((btn) => btn.addEventListener("click", async () => {
    const d = mine[Number(btn.dataset.claim)];
    btn.disabled = true;
    try {
      await write({
        address: d.raffles, abi: ABI.raffles, functionName: "claim",
        args: [d.launch.vault, BigInt(d.id), d.winner.account, BigInt(d.winner.start), BigInt(d.winner.end), d.winner.proof],
      });
      toast("NFT claimed");
      d.claimed = true;
      renderMine(account);
      renderDraws();
    } catch (err) {
      toast(err.shortMessage || err.message);
      btn.disabled = false;
    }
  }));
}

$("[data-connect-inline]").addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));
onAccount((a) => live && renderMine(a));

if (!live) {
  $("#draws tbody").innerHTML = `<tr><td colspan="4" class="empty">Contracts not deployed yet.</td></tr>`;
} else {
  loadDraws()
    .then(() => { renderDraws(); if (getAccount()) renderMine(getAccount()); })
    .catch((e) => toast("Could not load raffles: " + (e.shortMessage || e.message)));
}
