import { Cache } from "./cache.ts";
import { gatherStats, type StatsResponse } from "./stats.ts";
import { CONFIG } from "./config.ts";

export const statsCache = new Cache<StatsResponse>(
  () => gatherStats(),
  CONFIG.statsTtlMs,
  CONFIG.failTtlMs,
);