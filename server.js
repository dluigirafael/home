import http from "node:http";
import os from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.WIDGET_TOKEN;
if (!TOKEN) {
	console.error("WIDGET_TOKEN is required");
	process.exit(1);
}

const PORT = process.env.PORT || 3000;
const MANAGER = process.env.MANAGER_URL || "http://ts6-backend:3001";
const BOT_ID = process.env.BOT_ID || "2";
const CACHE_MS = Number(process.env.CACHE_MS || 3000);

const TS_HOST = process.env.TS_HOST || "teamspeak";
const TS_QUERY_PORT = process.env.TS_QUERY_PORT || 10080;
const TS_API_KEY = process.env.TS_API_KEY;
const TS_BOT_GROUP_NAME = "Bots";

const DOCKER_PROXY = process.env.DOCKER_PROXY || "http://docker-socket-proxy:2375";
const HEALTH_EXCLUDE = new Set(
	(process.env.HEALTH_EXCLUDE || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);

const CPU_HWMON = new Set(["k10temp", "zenpower", "coretemp", "cpu_thermal"]);
const PREFERRED_LABELS = [/^Tctl$/i, /^Package id 0$/i, /^Composite$/i, /^CPU/i];

const PAGE = await readFile(join(__dirname, "index.html"));
const STYLES = await readFile(join(__dirname, "styles.css"));
const APP = await readFile(join(__dirname, "app.js"));

let musicCache = { body: null, ts: 0 };
let statsCache = { body: null, ts: 0 };
const STATS_CACHE_MS = 5000;

const HISTORY_SIZE = 60;
const history = { cpu: [], ram: [], disk: [] };
const appHistory = new Map(); // project -> [memMB]

const ICON_CACHE = new Map();
const ICON_TTL = 24 * 60 * 60 * 1000;

const json = (res, code, body) => {
	res.writeHead(code, { "content-type": "application/json" });
	res.end(typeof body === "string" ? body : JSON.stringify(body));
};

function httpRequest(url, { method = "GET", headers = {}, body = null, timeout = 3000 } = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = http.request(
			{ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
			(res) => {
				let data = "";
				res.on("data", (c) => (data += c));
				res.on("end", () => resolve({ status: res.statusCode, body: data }));
			},
		);
		req.on("error", reject);
		req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
		if (body) req.write(body);
		req.end();
	});
}

// ─── TeamSpeak ───────────────────────────────────────────────

let botGroupCache = { sgid: null, ts: 0 };
const GROUP_CACHE_MS = 60000;

async function tsInfo() {
	if (!TS_API_KEY) return { online: false, clients: null, maxClients: null };
	try {
		const url = `http://${TS_HOST}:${TS_QUERY_PORT}/1/serverinfo`;
		const r = await httpRequest(url, { headers: { "x-api-key": TS_API_KEY } });
		if (r.status < 200 || r.status >= 300) return { online: false, clients: null, maxClients: null };
		const parsed = JSON.parse(r.body);
		const d = Array.isArray(parsed.body) ? parsed.body[0] : parsed.body;
		const online = Number(d.virtualserver_clientsonline ?? 0);
		const query = Number(d.virtualserver_queryclientsonline ?? 0);
		return {
			online: true,
			clients: Math.max(0, online - query) || null,
			maxClients: Number(d.virtualserver_maxclients ?? 0) || null,
		};
	} catch {
		return { online: false, clients: null, maxClients: null };
	}
}

async function getBotGroupId() {
	const now = Date.now();
	if (botGroupCache.sgid && now - botGroupCache.ts < GROUP_CACHE_MS) return botGroupCache.sgid;
	try {
		const url = `http://${TS_HOST}:${TS_QUERY_PORT}/1/servergrouplist`;
		const r = await httpRequest(url, { headers: { "x-api-key": TS_API_KEY } });
		if (r.status < 200 || r.status >= 300) return null;
		const parsed = JSON.parse(r.body);
		const list = Array.isArray(parsed.body) ? parsed.body : [];
		const match = list.find((g) => g.name === TS_BOT_GROUP_NAME);
		if (!match) return null;
		botGroupCache = { sgid: String(match.sgid), ts: now };
		return botGroupCache.sgid;
	} catch {
		return null;
	}
}

async function tsHumans() {
	if (!TS_API_KEY) return null;
	try {
		const sgid = await getBotGroupId();
		if (!sgid) return null;
		const url = `http://${TS_HOST}:${TS_QUERY_PORT}/1/clientlist?-groups`;
		const r = await httpRequest(url, { headers: { "x-api-key": TS_API_KEY } });
		if (r.status < 200 || r.status >= 300) return null;
		const parsed = JSON.parse(r.body);
		const list = Array.isArray(parsed.body) ? parsed.body : [];
		return list.filter((c) => {
			if (String(c.client_type) !== "0") return false;
			const groups = String(c.client_servergroups || "")
				.split(",")
				.map((s) => s.trim());
			if (groups.includes(sgid)) return false;
			return true;
		}).length;
	} catch {
		return null;
	}
}

// ─── Host metrics ────────────────────────────────────────────

async function diskInfo() {
	try {
		const { stdout } = await execFileAsync("df", ["-k", "/"]);
		const line = stdout.trim().split("\n")[1];
		const [, blocks, used, avail] = line.split(/\s+/);
		const total = Number(blocks) * 1024;
		const usedBytes = Number(used) * 1024;
		const availBytes = Number(avail) * 1024;
		return { total, used: usedBytes, free: availBytes, percent: (usedBytes / total) * 100 };
	} catch {
		return null;
	}
}

async function tempInfo() {
	try {
		const hwmons = await readdir("/sys/class/hwmon");
		const results = [];
		for (const h of hwmons) {
			if (!h.startsWith("hwmon")) continue;
			const base = `/sys/class/hwmon/${h}`;
			const name = (await readFile(`${base}/name`, "utf8").catch(() => "")).trim();
			if (!CPU_HWMON.has(name)) continue;
			const files = await readdir(base).catch(() => []);
			const inputs = files.filter((f) => /^temp\d+_input$/.test(f));
			for (const f of inputs) {
				const idx = f.match(/^temp(\d+)_input$/)[1];
				const raw = Number((await readFile(`${base}/${f}`, "utf8").catch(() => "")).trim());
				if (!Number.isFinite(raw) || raw <= 0) continue;
				const celsius = raw > 1000 ? raw / 1000 : raw;
				if (celsius < 20 || celsius > 120) continue;
				const label =
					(await readFile(`${base}/temp${idx}_label`, "utf8").catch(() => "")).trim() || `temp${idx}`;
				results.push({ zone: label, celsius, sensor: name });
			}
		}
		results.sort((a, b) => {
			const score = (r) => PREFERRED_LABELS.findIndex((re) => re.test(r.zone));
			const sa = score(a);
			const sb = score(b);
			if (sa === -1 && sb === -1) return 0;
			if (sa === -1) return 1;
			if (sb === -1) return -1;
			return sa - sb;
		});
		const seen = new Set();
		return results.filter((r) => {
			if (seen.has(r.sensor)) return false;
			seen.add(r.sensor);
			return true;
		});
	} catch {
		return [];
	}
}

function cpuInfo() {
	const cpus = os.cpus();
	const load1 = os.loadavg()[0];
	const percent = Math.min(100, (load1 / cpus.length) * 100);
	return { cores: cpus.length, load1, percent };
}

function memInfo() {
	const total = os.totalmem();
	const free = os.freemem();
	const used = total - free;
	return { total, used, free, percent: (used / total) * 100 };
}

function uptimeInfo() {
	return { host: os.uptime(), process: process.uptime() };
}

function clockInfo() {
	const now = new Date();
	return {
		iso: now.toISOString(),
		epoch: Math.floor(now.getTime() / 1000),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	};
}

// ─── Docker ──────────────────────────────────────────────────

function dockerRequest(path, timeout = 3000) {
	return new Promise((resolve, reject) => {
		const u = new URL(DOCKER_PROXY);
		const req = http.request({ hostname: u.hostname, port: u.port, path, method: "GET" }, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => resolve({ status: res.statusCode, body: data }));
		});
		req.on("error", reject);
		req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
		req.end();
	});
}

async function containerMemoryMB(id) {
	try {
		const r = await dockerRequest(`/containers/${id}/stats?stream=false`, 4000);
		if (r.status !== 200) return 0;
		const s = JSON.parse(r.body);
		const usage = s.memory_stats?.usage ?? 0;
		const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0;
		return Math.max(0, usage - cache) / 1024 / 1024;
	} catch {
		return 0;
	}
}

async function containersInfo() {
	try {
		const r = await dockerRequest("/containers/json?all=true");
		if (r.status !== 200) return [];
		const list = JSON.parse(r.body);

		const now = Date.now();
		const groups = new Map();

		for (const c of list) {
			const name = (c.Names?.[0] || "").replace(/^\//, "");
			if (!name) continue;

			const state = c.State || "unknown";
			const status = c.Status || "";
			const exitedClean = /^Exited \(0\)/.test(status);
			const ok = state === "running" || exitedClean;

			const labels = c.Labels || {};
			const project = labels["com.docker.compose.project"] || name;
			const startedAt = c.StartedAt ? new Date(c.StartedAt).getTime() : null;
			const running = state === "running";

			if (!groups.has(project)) {
				groups.set(project, { checks: [], startedAt: null, restarts: 0, containerIds: [] });
			}
			const g = groups.get(project);
			g.checks.push(ok);
			g.restarts += Number(c.RestartCount || 0);
			if (running && startedAt) {
				if (!g.startedAt || startedAt < g.startedAt) g.startedAt = startedAt;
			}
			if (running) g.containerIds.push(c.Id);
		}

		const entries = await Promise.all(
			[...groups.entries()]
				.filter(([project]) => !HEALTH_EXCLUDE.has(project))
				.map(async ([project, g]) => {
					const mems = await Promise.all(g.containerIds.map(containerMemoryMB));
					const totalMemMB = Math.round(mems.reduce((a, b) => a + b, 0));

					if (!appHistory.has(project)) appHistory.set(project, []);
					const hist = appHistory.get(project);
					hist.push(totalMemMB);
					if (hist.length > HISTORY_SIZE) hist.shift();

					const okCount = g.checks.filter(Boolean).length;
					const total = g.checks.length;
					const state = okCount === total ? "running" : okCount === 0 ? "stopped" : "partial";

					return {
						name: project.replace(/^ix-/, ""),
						state,
						running: okCount,
						total,
						uptime: g.startedAt ? Math.floor((now - g.startedAt) / 1000) : null,
						restarts: g.restarts,
						memMB: totalMemMB,
						memHistory: [...hist],
					};
				}),
		);

		return entries.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

// ─── Icon proxy ──────────────────────────────────────────────

async function fetchIcon(slug) {
	const cached = ICON_CACHE.get(slug);
	if (cached && Date.now() - cached.ts < ICON_TTL) return cached;

	const urls = [
		`https://media.sys.truenas.net/apps/${slug}/icon/logo.svg`,
		`https://media.sys.truenas.net/apps/${slug}/icon/logo.png`,
	];
	for (const url of urls) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
			if (!r.ok) continue;
			const buf = Buffer.from(await r.arrayBuffer());
			const entry = {
				buf,
				contentType: r.headers.get("content-type") || "image/svg+xml",
				ts: Date.now(),
			};
			ICON_CACHE.set(slug, entry);
			return entry;
		} catch {
			// try next
		}
	}
	ICON_CACHE.set(slug, { buf: null, ts: Date.now() });
	return null;
}

// ─── Aggregation ─────────────────────────────────────────────

async function gatherStats() {
	const [ts, disk, temps, humans, containers] = await Promise.all([
		tsInfo(),
		diskInfo(),
		tempInfo(),
		tsHumans(),
		containersInfo(),
	]);

	const cpu = cpuInfo();
	const mem = memInfo();
	const push = (arr, v) => {
		arr.push(Number.isFinite(v) ? Number(v.toFixed(1)) : 0);
		if (arr.length > HISTORY_SIZE) arr.shift();
	};
	push(history.cpu, cpu.percent);
	push(history.ram, mem.percent);
	push(history.disk, disk?.percent ?? 0);

	return {
		ts: { ...ts, clients: humans ?? ts.clients },
		cpu,
		mem,
		disk,
		temps,
		uptime: uptimeInfo(),
		clock: clockInfo(),
		containers,
		history: {
			cpu: [...history.cpu],
			ram: [...history.ram],
			disk: [...history.disk],
		},
		build: {
			sha: process.env.GIT_SHA || null,
			date: process.env.BUILD_DATE || null,
			runUrl: process.env.GH_RUN_URL || null,
		},
	};
}

// ─── HTTP ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
	if (req.method !== "GET") {
		res.writeHead(405).end();
		return;
	}

	const path = new URL(req.url, "http://x").pathname;

	if (path === "/" || path === "/index.html") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(PAGE);
		return;
	}

	if (path === "/styles.css") {
		res.writeHead(200, {
			"content-type": "text/css; charset=utf-8",
			"cache-control": "public, max-age=3600",
		});
		res.end(STYLES);
		return;
	}

	if (path === "/app.js") {
		res.writeHead(200, {
			"content-type": "application/javascript; charset=utf-8",
			"cache-control": "public, max-age=3600",
		});
		res.end(APP);
		return;
	}

	if (path.startsWith("/icons/") && path.endsWith(".svg")) {
		const file = path.slice(7);
		if (!/^[a-z0-9-]+\.svg$/.test(file)) {
			res.writeHead(400).end();
			return;
		}
		const slug = file.slice(0, -4);
		const icon = await fetchIcon(slug);
		if (!icon || !icon.buf) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, {
			"content-type": icon.contentType,
			"cache-control": "public, max-age=86400",
		});
		res.end(icon.buf);
		return;
	}

	if (path === "/data") {
		const now = Date.now();
		if (musicCache.body && now - musicCache.ts < CACHE_MS) {
			return json(res, 200, musicCache.body);
		}
		try {
			const r = await fetch(`${MANAGER}/api/widget/player/${BOT_ID}/data?token=${encodeURIComponent(TOKEN)}`, {
				signal: AbortSignal.timeout(5000),
			});
			const body = await r.text();
			if (!r.ok) return json(res, 502, { error: "upstream", status: r.status });
			musicCache = { body, ts: now };
			return json(res, 200, body);
		} catch (e) {
			return json(res, 502, { error: "unreachable", message: e.message });
		}
	}

	if (path === "/stats") {
		const now = Date.now();
		if (statsCache.body && now - statsCache.ts < STATS_CACHE_MS) {
			return json(res, 200, statsCache.body);
		}
		try {
			const data = await gatherStats();
			statsCache = { body: data, ts: now };
			return json(res, 200, data);
		} catch (e) {
			return json(res, 502, { error: "stats_failed", message: e.message });
		}
	}

	res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`listening on :${PORT}`));
