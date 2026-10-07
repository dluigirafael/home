import { CONFIG } from "./config.ts";
import { collectHost, type HostStats } from "./host.ts";
import { collectTs, type TSStats, type Result as TSResult } from "./ts.ts";
import { collectDocker, type ContainerInfo, type Result as DockerResult } from "./docker.ts";

export interface StatsResponse {
  host: HostStats;
  ts: TSResult<TSStats>;
  containers: DockerResult<ContainerInfo[]>;
  history: { cpu: number[]; ram: number[]; disk: number[] };
  build: { sha: string | null; date: string | null; runUrl: string | null };
}

const histCpu: number[] = [];
const histRam: number[] = [];
const histDisk: number[] = [];

export async function gatherStats(): Promise<StatsResponse> {
  const [host, ts, containers] = await Promise.all([
    collectHost(),
    collectTs(),
    collectDocker(),
  ]);

  record(histCpu, host.cpu.percent);
  record(histRam, host.mem.percent);
  record(histDisk, host.disk?.percent ?? 0);

  return {
    host,
    ts,
    containers,
    history: { cpu: [...histCpu], ram: [...histRam], disk: [...histDisk] },
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