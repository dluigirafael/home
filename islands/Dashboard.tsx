import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { StatsResponse } from "@/server/stats.ts";
import Sparkline from "@/components/Sparkline.tsx";
import HealthRow from "@/components/HealthRow.tsx";
import Build from "@/components/Build.tsx";

interface Props {
  initialStats: StatsResponse;
}

interface MusicState {
  nowPlaying: { title: string; artist: string; duration: number } | null;
  progress?: { position: number; duration: number };
  status: string;
  queueLength?: number;
  upcoming?: Array<{ title: string; artist?: string; duration?: number }>;
}

const POLL_MUSIC = 5000;
const POLL_STATS = 10000;
const TICK = 1000;

export default function Dashboard({ initialStats }: Props) {
  const stats = useSignal<StatsResponse | null>(initialStats);
  const music = useSignal<MusicState | null>(null);
  const pos = useSignal(0);
  const offline = useSignal(false);
  const trackRef = useRef<string | null | undefined>(undefined);
  const durRef = useRef(0);

  useEffect(() => {
    let active = true;
    const tick = setInterval(() => {
      const m = music.value;
      if (m?.status !== "playing" || !m.nowPlaying) return;
      pos.value = Math.min(pos.value + 1, durRef.current);
    }, TICK);
    return () => { active = false; clearInterval(tick); };
  }, []);

  useEffect(() => {
    let active = true;

    const pollMusic = async () => {
      try {
        const r = await fetch("/api/data", { cache: "no-store" });
        const d: MusicState = await r.json();
        if (!active) return;
        music.value = d;
        offline.value = false;

        const np = d.nowPlaying;
        const id = np ? `${np.title}|${np.artist || ""}` : null;
        if (id !== trackRef.current) {
          trackRef.current = id;
          pos.value = d.progress?.position ?? 0;
          durRef.current = d.progress?.duration ?? np?.duration ?? 0;
        } else {
          const serverPos = d.progress?.position ?? 0;
          if (Math.abs(serverPos - pos.value) > 2) pos.value = serverPos;
          durRef.current = d.progress?.duration ?? np?.duration ?? durRef.current;
        }
      } catch {
        if (active) offline.value = true;
      }
    };

    const pollStats = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (!active) return;
        stats.value = await r.json();
      } catch {
        /* keep previous */
      }
    };

    pollMusic();
    pollStats();
    const tm = setInterval(pollMusic, POLL_MUSIC);
    const tsm = setInterval(pollStats, POLL_STATS);
    return () => { active = false; clearInterval(tm); clearInterval(tsm); };
  }, []);

  const s = stats.value;
  const m = music.value;
  const tsOnline = !!s?.ts?.online;
  const playing = m?.status === "playing";
  const paused = m?.status === "paused";

  const cpuPct = s?.cpu?.percent ?? null;
  const ramPct = s?.mem?.percent ?? null;
  const diskPct = s?.disk?.percent ?? null;
  const tempC = s?.temps?.[0]?.celsius ?? null;

  const dotClass = tsOnline ? (paused ? "paused" : "playing") : "";

  return (
    <>
      <header class="server">
        <div class="server-side">
          <span class="server-label">TeamSpeak</span>
          <span class="server-status-row">
            <span class={`dot ${dotClass}`} />
            <span class={`server-status ${tsOnline ? "ok" : "bad"}`}>
              {tsOnline ? "online" : "offline"}
            </span>
          </span>
        </div>
        <div class="server-side server-side-right">
          <span class="server-num">
            {s?.ts?.clients != null
              ? `${s.ts.clients}${s.ts.maxClients ? "/" + s.ts.maxClients : ""}`
              : "—"}
          </span>
          <span class="server-label">online</span>
        </div>
      </header>

      <section class="hero">
        {offline.value || !m?.nowPlaying
          ? <span class="empty">{offline.value ? "Unavailable" : "Nothing playing"}</span>
          : <NowPlaying m={m} pos={pos.value} dur={durRef.current} />}
      </section>

      {!offline.value && m?.upcoming?.length ? (
        <section class="queue-wrap">
          <Queue items={m.upcoming} total={m.queueLength} />
        </section>
      ) : null}

      <section class="resources">
        <Metric label="CPU" value={cpuPct} history={s?.history?.cpu} warn={60} hot={85} />
        <Metric label="RAM" value={ramPct} history={s?.history?.ram} warn={60} hot={85} />
        <Metric label="Disk" value={diskPct} history={s?.history?.disk} warn={60} hot={85} />
      </section>

      <section class="meta">
        <Cell label="Temp" value={tempC != null ? `${tempC.toFixed(0)}°` : "—"} warn={tempC != null && tempC >= 65} hot={tempC != null && tempC >= 80} />
        <Cell label="Uptime" value={s?.uptime ? fmtUptime(s.uptime.host) : "—"} />
        <Cell label="Time" value={s?.clock ? fmtTime(s.clock) : "—"} />
      </section>

      {s?.containers?.length ? (
        <div class="health-wrap">
          <span class="health-label">Services</span>
          <div class="health">
            {s.containers.map((c) => <HealthRow key={c.name} c={c} />)}
          </div>
        </div>
      ) : null}

      {s?.build ? <Build {...s.build} /> : null}
    </>
  );
}

function NowPlaying({ m, pos, dur }: { m: MusicState; pos: number; dur: number }) {
  const np = m.nowPlaying!;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  return (
    <>
      <div class="title">{np.title || "Unknown"}</div>
      {np.artist && <div class="artist">{np.artist}</div>}
      <div class="progress">
        <span class="t">{fmt(pos)}</span>
        <div class="bar"><span style={{ width: `${pct}%` }} /></div>
        <span class="t">{fmt(dur)}</span>
      </div>
    </>
  );
}

function Queue({ items, total }: { items: NonNullable<MusicState["upcoming"]>; total?: number }) {
  const list = items.slice(0, 5);
  return (
    <div class="queue">
      <h2><span>Up Next</span><span class="count">{total ?? list.length}</span></h2>
      <ol>
        {list.map((item, i) => (
          <li key={i}>
            <div class="q-meta">
              <div class="q-title">{item.title || "Unknown"}</div>
              {item.artist && <div class="q-artist">{item.artist}</div>}
            </div>
            {item.duration ? <div class="q-dur">{fmt(item.duration)}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Metric({ label, value, history, warn, hot }: {
  label: string;
  value: number | null;
  history?: number[];
  warn: number;
  hot: number;
}) {
  const level = value != null && value >= hot ? "hot" : value != null && value >= warn ? "warn" : "";
  return (
    <div class={`cell ${level}`}>
      <span class="k">{label}</span>
      <span class="v">{value != null ? `${value.toFixed(0)}%` : "—"}</span>
      <span class="spark"><Sparkline values={history} /></span>
    </div>
  );
}

function Cell({ label, value, warn, hot }: {
  label: string;
  value: string;
  warn?: boolean;
  hot?: boolean;
}) {
  const level = hot ? "hot" : warn ? "warn" : "";
  return (
    <div class={`cell ${level}`}>
      <span class="k">{label}</span>
      <span class="v">{value}</span>
    </div>
  );
}

function fmt(sec: number): string {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
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

function fmtTime(clock: { iso: string; timezone: string }): string {
  return new Date(clock.iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: clock.timezone,
    timeZoneName: "short",
  });
}