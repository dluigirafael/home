import http from "node:http";
import os from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
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
const CPU_HWMON = new Set(["k10temp", "zenpower", "coretemp", "cpu_thermal"]);
const PREFERRED_LABELS = [/^Tctl$/i, /^Package id 0$/i, /^Composite$/i, /^CPU/i];

const PAGE = await readFile(join(__dirname, "index.html"));
const STYLES = await readFile(join(__dirname, "styles.css"));

let musicCache = { body: null, ts: 0 };
let statsCache = { body: null, ts: 0 };
const STATS_CACHE_MS = 5000;

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
      }
    );
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(new Error("timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

async function tsInfo() {
  if (!TS_API_KEY) return { online: false, clients: null, maxClients: null };
  try {
    const r = await httpRequest(`http://${TS_HOST}:${TS_QUERY_PORT}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": TS_API_KEY },
      body: JSON.stringify({ cmd: "serverinfo" }),
    });
    if (r.status < 200 || r.status >= 300) return { online: false, clients: null, maxClients: null };
    const d = JSON.parse(r.body);
    return {
      online: true,
      clients: Number(d.virtualserver_clientsonline ?? d.clientsonline ?? 0) || null,
      maxClients: Number(d.virtualserver_maxclients ?? d.maxclients ?? 0) || null,
      name: d.virtualserver_name || null,
    };
  } catch {
    return { online: false, clients: null, maxClients: null };
  }
}

async function diskInfo() {
	try {
		const { stdout } = await execAsync("df -k /");
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

		// Prefer Tctl / Package id 0 over per-core/per-die
		results.sort((a, b) => {
			const score = (r) => PREFERRED_LABELS.findIndex((re) => re.test(r.zone));
			const sa = score(a);
			const sb = score(b);
			if (sa === -1 && sb === -1) return 0;
			if (sa === -1) return 1;
			if (sb === -1) return -1;
			return sa - sb;
		});

		// One reading per sensor — the best label — to avoid a wall of cores
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
	return { cores: cpus.length, load1, percent, model: cpus[0]?.model || null };
}

function memInfo() {
	const total = os.totalmem();
	const free = os.freemem();
	const used = total - free;
	return { total, used, free, percent: (used / total) * 100 };
}

function uptimeInfo() {
	const host = os.uptime();
	const proc = process.uptime();
	return { host, process: proc };
}

function clockInfo() {
	const now = new Date();
	return {
		iso: now.toISOString(),
		epoch: Math.floor(now.getTime() / 1000),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		offsetMinutes: -now.getTimezoneOffset(),
	};
}

async function gatherStats() {
	const [ts, disk, temps] = await Promise.all([tsInfo(), diskInfo(), tempInfo()]);
	return {
		ts,
		cpu: cpuInfo(),
		mem: memInfo(),
		disk,
		temps,
		uptime: uptimeInfo(),
		clock: clockInfo(),
	};
}

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
