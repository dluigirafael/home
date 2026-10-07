import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { MANAGER_URL, BOT_ID, MUSIC_CACHE_MS, WIDGET_TOKEN } from "./config.js";

const STATIC = {
	"/": { file: "index.html", cache: "no-cache" },
	"/index.html": { file: "index.html", cache: "no-cache" },
	"/styles.css": { file: "styles.css", cache: "no-cache" },
	"/app.js": { file: "app.js", cache: "no-cache" },
};

const TYPES = {
	html: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "application/javascript; charset=utf-8",
};

export function createRouter({ rootDir, stats }) {
	let music = { body: null, ts: 0 };

	function json(res, code, body) {
		res.writeHead(code, { "content-type": "application/json" });
		res.end(typeof body === "string" ? body : JSON.stringify(body));
	}

	async function serveStatic(req, res, entry) {
		try {
			const path = join(rootDir, entry.file);
			const [body, info] = await Promise.all([readFile(path), stat(path)]);
			const etag = `"${info.mtimeMs.toString(16)}-${info.size.toString(16)}"`;
			const headers = {
				"content-type": TYPES[entry.file.slice(entry.file.lastIndexOf(".") + 1)] || "application/octet-stream",
				"cache-control": entry.cache,
				etag,
			};

			if (req.headers["if-none-match"] === etag) {
				res.writeHead(304, headers).end();
				return;
			}
			res.writeHead(200, headers);
			res.end(req.method === "HEAD" ? undefined : body);
		} catch {
			res.writeHead(404).end();
		}
	}

	async function serveData(res) {
		const now = Date.now();
		if (music.body && now - music.ts < MUSIC_CACHE_MS) {
			return json(res, 200, music.body);
		}

		try {
			const r = await fetch(
				`${MANAGER_URL}/api/widget/player/${BOT_ID}/data?token=${encodeURIComponent(WIDGET_TOKEN)}`,
				{ signal: AbortSignal.timeout(5000) },
			);
			if (!r.ok) throw new Error(`upstream ${r.status}`);
			music = { body: await r.text(), ts: Date.now() };
			return json(res, 200, music.body);
		} catch (e) {
			// last good payload beats a blank player while the manager is down
			if (music.body) return json(res, 200, music.body);
			return json(res, 502, { error: "unreachable", message: e.message });
		}
	}

	async function serveStats(res) {
		const cached = stats.peek();
		if (cached) return json(res, 200, cached);

		const fresh = await stats.get();
		if (!fresh) return json(res, 503, { error: "no stats yet" });
		return json(res, 200, fresh);
	}

	return async function route(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405).end();
			return;
		}

		const path = new URL(req.url, "http://x").pathname;
		const entry = STATIC[path];

		if (entry) return serveStatic(req, res, entry);
		if (path === "/data") return serveData(res);
		if (path === "/stats") return serveStats(res);

		res.writeHead(404).end();
	};
}
