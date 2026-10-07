import { collectTs, OFFLINE } from "../collectors/ts.js";
import { collectHost } from "../collectors/host.js";
import { collectDocker } from "../collectors/docker.js";
import { withDeadline } from "../cache.js";
import { HISTORY_SIZE, STATS_DEADLINE_MS } from "../config.js";

const history = { cpu: [], ram: [], disk: [] };

export async function gatherStats() {
	const [ts, host, containers] = await Promise.all([
		withDeadline(collectTs(), STATS_DEADLINE_MS, { info: OFFLINE, humans: null }),
		collectHost(),
		withDeadline(collectDocker(), STATS_DEADLINE_MS, []),
	]);

	record("cpu", host.cpu.percent);
	record("ram", host.mem.percent);
	record("disk", host.disk?.percent ?? 0);

	return {
		ts: { ...ts.info, clients: ts.humans ?? ts.info.clients },
		cpu: host.cpu,
		mem: host.mem,
		disk: host.disk,
		temps: host.temps,
		uptime: host.uptime,
		clock: host.clock,
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

function record(key, value) {
	const arr = history[key];
	arr.push(Number.isFinite(value) ? Number(value.toFixed(1)) : 0);
	if (arr.length > HISTORY_SIZE) arr.shift();
}
