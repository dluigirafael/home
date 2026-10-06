const $now = document.getElementById("now");
const $queue = document.getElementById("queue");
const $dot = document.getElementById("dot");
const $health = document.getElementById("health");
const $healthWrap = document.querySelector(".health-wrap");

const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);

const fmt = (sec) => {
	sec = Math.max(0, Math.floor(sec || 0));
	return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

const fmtUptime = (sec) => {
	sec = Math.floor(sec || 0);
	const d = Math.floor(sec / 86400);
	const h = Math.floor((sec % 86400) / 3600);
	const m = Math.floor((sec % 3600) / 60);
	return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

const POLL_MS = 5000;
const STATS_MS = 10000;
const TICK_MS = 1000;
const FETCH_MS = 8000;

let pos = 0;
let dur = 0;
let trackId;
let nowKey;
let queueSig = null;
let musicStatus = "idle";
let tsOnline = false;

const pct = () => (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0);

const el = (id) => document.getElementById(id);
const setText = (node, t) => node && node.textContent !== t && (node.textContent = t);
const setHTML = (node, h) => node && node.innerHTML !== h && (node.innerHTML = h);
const setClass = (node, c) => node && node.className !== c && (node.className = c);
const setWidth = (node, w) => node && node.style.width !== w && (node.style.width = w);

async function fetchJSON(url) {
	const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_MS) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
}

// waits between runs, so a slow response can never stack on the next one
const schedule = (fn, ms) =>
	fn().catch(() => {}).finally(() => setTimeout(() => schedule(fn, ms), ms));

// The catalog ships either icon.svg or icon.png for an app, never both:
// on a failed load we advance to the next file and remember where we got to.
const ICON_BASE = "https://media.sys.truenas.net/apps";
const ICON_FILES = ["icon.svg", "icon.png"];
const iconIdx = new Map();

function iconUrl(slug) {
	const idx = iconIdx.get(slug) ?? 0;
	iconIdx.set(slug, idx);
	return idx < ICON_FILES.length ? `${ICON_BASE}/${slug}/icons/${ICON_FILES[idx]}` : null;
}

window.iconErr = (img) => {
	const slug = img.dataset.slug;
	iconIdx.set(slug, (iconIdx.get(slug) ?? 0) + 1);
	const url = iconUrl(slug);
	if (url) img.src = url;
	else img.remove();
};

function renderNow() {
	const np = window.__np;
	if (!np) {
		nowKey = "";
		setHTML($now, '<span class="empty">Nothing playing</span>');
		return;
	}
	const key = `${np.title}|${np.artist || ""}`;
	if (nowKey !== key) {
		nowKey = key;
		setHTML(
			$now,
			`
      <div class="title">${esc(np.title || "Unknown")}</div>
      ${np.artist ? `<div class="artist">${esc(np.artist)}</div>` : ""}
      <div class="progress">
        <span class="t" id="pos"></span>
        <div class="bar"><span id="bar"></span></div>
        <span class="t" id="dur"></span>
      </div>`,
		);
	}
	setText(el("pos"), fmt(pos));
	setText(el("dur"), fmt(dur));
	setWidth(el("bar"), `${pct()}%`);
}

function renderQueue(upcoming, total) {
	const list = (upcoming || []).slice(0, 5);
	const count = Number(total) || list.length;
	const sig = `${count}|${list
		.map((i) => `${i.title || ""}|${i.artist || ""}|${i.duration || ""}`)
		.join("\u0001")}`;
	if (sig === queueSig) return;
	queueSig = sig;
	if (!list.length) return setHTML($queue, "");

	setHTML(
		$queue,
		`
    <div class="queue">
      <h2><span>Up Next</span><span class="count">${count}</span></h2>
      <ol>
        ${list
					.map(
						(i) => `
          <li>
            <div class="q-meta">
              <div class="q-title">${esc(i.title || "Unknown")}</div>
              ${i.artist ? `<div class="q-artist">${esc(i.artist)}</div>` : ""}
            </div>
            ${i.duration ? `<div class="q-dur">${fmt(i.duration)}</div>` : ""}
          </li>`,
					)
					.join("")}
      </ol>
    </div>`,
	);
}

function tick() {
	if (musicStatus !== "playing" || !window.__np) return;
	pos = Math.min(pos + 1, dur);
	setText(el("pos"), fmt(pos));
	setWidth(el("bar"), `${pct()}%`);
}

async function poll() {
	let d;
	try {
		d = await fetchJSON("/data");
	} catch {
		window.__np = null;
		trackId = undefined;
		nowKey = undefined;
		musicStatus = "idle";
		queueSig = null;
		setHTML($now, '<span class="empty">Unavailable</span>');
		setHTML($queue, "");
		updateDot();
		return;
	}

	const np = d.nowPlaying ?? null;
	const id = np ? `${np.title}|${np.artist || ""}` : null;

	if (id !== trackId) {
		trackId = id;
		pos = d.progress?.position ?? 0;
		dur = d.progress?.duration ?? np?.duration ?? 0;
		nowKey = undefined;
		window.__np = np;
	} else {
		// 2s tolerance absorbs polling drift without visibly snapping the bar
		const serverPos = d.progress?.position ?? 0;
		if (Math.abs(serverPos - pos) > 2) pos = serverPos;
		dur = d.progress?.duration ?? np?.duration ?? dur;
	}

	musicStatus = d.status === "playing" ? "playing" : d.status === "paused" ? "paused" : "idle";
	updateDot();
	renderNow();
	renderQueue(d.upcoming, d.queueLength);
}

// offline always wins; otherwise mirror the player (amber while paused)
function updateDot() {
	setClass($dot, tsOnline ? `dot ${musicStatus === "paused" ? "paused" : "playing"}` : "dot");
}

function sparklineSvg(values, color, w, h, stroke) {
	if (!values || values.length < 2) return "";
	const max = Math.max(...values, 1);
	const step = w / (values.length - 1);
	const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
	return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${stroke}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

const setSparkline = (id, values) =>
	setHTML(el(`${id}-spark`), sparklineSvg(values, "#8a8d94", 100, 16, 1.5));

function setCellState(id, value, warnAt, hotAt) {
	const cell = el(id)?.closest(".cell");
	if (!cell) return;
	cell.classList.toggle("warn", value != null && value >= warnAt && value < hotAt);
	cell.classList.toggle("hot", value != null && value >= hotAt);
}

// Rows are keyed by container name and updated in place, so the <img> is
// created once and never re-requested.
const healthRows = new Map();
const slugFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function createRow(c) {
	const rowEl = document.createElement("div");
	rowEl.className = "h-item";
	rowEl.dataset.name = c.name;
	const slug = slugFor(c.name);
	const src = iconUrl(slug);
	rowEl.innerHTML = `
    <img class="h-icon" alt="" loading="lazy"${src ? ` src="${src}" data-slug="${slug}" onerror="iconErr(this)"` : ""}>
    <span class="h-dot"></span>
    <div class="h-meta"><span class="h-name"></span><span class="h-sub"></span></div>
    <span class="h-graph"></span>`;
	return {
		el: rowEl,
		dot: rowEl.querySelector(".h-dot"),
		name: rowEl.querySelector(".h-name"),
		sub: rowEl.querySelector(".h-sub"),
		graph: rowEl.querySelector(".h-graph"),
		slug,
	};
}

function updateRow(row, c) {
	const state = c.state === "running" ? "ok" : c.state === "partial" ? "warn" : "bad";
	setClass(row.dot, `h-dot ${state}`);
	setText(row.name, c.state === "partial" ? `${c.name} ${c.running}/${c.total}` : c.name);
	const parts = [];
	if (c.uptime != null) parts.push(`<span>${esc(fmtUptime(c.uptime))}</span>`);
	if (c.memMB != null) parts.push(`<span>${c.memMB} MB</span>`);
	if (c.restarts) parts.push(`<span${c.restarts > 5 ? ' class="bad"' : ""}>↻ ${c.restarts}</span>`);
	setHTML(row.sub, parts.join(""));
	setHTML(row.graph, sparklineSvg(c.memHistory, "#8a8d94", 60, 12, 1.2));
}

function renderHealth(containers) {
	if (!$healthWrap || !$health) return;
	if (!containers?.length) {
		$healthWrap.hidden = true;
		$health.replaceChildren();
		healthRows.clear();
		return;
	}
	$healthWrap.hidden = false;

	const seen = new Set();
	for (const c of containers) {
		seen.add(c.name);
		let row = healthRows.get(c.name);
		if (!row) {
			row = createRow(c);
			healthRows.set(c.name, row);
		}
		updateRow(row, c);
	}

	for (const name of [...healthRows.keys()]) {
		if (seen.has(name)) continue;
		healthRows.get(name).el.remove();
		healthRows.delete(name);
	}

	// append() on an existing node only moves it — icons are never refetched
	const order = containers.map((c) => c.name).join("\u0001");
	const current = [...$health.children].map((n) => n.dataset.name).join("\u0001");
	if (order !== current) for (const c of containers) $health.append(healthRows.get(c.name).el);
}

function renderBuild(build) {
	const node = el("build");
	if (!node) return;
	if (!build?.sha && !build?.date) return setHTML(node, "");
	const parts = [];
	if (build.sha) {
		const short = esc(build.sha.slice(0, 7));
		parts.push(build.runUrl ? `<a href="${esc(build.runUrl)}" target="_blank" rel="noopener">${short}</a>` : short);
	}
	if (build.date) {
		const d = new Date(build.date);
		if (!isNaN(d)) parts.push(d.toISOString().slice(0, 16).replace("T", " ") + "Z");
	}
	setHTML(node, parts.join(" · "));
}

async function pollStats() {
	let d;
	try {
		d = await fetchJSON("/stats");
	} catch {
		tsOnline = false;
		updateDot();
		setText(el("s-ts-text"), "offline");
		setClass(el("s-ts-text"), "server-status bad");
		setText(el("s-clients"), "—");
		["s-cpu", "s-ram", "s-disk", "s-temp", "s-uptime", "s-clock"].forEach((id) => setText(el(id), "—"));
		["s-cpu", "s-ram", "s-disk"].forEach((id) => setSparkline(id, null));
		setCellState("s-temp", null, 65, 80);
		return;
	}

	tsOnline = !!d.ts?.online;
	updateDot();

	setText(el("s-ts-text"), tsOnline ? "online" : "offline");
	setClass(el("s-ts-text"), `server-status ${tsOnline ? "ok" : "bad"}`);
	setText(
		el("s-clients"),
		d.ts?.clients != null ? `${d.ts.clients}${d.ts.maxClients ? "/" + d.ts.maxClients : ""}` : "—",
	);

	const cpuPct = d.cpu?.percent ?? null;
	const ramPct = d.mem?.percent ?? null;
	const diskPct = d.disk?.percent ?? null;
	const tempC = d.temps?.[0]?.celsius ?? null;

	setText(el("s-cpu"), cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—");
	setText(el("s-ram"), ramPct != null ? `${ramPct.toFixed(0)}%` : "—");
	setText(el("s-disk"), diskPct != null ? `${diskPct.toFixed(0)}%` : "—");
	setText(el("s-temp"), tempC != null ? `${tempC.toFixed(0)}°` : "—");
	setText(el("s-uptime"), d.uptime ? fmtUptime(d.uptime.host) : "—");
	setText(
		el("s-clock"),
		d.clock
			? new Date(d.clock.iso).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					timeZone: d.clock.timezone,
					timeZoneName: "short",
				})
			: "—",
	);

	setSparkline("s-cpu", d.history?.cpu);
	setSparkline("s-ram", d.history?.ram);
	setSparkline("s-disk", d.history?.disk);
	setCellState("s-temp", tempC, 65, 80);
	renderHealth(d.containers);
	renderBuild(d.build);
}

schedule(poll, POLL_MS);
schedule(pollStats, STATS_MS);
setInterval(tick, TICK_MS);