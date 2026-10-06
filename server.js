import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { PORT, WIDGET_TOKEN, STATS_TTL } from "./config.js";
import { ttlCache } from "./cache.js";
import { gatherStats } from "./aggregates/stats.js";
import { createRouter } from "./routes.js";

if (!WIDGET_TOKEN) {
	console.error("WIDGET_TOKEN is required");
	process.exit(1);
}

const rootDir = dirname(fileURLToPath(import.meta.url));

const stats = ttlCache(gatherStats, { ttl: STATS_TTL, failTtl: 30000 });
const route = createRouter({ rootDir, stats });

const server = http.createServer((req, res) => {
	route(req, res).catch((e) => {
		console.error("route error", e);
		if (!res.headersSent) res.writeHead(500);
		res.end();
	});
});

await stats.get();
server.listen(PORT, () => console.log(`listening on :${PORT}`));
setInterval(() => stats.get(), Math.max(1000, STATS_TTL - 500));