const $now = document.getElementById("now");
const $queue = document.getElementById("queue");
const $dot = document.getElementById("dot");

const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);

const fmt = (sec) => {
	sec = Math.max(0, Math.floor(sec || 0));
	return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

const fmtUptime = (s) => {
	s = Math.floor(s || 0);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const POLL_MS = 5000;
const STATS_MS = 10000;
const TICK_MS = 1000;

let pos = 0;
let dur = 0;
let trackId = undefined;
let playing = false;

const pct = () => (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0);

// ─── Now playing ─────────────────────────────────────────────

function renderNow() {
	const np = window.__np;
	if (!np) {
		$now.innerHTML = '<span class="empty">Nothing playing</span>';
		return;
	}
	if (!document.getElementById("pos")) {
		$now.innerHTML = `
      <div class="title">${esc(np.title || "Unknown")}</div>
      ${np.artist ? `<div class="artist">${esc(np.artist)}</div>` : ""}
      <div class="progress">
        <span class="t" id="pos"></span>
        <div class="bar"><span id="bar"></span></div>
        <span class="t" id="dur">${fmt(dur)}</span>
      </div>`;
	}
	document.getElementById("pos").textContent = fmt(pos);
	document.getElementById("bar").style.width = `${pct()}%`;
}

function renderQueue(upcoming, total) {
	const listCount = upcoming?.length || 0;
	const queueTotal = Number(total) || listCount;

	if (listCount === 0) {
		$queue.innerHTML = "";
		return;
	}
	$queue.innerHTML = `
    <div class="queue">
      <h2><span>Up Next</span><span class="count">${queueTotal}</span></h2>
      <ol>
        ${upcoming
					.slice(0, 5)
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
    </div>`;
}

function tick() {
	if (!playing || !window.__np) return;
	pos = Math.min(pos + 1, dur);
	const $p = document.getElementById("pos");
	const $b = document.getElementById("bar");
	if ($p) $p.textContent = fmt(pos);
	if ($b) $b.style.width = `${pct()}%`;
}

async function poll() {
	try {
		const r = await fetch("/data", { cache: "no-store" });
		if (!r.ok) throw 0;
		const d = await r.json();
		const np = d.nowPlaying;
		const id = np ? `${np.title}|${np.artist || ""}` : null;

		if (id !== trackId) {
			trackId = id;
			pos = d.progress?.position ?? 0;
			dur = d.progress?.duration ?? np?.duration ?? 0;
			window.__np = np;
			$now.innerHTML = "";
			renderNow();
			renderQueue(d.upcoming, d.queueLength);
		} else {
			// 2s tolerance absorbs setInterval drift and server jitter without visibly snapping the bar
			const serverPos = d.progress?.position ?? 0;
			if (Math.abs(serverPos - pos) > 2) pos = serverPos;
			dur = d.progress?.duration ?? np?.duration ?? dur;
		}

		playing = d.status === "playing";
		$dot.className = `dot ${playing ? "playing" : d.status === "paused" ? "paused" : ""}`;
	} catch {
		$now.innerHTML = '<span class="empty">Unavailable</span>';
		$queue.innerHTML = "";
		$dot.className = "dot";
		playing = false;
	}
}

// ─── Sparklines ──────────────────────────────────────────────

function sparklineSvg(values, color, w, h, strokeW) {
	if (!values || values.length < 2) return "";
	const max = Math.max(...values, 1);
	const step = w / (values.length - 1);
	const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
	return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function setSparkline(id, values) {
	const el = document.getElementById(`${id}-spark`);
	if (!el) return;
	el.innerHTML = sparklineSvg(values, "#8a8d94", 100, 16, 1.5);
}

function setCellState(id, value, warnAt, hotAt) {
	const cell = document.getElementById(id)?.closest(".cell");
	if (!cell) return;
	cell.classList.toggle("warn", value != null && value >= warnAt && value < hotAt);
	cell.classList.toggle("hot", value != null && value >= hotAt);
}

// ─── Health ──────────────────────────────────────────────────

function renderHealth(containers) {
	const wrap = document.querySelector(".health-wrap");
	const el = document.getElementById("health");
	if (!wrap || !el) return;

	if (!containers?.length) {
		wrap.hidden = true;
		el.innerHTML = "";
		return;
	}
	wrap.hidden = false;

	el.innerHTML = containers
		.map((c) => {
			const cls = c.state === "running" ? "ok" : c.state === "partial" ? "warn" : "bad";
			const count = c.state === "partial" ? ` ${c.running}/${c.total}` : "";
			const up = c.uptime != null ? fmtUptime(c.uptime) : "";
			const badRestarts = c.restarts > 5;
			const mem = c.memMB != null ? `${c.memMB} MB` : "";
			const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			return `<div class="h-item">
        <img class="h-icon" src="/icons/${slug}.svg" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="h-dot ${cls}"></span>
        <div class="h-meta">
          <span class="h-name">${esc(c.name)}${count}</span>
          <span class="h-sub">
            ${up ? `<span>${up}</span>` : ""}
            ${mem ? `<span>${mem}</span>` : ""}
            ${c.restarts ? `<span class="${badRestarts ? "bad" : ""}">↻ ${c.restarts}</span>` : ""}
          </span>
        </div>
        <span class="h-graph">${sparklineSvg(c.memHistory, "#8a8d94", 60, 12, 1.2)}</span>
      </div>`;
		})
		.join("");
}

function renderBuild(build) {
	const el = document.getElementById("build");
	if (!el || !build) return;
	const parts = [];
	if (build.sha) {
		const short = build.sha.slice(0, 7);
		parts.push(
			build.runUrl
				? `<a href="${esc(build.runUrl)}" target="_blank" rel="noopener">${esc(short)}</a>`
				: esc(short),
		);
	}
	if (build.date) {
		const d = new Date(build.date);
		if (!isNaN(d)) parts.push(d.toISOString().slice(0, 16).replace("T", " ") + "Z");
	}
	el.innerHTML = parts.join(" · ") || "";
}

// ─── Stats ───────────────────────────────────────────────────

async function pollStats() {
	const el = (id) => document.getElementById(id);
	try {
		const r = await fetch("/stats", { cache: "no-store" });
		if (!r.ok) throw 0;
		const d = await r.json();

		const online = !!d.ts?.online;
		el("s-ts-text").textContent = online ? "online" : "offline";
		el("s-ts-text").className = `server-status ${online ? "ok" : "bad"}`;
		$dot.className = `dot ${online ? "playing" : ""}`;

		el("s-clients").textContent =
			d.ts?.clients != null ? `${d.ts.clients}${d.ts.maxClients ? "/" + d.ts.maxClients : ""}` : "—";

		const cpuPct = d.cpu?.percent ?? null;
		const ramPct = d.mem?.percent ?? null;
		const diskPct = d.disk?.percent ?? null;
		const tempC = d.temps?.[0]?.celsius ?? null;

		el("s-cpu").textContent = cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—";
		el("s-ram").textContent = ramPct != null ? `${ramPct.toFixed(0)}%` : "—";
		el("s-disk").textContent = diskPct != null ? `${diskPct.toFixed(0)}%` : "—";
		el("s-temp").textContent = tempC != null ? `${tempC.toFixed(0)}°` : "—";
		el("s-uptime").textContent = d.uptime ? fmtUptime(d.uptime.host) : "—";
		el("s-clock").textContent = d.clock
			? new Date(d.clock.iso).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					timeZone: d.clock.timezone,
					timeZoneName: "short",
				})
			: "—";

		setSparkline("s-cpu", d.history?.cpu);
		setSparkline("s-ram", d.history?.ram);
		setSparkline("s-disk", d.history?.disk);
		setCellState("s-temp", tempC, 65, 80);
		renderHealth(d.containers);
		renderBuild(d.build);
	} catch {
		el("s-ts-text").textContent = "offline";
		el("s-ts-text").className = "server-status bad";
		el("s-clients").textContent = "—";
		["s-cpu", "s-ram", "s-disk", "s-temp", "s-uptime", "s-clock"].forEach((id) => {
			el(id).textContent = "—";
		});
		["s-cpu", "s-ram", "s-disk"].forEach((id) => setSparkline(id, null));
		setCellState("s-temp", null, 65, 80);
		renderHealth([]);
	}
}

poll();
pollStats();
setInterval(tick, TICK_MS);
setInterval(poll, POLL_MS);
setInterval(pollStats, STATS_MS);
