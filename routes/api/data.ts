import { define } from "../../utils.ts";
import { CONFIG } from "../../server/config.ts";

interface CacheEntry { body: string; ts: number }
let cache: CacheEntry = { body: "", ts: 0 };

export const handler = define.handlers({
  async GET() {
    const now = Date.now();
    if (cache.body && now - cache.ts < CONFIG.musicCacheMs) {
      return new Response(cache.body, {
        headers: { "content-type": "application/json" },
      });
    }

    const url = `${CONFIG.managerUrl}/api/widget/player/${CONFIG.botId}/data?token=${encodeURIComponent(CONFIG.widgetToken)}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      if (!res.ok) {
        return Response.json({ error: "upstream", status: res.status }, { status: 502 });
      }
      cache = { body, ts: now };
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return Response.json(
        { error: "unreachable", message: (e as Error).message },
        { status: 502 },
      );
    }
  },
});