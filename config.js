export const PORT = Number(process.env.PORT || 3000);
export const WIDGET_TOKEN = process.env.WIDGET_TOKEN || "";
export const MANAGER_URL = process.env.MANAGER_URL || "http://ts6-backend:3001";
export const BOT_ID = process.env.BOT_ID || "2";
export const MUSIC_CACHE_MS = Number(process.env.CACHE_MS || 3000);

export const TS_HOST = process.env.TS_HOST || "teamspeak";
export const TS_PORT = Number(process.env.TS_QUERY_PORT || 10080);
export const TS_API_KEY = process.env.TS_API_KEY || "";
export const TS_BOT_GROUP = "Bots";
export const TS_TIMEOUT = Number(process.env.TS_TIMEOUT || 2000);

export const DOCKER_PROXY = process.env.DOCKER_PROXY || "http://docker-socket-proxy:2375";
export const DOCKER_TIMEOUT = Number(process.env.DOCKER_TIMEOUT || 2000);

export const STATS_TTL = Number(process.env.STATS_TTL || 5000);
export const STATS_DEADLINE_MS = Number(process.env.STATS_DEADLINE_MS || 5000);
export const MEMORY_REFRESH_MS = Number(process.env.MEMORY_REFRESH_MS || 30000);
export const HISTORY_SIZE = 60;
export const MEMORY_TIMEOUT = Number(process.env.MEMORY_TIMEOUT || 15000);

export const HEALTH_EXCLUDE = new Set(
	(process.env.HEALTH_EXCLUDE || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);
