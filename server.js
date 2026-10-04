import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MANAGER = process.env.MANAGER_URL;
const TOKEN = process.env.WIDGET_TOKEN;
const BOT_ID = process.env.BOT_ID || "2";
const CACHE_MS = Number(process.env.CACHE_MS || 3000);

if (!TOKEN) {
	console.error("WIDGET_TOKEN is required");
	process.exit(1);
}

const PAGE = await readFile(join(__dirname, "index.html"));

let cache = { body: null, ts: 0 };

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

	if (path === "/data") {
		const now = Date.now();
		if (cache.body && now - cache.ts < CACHE_MS) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(cache.body);
			return;
		}
		try {
			const r = await fetch(`${MANAGER}/api/widget/player/${BOT_ID}/data?token=${encodeURIComponent(TOKEN)}`, {
				signal: AbortSignal.timeout(5000),
			});

			const body = await r.text();
			if (!r.ok) {
				res.writeHead(502, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "upstream", status: r.status }));
				return;
			}
			cache = { body, ts: now };
			res.writeHead(200, { "content-type": "application/json" });
			res.end(body);
		} catch (e) {
			res.writeHead(502, { "content-type": "application/json" });
			console.log(
				"he url fetch   used",
				`${MANAGER}/api/widget/player/${BOT_ID}/data?token=${encodeURIComponent(TOKEN)}`,
			);
			res.end(JSON.stringify({ error: "unreachable", message: e.message }));
		}
		return;
	}

	res.writeHead(404).end();
});

server.listen(PORT, () => console.log("listening on :" + PORT));
