import os from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CPU_HWMON = new Set(["k10temp", "zenpower", "coretemp", "cpu_thermal"]);
const PREFERRED_LABELS = [/^Tctl$/i, /^Package id 0$/i, /^Composite$/i, /^CPU/i];

export async function collectHost() {
	const [disk, temps] = await Promise.all([readDisk().catch(() => null), readTemps().catch(() => [])]);

	return {
		cpu: readCpu(),
		mem: readMem(),
		disk,
		temps,
		uptime: { host: os.uptime(), process: process.uptime() },
		clock: {
			iso: new Date().toISOString(),
			epoch: Math.floor(Date.now() / 1000),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
	};
}

async function readDisk() {
	const { stdout } = await execFileAsync("df", ["-k", "/"]);
	const line = stdout.trim().split("\n")[1];
	const [, blocks, used, avail] = line.split(/\s+/);
	const total = Number(blocks) * 1024;
	const usedBytes = Number(used) * 1024;
	const availBytes = Number(avail) * 1024;
	return { total, used: usedBytes, free: availBytes, percent: (usedBytes / total) * 100 };
}

async function readTemps() {
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

			const label = (await readFile(`${base}/temp${idx}_label`, "utf8").catch(() => "")).trim() || `temp${idx}`;
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
}

function readCpu() {
	const cpus = os.cpus();
	const load1 = os.loadavg()[0];
	return {
		cores: cpus.length,
		load1,
		percent: Math.min(100, (load1 / cpus.length) * 100),
	};
}

function readMem() {
	const total = os.totalmem();
	const free = os.freemem();
	const used = total - free;
	return { total, used, free, percent: (used / total) * 100 };
}
