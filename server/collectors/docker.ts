import { CONFIG } from "../config.ts";

export interface ContainerInfo {
  name: string;
  state: "running" | "partial" | "stopped";
  running: number;
  total: number;
  uptime: number | null;
  restarts: number;
  memMB: number;
  cpuPct: number;
  cpuHistory: number[];
  memHistory: number[];
}

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Labels: Record<string, string> | null;
  StartedAt: string;
  RestartCount: number;
  HostConfig?: {
    RestartPolicy?: {
      Name?: string;
    };
  };
}

interface Sample {
  memMB: number;
  cpuPct: number;
  total: number;
  system: number;
  cpus: number;
  ts: number;
}

const sampleCache = new Map<string, Sample>();
const cpuHistory = new Map<string, number[]>();
const memHistory = new Map<string, number[]>();

let dockerClient: Deno.HttpClient | null = null;

function getDockerClient(): Deno.HttpClient | null {
  if (!CONFIG.dockerSocket || CONFIG.dockerProxy) return null;
  if (!dockerClient) {
    dockerClient = Deno.createHttpClient({
      proxy: { transport: "unix", path: CONFIG.dockerSocket },
    });
  }
  return dockerClient;
}

async function dockerGet<T>(path: string, timeoutMs = CONFIG.dockerTimeoutMs): Promise<T> {
  const base = CONFIG.dockerProxy ?? "http://localhost";
  const opts: RequestInit & { client?: Deno.HttpClient } = {
    signal: AbortSignal.timeout(timeoutMs),
  };
  const client = getDockerClient();
  if (client) opts.client = client;

  const res = await fetch(`${base}${path}`, opts);
  if (!res.ok) throw new Error(`docker ${res.status}`);
  return res.json() as Promise<T>;
}

export async function collectDocker(): Promise<ContainerInfo[]> {
  let list: DockerContainer[];
  try {
    list = await dockerGet<DockerContainer[]>("/containers/json?all=true");
  } catch {
    return [];
  }

  const groups = new Map<string, {
    checks: boolean[];
    runningIds: string[];
    startedAt: number | null;
    restarts: number;
  }>();

  for (const c of list) {
    const name = (c.Names?.[0] ?? "").replace(/^\//, "");
    if (!name) continue;

    const running = c.State === "running";
    const restartPolicy = c.HostConfig?.RestartPolicy?.Name ?? "no";
    const oneShot = restartPolicy === "no";
    const exitedClean = /^Exited \(0\)/.test(c.Status ?? "");
    // One-shot containers (init, permissions, migrations) are healthy after a clean exit.
    // Long-running containers (always / unless-stopped / on-failure) are only healthy running.
    const ok = running || (oneShot && exitedClean);
    const project = c.Labels?.["com.docker.compose.project"] ?? name;

    if (!groups.has(project)) {
      groups.set(project, { checks: [], runningIds: [], startedAt: null, restarts: 0 });
    }
    const g = groups.get(project)!;
    g.checks.push(ok);
    g.restarts += Number(c.RestartCount ?? 0);
    if (running) {
      g.runningIds.push(c.Id);
      const t = c.StartedAt ? new Date(c.StartedAt).getTime() : null;
      if (t && (!g.startedAt || t < g.startedAt)) g.startedAt = t;
    }
  }

  const now = Date.now();
  const out: ContainerInfo[] = [];

  for (const [project, g] of groups.entries()) {
    if (CONFIG.healthExclude.has(project)) continue;

    const samples = await Promise.all(g.runningIds.map((id) => sampleContainer(id)));
    const memMB = Math.round(samples.reduce((s, x) => s + x.memMB, 0));
    const cpuPct = Math.round(samples.reduce((s, x) => s + x.cpuPct, 0) * 10) / 10;

    const cpu = cpuHistory.get(project) ?? [];
    cpu.push(cpuPct);
    if (cpu.length > CONFIG.historySize) cpu.shift();
    cpuHistory.set(project, cpu);

    const mem = memHistory.get(project) ?? [];
    mem.push(memMB);
    if (mem.length > CONFIG.historySize) mem.shift();
    memHistory.set(project, mem);

    const ok = g.checks.filter(Boolean).length;
    const total = g.checks.length;
    const state = ok === total ? "running" : ok === 0 ? "stopped" : "partial";

    out.push({
      name: project.replace(/^ix-/, ""),
      state,
      running: ok,
      total,
      uptime: g.startedAt ? Math.floor((now - g.startedAt) / 1000) : null,
      restarts: g.restarts,
      memMB,
      cpuPct,
      cpuHistory: [...cpu],
      memHistory: [...mem],
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function sampleContainer(id: string): Promise<Sample> {
  const cached = sampleCache.get(id);
  const now = Date.now();
  if (cached && now - cached.ts < CONFIG.memoryRefreshMs) return cached;

  try {
    const s = await dockerGet<any>(`/containers/${id}/stats?stream=false`, CONFIG.memoryTimeoutMs);

    const usage = s.memory_stats?.usage ?? 0;
    const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0;
    const memMB = Math.max(0, usage - cache) / 1024 / 1024;

    const total = s.cpu_stats?.cpu_usage?.total_usage ?? 0;
    const system = s.cpu_stats?.system_cpu_usage ?? 0;
    const cpus = s.cpu_stats?.online_cpus ?? 1;

    let cpuPct = 0;
    if (cached && system > cached.system) {
      cpuPct = ((total - cached.total) / (system - cached.system)) * cpus * 100;
    }

    const sample: Sample = { memMB, cpuPct, total, system, cpus, ts: now };
    sampleCache.set(id, sample);
    return sample;
  } catch {
    return cached ?? { memMB: 0, cpuPct: 0, total: 0, system: 0, cpus: 1, ts: now };
  }
}