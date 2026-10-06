import http from "node:http";
import { DOCKER_PROXY, DOCKER_TIMEOUT, HEALTH_EXCLUDE, HISTORY_SIZE, MEMORY_REFRESH_MS } from "../config.js";

const ICON_CACHE = new Map();
const ICON_TTL = 24 * 60 * 60 * 1000;

const appHistory = new Map();
let lastMemoryRefresh = 0;

export async function collectDocker() {
	const list = await listContainers();
	if (!list) return [];

	const groups = groupByProject(list);
	const now = Date.now();
	const memoryStale = now - lastMemoryRefresh > MEMORY_REFRESH_MS;
	if (memoryStale) lastMemoryRefresh = now;

	const entries = await Promise.all(
		[...groups.entries()]
			.filter(([project]) => !HEALTH_EXCLUDE.has(project))
			.map(([project, g]) => summarize(project, g, memoryStale, now)),
	);

	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function listContainers() {
	try {
		const r = await dockerRequest("/containers/json?all=true");
		if (r.status !== 200) return null;
		return JSON.parse(r.body);
	} catch {
		return null;
	}
}

function groupByProject(list) {
	const groups = new Map();

	for (const c of list) {
		const name = (c.Names?.[0] || "").replace(/^\//, "");
		if (!name) continue;

		const state = c.State || "unknown";
		const status = c.Status || "";
		const exitedClean = /^Exited \(0\)/.test(status);
		const ok = state === "running" || exitedClean;
		const running = state === "running";

		const project = c.Labels?.["com.docker.compose.project"] || name;
		const startedAt = c.StartedAt ? new Date(c.StartedAt).getTime() : null;

		if (!groups.has(project)) {
			groups.set(project, { checks: [], startedAt: null, restarts: 0, runningIds: [] });
		}

		const g = groups.get(project);
		g.checks.push(ok);
		g.restarts += Number(c.RestartCount || 0);
		if (running) {
			g.runningIds.push(c.Id);
			if (startedAt && (!g.startedAt || startedAt < g.startedAt)) g.startedAt = startedAt;
		}
	}

	return groups;
}

async function summarize(project, g, memoryStale, now) {
	const hist = appHistory.get(project) || [];

	if (memoryStale) {
		const mems = await Promise.all(g.runningIds.map(containerMemoryMB));
		const total = Math.round(mems.reduce((a, b) => a + b, 0));
		hist.push(total);
		if (hist.length > HISTORY_SIZE) hist.shift();
		appHistory.set(project, hist);
	}

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
		memMB: hist.length ? hist[hist.length - 1] : 0,
		memHistory: [...hist],
	};
}

async function containerMemoryMB(id) {
	try {
		const r = await dockerRequest(`/containers/${id}/stats?stream=false`, DOCKER_TIMEOUT);
		if (r.status !== 200) return 0;
		const s = JSON.parse(r.body);
		const usage = s.memory_stats?.usage ?? 0;
		const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0;
		return Math.max(0, usage - cache) / 1024 / 1024;
	} catch {
		return 0;
	}
}

function dockerRequest(path, timeout = DOCKER_TIMEOUT) {
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

export async function fetchIcon(slug) {
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
