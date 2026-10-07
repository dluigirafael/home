import type { ContainerInfo } from "@/server/collectors/docker.ts";
import Sparkline from "./Sparkline.tsx";
import AppIcon from "@/islands/AppIcon.tsx";

export default function HealthRow({ c }: { c: ContainerInfo }) {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const cls = c.state === "running" ? "ok" : c.state === "partial" ? "warn" : "bad";
  const count = c.state === "partial" ? ` ${c.running}/${c.total}` : "";
  const badRestarts = c.restarts > 5;

  return (
    <div class="h-item">
      <AppIcon slug={slug} />
      <span class={`h-dot ${cls}`} />
      <div class="h-meta">
        <span class="h-name">{c.name}{count}</span>
        <span class="h-sub">
          {c.uptime != null && <span>{fmtUptime(c.uptime)}</span>}
          {c.memMB != null && <span>{c.memMB} MB</span>}
          {c.restarts > 0 && <span class={badRestarts ? "bad" : ""}>↻ {c.restarts}</span>}
        </span>
      </div>
      <span class="h-graph">
        <Sparkline values={c.cpuHistory} width={60} height={12} stroke={1.2} maxOverride={100} />
      </span>
    </div>
  );
}

function fmtUptime(sec: number): string {
  sec = Math.floor(sec || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}