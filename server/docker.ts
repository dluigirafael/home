import { CONFIG } from "./config.ts";

export interface ContainerInfo {
  name: string;
  state: "running" | "partial" | "stopped";
  running: number;
  total: number;
  uptime: number | null;
  restarts: number;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface RawContainer {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Labels: Record<string, string> | null;
  StartedAt: string;
  RestartCount: number;
  HostConfig?: { RestartPolicy?: { Name?: string } };
}

export async function collectDocker(): Promise<Result<ContainerInfo[]>> {
  let list: RawContainer[];
  try {
    list = await dockerGet<RawContainer[]>("/containers/json?all=true");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[docker]", msg);
    return { ok: false, error: msg };
  }

  const groups = new Map<string, {
    checks: boolean[];
    startedAt: number | null;
    restarts: number;
  }>();

  for (const c of list) {
    const name = (c.Names?.[0] ?? "").replace(/^\//, "");
    if (!name) continue;

    const running = c.State === "running";
    const policy = c.HostConfig?.RestartPolicy?.Name ?? "no";
    const oneShot = policy === "no";
    const exitedClean = /^Exited \(0\)/.test(c.Status ?? "");
    const ok = running || (oneShot && exitedClean);

    const project = c.Labels?.["com.docker.compose.project"] ?? name;
    if (!groups.has(project)) {
      groups.set(project, { checks: [], startedAt: null, restarts: 0 });
    }
    const g = groups.get(project)!;
    g.checks.push(ok);
    g.restarts += Number(c.RestartCount ?? 0);

    if (running) {
      const t = c.StartedAt ? new Date(c.StartedAt).getTime() : null;
      if (t && (!g.startedAt || t < g.startedAt)) g.startedAt = t;
    }
  }

  const now = Date.now();
  const out: ContainerInfo[] = [];

  for (const [project, g] of groups) {
    if (CONFIG.healthExclude.has(project)) continue;

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
    });
  }

  return { ok: true, data: out.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function dockerGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CONFIG.dockerProxy}${path}`, {
    signal: AbortSignal.timeout(CONFIG.dockerTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}