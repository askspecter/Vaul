import { $, esc, live, renderChrome, loadLaunches } from "../lib.js";
import { loadActivity, addTimes, mountFeed } from "../feed.js";

renderChrome("activity");

async function render() {
  if (!live) return ($("#feed").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`);
  const launches = await loadLaunches(500);
  const items = await loadActivity(launches);
  mountFeed($("#feed"), items, { showCoin: true, limit: 100 });
  await addTimes(items, 100);
  mountFeed($("#feed"), items, { showCoin: true, limit: 100 });
}

render().catch((e) => ($("#feed").innerHTML = `<p class="empty">Could not load activity: ${esc(e.shortMessage || e.message)}</p>`));
