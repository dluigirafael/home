import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MANAGER_URL, BOT_ID, MUSIC_CACHE_MS, WIDGET_TOKEN } from "./config.js";
import { fetchIcon } from "./collectors/docker.js";

const STATIC = {
	"/": "index.html",
	"/index.html": "index.html",
	"/styles.css": "styles.css",
	"/app.js": "app.js",
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

	async function serveStatic(res, file) {
		try {
			const body = await readFile(join(rootDir, file));
			const ext = file.slice(file.lastIndexOf(".") + 1);
			res.writeHead(200, {
				"content-type": TYPES[ext] || "application/octet-stream",
				"cache-control": "public, max-age=3600",
			});
			res.end(body);
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
			const body = await r.text();
			if (!r.ok) return json(res, 502, { error: "upstream", status: r.status });
			music = { body, ts: now };
			return json(res, 200, body);
		} catch (e) {
			return json(res, 502, { error: "unreachable", message: e.message });
		}
	}

	async function serveStats(res) {
		const cached = stats.peek();
		if (cached) return json(res, 200, cached);
		return json(res, 200, await stats.get());
	}
	async function serveIcon(res, slug) {
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
	}

	return async function route(req, res) {
		if (req.method !== "GET") {
			res.writeHead(405).end();
			return;
		}

		const path = new URL(req.url, "http://x").pathname;

		if (STATIC[path]) return serveStatic(res, STATIC[path]);

		if (path.startsWith("/icons/") && path.endsWith(".svg")) {
			const file = path.slice(7);
			if (!/^[a-z0-9-]+\.svg$/.test(file)) {
				res.writeHead(400).end();
				return;
			}
			return serveIcon(res, file.slice(0, -4));
		}

		if (path === "/data") return serveData(res);
		if (path === "/stats") return serveStats(res);

		res.writeHead(404).end();
	};
}
