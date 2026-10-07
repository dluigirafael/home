import { collectHost, type HostStats } from "./collectors/host.ts";
import { collectTs, type TSStats } from "./collectors/ts.ts";
import { collectDocker, type ContainerInfo } from "./collectors/docker.ts";
import { withDeadline } from "./cache.ts";
import { CONFIG } from "./config.ts";

export interface StatsResponse {
  ts: { online: boolean; clients: number | null; maxClients: number | null };
  cpu: HostStats["cpu"];
  mem: HostStats["mem"];
  disk: HostStats["disk"];
  temps: HostStats["temps"];
  uptime: HostStats["uptime"];
  clock: HostStats["clock"];
  containers: ContainerInfo[];
  history: { cpu: number[]; ram: number[]; disk: number[] };
  build: { sha: string | null; date: string | null; runUrl: string | null };
}

const histCpu: number[] = [];
const histRam: number[] = [];
const histDisk: number[] = [];

const TS_FALLBACK: TSStats = {
  info: { online: false, clients: null, maxClients: null },
  humans: null,
};

const HOST_FALLBACK: HostStats = {
  cpu: { cores: 0, load1: 0, percent: 0 },
  mem: { total: 0, used: 0, free: 0, percent: 0 },
  disk: null,
  temps: [],
  uptime: { host: 0, process: 0 },
  clock: { iso: new Date().toISOString(), epoch: 0, timezone: "UTC" },
};

export async function gatherStats(): Promise<StatsResponse> {
  const [ts, host, containers] = await Promise.all([
    withDeadline(collectTs(), CONFIG.statsDeadlineMs, TS_FALLBACK),
    withDeadline(collectHost(), CONFIG.statsDeadlineMs, HOST_FALLBACK),
    withDeadline(collectDocker(), CONFIG.statsDeadlineMs, []),
  ]);

  record(histCpu, host.cpu.percent);
  record(histRam, host.mem.percent);
  record(histDisk, host.disk?.percent ?? 0);

  return {
    ts: {
      online: ts.info.online,
      clients: ts.humans ?? ts.info.clients,
      maxClients: ts.info.maxClients,
    },
    cpu: host.cpu,
    mem: host.mem,
    disk: host.disk,
    temps: host.temps,
    uptime: host.uptime,
    clock: host.clock,
    containers,
    history: {
      cpu: [...histCpu],
      ram: [...histRam],
      disk: [...histDisk],
    },
    build: {
      sha: Deno.env.get("GIT_SHA") ?? null,
      date: Deno.env.get("BUILD_DATE") ?? null,
      runUrl: Deno.env.get("GH_RUN_URL") ?? null,
    },
  };
}

function record(arr: number[], v: number): void {
  arr.push(Math.round(v * 10) / 10);
  if (arr.length > CONFIG.historySize) arr.shift();
}