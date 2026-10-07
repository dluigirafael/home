import {
	DOCKER_PROXY,
	DOCKER_TIMEOUT,
	HEALTH_EXCLUDE,
	HISTORY_SIZE,
	MEMORY_REFRESH_MS,
	MEMORY_TIMEOUT,
} from "../config.js";

const containerStatsCache = new Map();

const appHistory = new Map();

export async function collectDocker() {
	const list = await listContainers();
	if (!list) return [];

	const groups = groupByProject(list);
	const now = Date.now();

	const entries = await Promise.all(
		[...groups.entries()]
			.filter(([project]) => !HEALTH_EXCLUDE.has(project))
			.map(([project, g]) => summarize(project, g, now)),
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

async function summarize(project, g, now) {
  const results = await Promise.all(g.runningIds.map(containerStats));

  const totalMemMB = Math.round(results.reduce((a, r) => a + r.memMB, 0));
  const cpuPct = Math.round(results.reduce((a, r) => a + r.cpuPct, 0) * 10) / 10;

  const cpuHist = appCpuHistory.get(project) || [];
  cpuHist.push(cpuPct);
  if (cpuHist.length > HISTORY_SIZE) cpuHist.shift();
  appCpuHistory.set(project, cpuHist);

  const memHist = appHistory.get(project) || [];
  memHist.push(totalMemMB);
  if (memHist.length > HISTORY_SIZE) memHist.shift();
  appHistory.set(project, memHist);

  const okCount = g.checks.filter(Boolean).length;
  const total = g.checks.length;
  const state = okCount === total ? 'running' : okCount === 0 ? 'stopped' : 'partial';

  return {
    name: project.replace(/^ix-/, ''),
    state,
    running: okCount,
    total,
    uptime: g.startedAt ? Math.floor((now - g.startedAt) / 1000) : null,
    restarts: g.restarts,
    memMB: totalMemMB,
    cpuPct,
    cpuHistory: [...cpuHist],
    memHistory: [...memHist],
  };
}
const containerStats = async (id) => {
  const prev = containerStatsCache.get(id);
  const now = Date.now();

  if (prev && now - prev.ts < MEMORY_REFRESH_MS) {
    return { memMB: prev.memMB, cpuPct: prev.cpuPct };
  }

  try {
    const r = await dockerRequest(`/containers/${id}/stats?stream=false`, MEMORY_TIMEOUT);
    if (r.status !== 200) {
      return { memMB: prev?.memMB ?? 0, cpuPct: prev?.cpuPct ?? 0 };
    }
    const s = JSON.parse(r.body);

    const usage = s.memory_stats?.usage ?? 0;
    const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0;
    const memMB = Math.max(0, usage - cache) / 1024 / 1024;

    const cpu = s.cpu_stats || {};
    const total = cpu.cpu_usage?.total_usage ?? 0;
    const system = cpu.system_cpu_usage ?? 0;
    const cpus = cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 1;

    let cpuPct = 0;
    if (prev) {
      const dc = total - prev.total;
      const ds = system - prev.system;
      if (ds > 0 && dc >= 0) cpuPct = (dc / ds) * cpus * 100;
    }

    containerStatsCache.set(id, { memMB, cpuPct, total, system, cpus, ts: now });
    return { memMB, cpuPct };
  } catch {
    return { memMB: prev?.memMB ?? 0, cpuPct: prev?.cpuPct ?? 0 };
  }
};
async function dockerRequest(path, timeout = DOCKER_TIMEOUT) {
	const res = await fetch(new URL(path, DOCKER_PROXY), { signal: AbortSignal.timeout(timeout) });
	return { status: res.status, body: await res.text() };
}
