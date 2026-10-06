import http from "node:http";
import {
	DOCKER_PROXY,
	DOCKER_TIMEOUT,
	HEALTH_EXCLUDE,
	HISTORY_SIZE,
	MEMORY_REFRESH_MS,
	MEMORY_TIMEOUT,
} from "../config.js";

const containerMemCache = new Map();
const appHistory = new Map();
let lastMemoryRefresh = 0;

export async function collectDocker() {
	const list = await listContainers();
	if (!list) return [];

	const groups = groupByProject(list);
	const now = Date.now();

	const entries = [];
	for (const [project, g] of groups.entries()) {
		if (HEALTH_EXCLUDE.has(project)) continue;
		entries.push(await summarize(project, g, now));
	}

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

async function summarize(project, g, now) {
	const mems = [];
	for (const id of g.runningIds) {
		mems.push(await containerMemoryMB(id));
	}
	const totalMemMB = Math.round(mems.reduce((a, b) => a + b, 0));

	const hist = appHistory.get(project) || [];
	hist.push(totalMemMB);
	if (hist.length > HISTORY_SIZE) hist.shift();
	appHistory.set(project, hist);

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
}

async function containerMemoryMB(id) {
	const cached = containerMemCache.get(id);
	const now = Date.now();
	if (cached && now - cached.ts < MEMORY_REFRESH_MS) return cached.mb;

	try {
		const r = await dockerRequest(`/containers/${id}/stats?stream=false`, MEMORY_TIMEOUT);
		if (r.status !== 200) return cached?.mb ?? 0;
		const s = JSON.parse(r.body);
		const usage = s.memory_stats?.usage ?? 0;
		const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0;
		const mb = Math.max(0, usage - cache) / 1024 / 1024;
		containerMemCache.set(id, { mb, ts: now });
		return mb;
	} catch {
		return cached?.mb ?? 0;
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
