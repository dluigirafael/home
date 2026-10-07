export interface State {
	stats: StatsCache;
}

export const CONFIG = {
	port: Number(Deno.env.get("PORT") ?? 3000),
	widgetToken: Deno.env.get("WIDGET_TOKEN") ?? "",
	managerUrl: Deno.env.get("MANAGER_URL") ?? "http://ts6-backend:3001",
	botId: Deno.env.get("BOT_ID") ?? "2",
	musicCacheMs: Number(Deno.env.get("CACHE_MS") ?? 3000),

	tsHost: Deno.env.get("TS_HOST") ?? "teamspeak",
	tsPort: Number(Deno.env.get("TS_QUERY_PORT") ?? 10080),
	tsApiKey: Deno.env.get("TS_API_KEY") ?? "",
	tsBotGroup: "Bots",
	tsTimeoutMs: Number(Deno.env.get("TS_TIMEOUT") ?? 2000),

	dockerProxy: Deno.env.get("DOCKER_PROXY") ?? null,
	dockerSocket: Deno.env.get("DOCKER_SOCKET") ?? null,
	dockerTimeoutMs: Number(Deno.env.get("DOCKER_TIMEOUT") ?? 2000),
	memoryTimeoutMs: Number(Deno.env.get("MEMORY_TIMEOUT") ?? 15000),

	statsTtlMs: Number(Deno.env.get("STATS_TTL") ?? 5000),
	statsDeadlineMs: Number(Deno.env.get("STATS_DEADLINE_MS") ?? 5000),
	memoryRefreshMs: Number(Deno.env.get("MEMORY_REFRESH_MS") ?? 30000),
	historySize: 60,

	healthExclude: new Set(
		(Deno.env.get("HEALTH_EXCLUDE") ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	),
} as const;

export type StatsCache = import("./cache.ts").Cache<import("./stats.ts").StatsResponse>;
