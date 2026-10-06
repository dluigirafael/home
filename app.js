const $ = (id) => document.getElementById(id);
const text = (n, t) => n && n.textContent !== t && (n.textContent = t);
const attr = (n, k, v) => n && n.getAttribute(k) !== v && n.setAttribute(k, v);
const show = (n, on) => n && (n.hidden = !on);

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
let musicStatus = "idle";
let tsOnline = false;
let nowPlaying = null;

const pct = () => (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0);

async function fetchJSON(url) {
	const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_MS) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
}

const schedule = (fn, ms) =>
	fn()
		.catch(() => {})
		.finally(() => setTimeout(() => schedule(fn, ms), ms));

const ICON_BASE = "https://media.sys.truenas.net/apps";
const ICON_FILES = ["icon.svg", "icon.png"];
const iconIdx = new Map();

function iconUrl(slug) {
	const idx = iconIdx.get(slug) ?? 0;
	iconIdx.set(slug, idx);
	return idx < ICON_FILES.length ? `${ICON_BASE}/${slug}/icons/${ICON_FILES[idx]}` : null;
}

$("health").addEventListener(
	"error",
	(e) => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement)) return;
		const slug = img.dataset.slug;
		iconIdx.set(slug, (iconIdx.get(slug) ?? 0) + 1);
		const url = iconUrl(slug);
		if (url) img.src = url;
		else img.remove();
	},
	true,
);

const qItems = Array.from({ length: 5 }, () => {
	const li = $("tpl-queue-item").content.firstElementChild.cloneNode(true);
	$("q-list").append(li);
	return li;
});

function paintProgress() {
	text($("pos"), fmt(pos));
	text($("dur"), fmt(dur));
	$("bar").style.setProperty("--pct", pct());
}

function renderNow(emptyMsg) {
	if (!nowPlaying) {
		text($("np-empty"), emptyMsg);
		show($("np"), false);
		show($("np-empty"), true);
		return;
	}
	text($("np-title"), nowPlaying.title || "Unknown");
	text($("np-artist"), nowPlaying.artist || "");
	paintProgress();
	show($("np-empty"), false);
	show($("np"), true);
}

function renderQueue(upcoming, total) {
	const list = (upcoming || []).slice(0, 5);
	show($("queue"), list.length > 0);
	if (!list.length) return;
	text($("q-count"), String(Number(total) || list.length));
	qItems.forEach((li, i) => {
		const item = list[i];
		li.hidden = !item;
		if (!item) return;
		text(li.querySelector(".q-title"), item.title || "Unknown");
		text(li.querySelector(".q-artist"), item.artist || "");
		text(li.querySelector(".q-dur"), item.duration ? fmt(item.duration) : "");
	});
}

function tick() {
	if (musicStatus !== "playing" || !nowPlaying) return;
	pos = Math.min(pos + 1, dur);
	paintProgress();
}

function updateDot() {
	attr($("dot"), "data-state", tsOnline ? (musicStatus === "paused" ? "paused" : "playing") : "offline");
}

async function poll() {
	let d;
	try {
		d = await fetchJSON("/data");
	} catch {
		nowPlaying = null;
		trackId = undefined;
		musicStatus = "idle";
		renderNow("Unavailable");
		renderQueue([]);
		updateDot();
		return;
	}

	const np = d.nowPlaying ?? null;
	const id = np ? `${np.title}|${np.artist || ""}` : null;

	if (id !== trackId) {
		trackId = id;
		pos = d.progress?.position ?? 0;
		dur = d.progress?.duration ?? np?.duration ?? 0;
		nowPlaying = np;
	} else {
		const serverPos = d.progress?.position ?? 0;
		if (Math.abs(serverPos - pos) > 2) pos = serverPos;
		dur = d.progress?.duration ?? np?.duration ?? dur;
	}

	musicStatus = d.status === "playing" ? "playing" : d.status === "paused" ? "paused" : "idle";
	updateDot();
	renderNow("Nothing playing");
	renderQueue(d.upcoming, d.queueLength);
}

function sparkline(el, values, w, h, stroke) {
	if (!el) return;
	if (!values || values.length < 2) {
		el.replaceChildren();
		return;
	}
	const max = Math.max(...values, 1);
	const step = w / (values.length - 1);
	const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
	const html = `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="#8a8d94" stroke-width="${stroke}" vector-effect="non-scaling-stroke"/>
  </svg>`;
	if (el.innerHTML !== html) el.innerHTML = html;
}

function setMetric(id, value) {
	text($(id), value);
}

function setCellLevel(id, value, warnAt, hotAt) {
	const cell = $(id)?.closest(".cell");
	if (!cell) return;
	const level = value != null && value >= hotAt ? "hot" : value != null && value >= warnAt ? "warn" : "";
	attr(cell, "data-level", level);
}

const healthRows = new Map();
const slugFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function createRow(c) {
	const row = $("tpl-health").content.firstElementChild.cloneNode(true);
	row.dataset.name = c.name;
	const slug = slugFor(c.name);
	const img = row.querySelector(".h-icon");
	const src = iconUrl(slug);
	if (src) {
		img.dataset.slug = slug;
		img.src = src;
	}
	return row;
}

function updateRow(row, c) {
	const state = c.state === "running" ? "ok" : c.state === "partial" ? "warn" : "bad";
	attr(row.querySelector(".h-dot"), "data-state", state);
	text(row.querySelector(".h-name"), c.state === "partial" ? `${c.name} ${c.running}/${c.total}` : c.name);
	text(row.querySelector('[data-k="uptime"]'), c.uptime != null ? fmtUptime(c.uptime) : "");
	text(row.querySelector('[data-k="mem"]'), c.memMB != null ? `${c.memMB} MB` : "");
	const restarts = row.querySelector('[data-k="restarts"]');
	text(restarts, c.restarts ? `↻ ${c.restarts}` : "");
	attr(restarts, "data-state", c.restarts > 5 ? "bad" : "");
	sparkline(row.querySelector(".h-graph"), c.memHistory, 60, 12, 1.2);
}

function renderHealth(containers) {
	const wrap = $("health-wrap");
	const list = $("health");
	if (!containers?.length) {
		show(wrap, false);
		list.replaceChildren();
		healthRows.clear();
		return;
	}
	show(wrap, true);

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
		healthRows.get(name).remove();
		healthRows.delete(name);
	}

	const order = containers.map((c) => c.name).join("\u0001");
	const current = [...list.children].map((n) => n.dataset.name).join("\u0001");
	if (order !== current) for (const c of containers) list.append(healthRows.get(c.name));
}

function renderBuild(build) {
	const hasSha = !!build?.sha;
	const date = build?.date ? new Date(build.date) : null;
	const hasDate = date && !isNaN(date);
	show($("build"), hasSha || hasDate);
	if (!hasSha && !hasDate) return;

	const sha = $("build-sha");
	if (hasSha) {
		text(sha, build.sha.slice(0, 7));
		if (build.runUrl) sha.href = build.runUrl;
		else sha.removeAttribute("href");
	} else {
		text(sha, "");
		sha.removeAttribute("href");
	}
	show($("build-sep"), hasSha && hasDate);
	text($("build-date"), hasDate ? date.toISOString().slice(0, 16).replace("T", " ") + "Z" : "");
}

function statsOffline() {
	tsOnline = false;
	updateDot();
	text($("s-ts-text"), "offline");
	attr($("s-ts-text"), "data-state", "bad");
	setMetric("s-clients", "—");
	["s-cpu", "s-ram", "s-disk", "s-temp", "s-uptime", "s-clock"].forEach((id) => setMetric(id, "—"));
	["s-cpu", "s-ram", "s-disk"].forEach((id) => sparkline($(id + "-spark"), null));
	setCellLevel("s-temp", null, 65, 80);
}

async function pollStats() {
	let d;
	try {
		d = await fetchJSON("/stats");
	} catch {
		statsOffline();
		return;
	}

	tsOnline = !!d.ts?.online;
	updateDot();
	text($("s-ts-text"), tsOnline ? "online" : "offline");
	attr($("s-ts-text"), "data-state", tsOnline ? "ok" : "bad");
	setMetric(
		"s-clients",
		d.ts?.clients != null ? `${d.ts.clients}${d.ts.maxClients ? "/" + d.ts.maxClients : ""}` : "—",
	);

	const cpuPct = d.cpu?.percent ?? null;
	const ramPct = d.mem?.percent ?? null;
	const diskPct = d.disk?.percent ?? null;
	const tempC = d.temps?.[0]?.celsius ?? null;

	setMetric("s-cpu", cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—");
	setMetric("s-ram", ramPct != null ? `${ramPct.toFixed(0)}%` : "—");
	setMetric("s-disk", diskPct != null ? `${diskPct.toFixed(0)}%` : "—");
	setMetric("s-temp", tempC != null ? `${tempC.toFixed(0)}°` : "—");
	setMetric("s-uptime", d.uptime ? fmtUptime(d.uptime.host) : "—");
	setMetric(
		"s-clock",
		d.clock
			? new Date(d.clock.iso).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					timeZone: d.clock.timezone,
					timeZoneName: "short",
				})
			: "—",
	);

	sparkline($("s-cpu-spark"), d.history?.cpu, 100, 16, 1.5);
	sparkline($("s-ram-spark"), d.history?.ram, 100, 16, 1.5);
	sparkline($("s-disk-spark"), d.history?.disk, 100, 16, 1.5);
	setCellLevel("s-temp", tempC, 65, 80);
	renderHealth(d.containers);
	renderBuild(d.build);
}

schedule(poll, POLL_MS);
schedule(pollStats, STATS_MS);
setInterval(tick, TICK_MS);
