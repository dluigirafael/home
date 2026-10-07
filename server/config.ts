function env(k: string, fallback: string): string {
  return Deno.env.get(k) ?? fallback;
}
function num(k: string, fallback: number): number {
  const v = Deno.env.get(k);
  return v ? Number(v) : fallback;
}
function set(k: string): Set<string> {
  return new Set(
    (Deno.env.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
}

export const CONFIG = {
  port: num("PORT", 3000),

  managerUrl: env("MANAGER_URL", "http://ts6-backend:3001"),
  widgetToken: env("WIDGET_TOKEN", ""),
  botId: env("BOT_ID", "2"),
  musicCacheMs: num("CACHE_MS", 3000),

  tsHost: env("TS_HOST", "teamspeak"),
  tsPort: num("TS_QUERY_PORT", 10080),
  tsApiKey: env("TS_API_KEY", ""),
  tsBotGroup: "Bots",
  tsTimeoutMs: num("TS_TIMEOUT", 800),

  dockerProxy: env("DOCKER_PROXY", "http://docker-socket-proxy:2375"),
  dockerTimeoutMs: num("DOCKER_TIMEOUT", 1500),

  historySize: 60,
  healthExclude: set("HEALTH_EXCLUDE"),
} as const;