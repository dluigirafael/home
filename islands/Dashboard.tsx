import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { StatsResponse } from "../server/stats.ts";
import { NowPlaying } from "../components/NowPlaying.tsx";
import { Queue } from "../components/Queue.tsx";
import Build from "../components/Build.tsx";
import { Sparkline } from "../components/Sparkline.tsx";
import HealthRow from "./HealthRow.tsx";
import { fmtUptime } from "../assets/format.ts";


interface MusicState {
  nowPlaying: { title: string; artist: string } | null;
  progress?: { position: number; duration: number };
  status: string;
  queueLength?: number;
  upcoming?: Array<{ title: string; artist?: string; duration?: number }>;
}

const POLL_MUSIC = 5000;
const POLL_STATS = 10000;
const TICK = 1000;

export default function Dashboard({ initialStats }: { initialStats: StatsResponse }) {
  const stats = useSignal<StatsResponse | null>(initialStats);
  const music = useSignal<MusicState | null>(null);
  const pos = useSignal(0);
  const musicOffline = useSignal(false);
  const trackRef = useRef<string | null | undefined>(undefined);
  const durRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      if (music.value?.status !== "playing" || !music.value.nowPlaying) return;
      pos.value = Math.min(pos.value + 1, durRef.current);
    }, TICK);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;

    const pollMusic = async () => {
      try {
        const r = await fetch("/api/data", { cache: "no-store" });
        const d: MusicState = await r.json();
        if (!active) return;
        music.value = d;
        musicOffline.value = false;

        const np = d.nowPlaying;
        const id = np ? `${np.title}|${np.artist || ""}` : null;
        if (id !== trackRef.current) {
          trackRef.current = id;
          pos.value = d.progress?.position ?? 0;
          durRef.current = d.progress?.duration ?? 0;
        } else {
          const serverPos = d.progress?.position ?? 0;
          if (Math.abs(serverPos - pos.value) > 2) pos.value = serverPos;
          durRef.current = d.progress?.duration ?? durRef.current;
        }
      } catch {
        if (active) musicOffline.value = true;
      }
    };

    const pollStats = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (!active) return;
        stats.value = await r.json();
      } catch { /* keep previous */ }
    };

    pollMusic();
    pollStats();
    const tm = setInterval(pollMusic, POLL_MUSIC);
    const tsm = setInterval(pollStats, POLL_STATS);
    return () => { active = false; clearInterval(tm); clearInterval(tsm); };
  }, []);

  const s = stats.value;
  const m = music.value;
  const host = s?.host;
  const tsOnline = s?.ts.ok === true && s.ts.data.info.online;
  const clients = s?.ts.ok
    ? (s.ts.data.humans ?? s.ts.data.info.clients)
    : null;
  const maxClients = s?.ts.ok ? s.ts.data.info.maxClients : null;
  const containers = s?.containers.ok ? s.containers.data : [];

  const paused = m?.status === "paused";
  const cpuPct = host?.cpu.percent ?? null;
  const ramPct = host?.mem.percent ?? null;
  const diskPct = host?.disk?.percent ?? null;
  const tempC = host?.temps?.[0]?.celsius ?? null;

  return (
    <>
      <header class="server">
        <div class="server-side">
          <span class="server-label">TeamSpeak</span>
          <span class="server-status-row">
            <span class={`dot ${tsOnline ? (paused ? "paused" : "playing") : ""}`} />
            <span class={`server-status ${tsOnline ? "ok" : "bad"}`}>
              {tsOnline ? "online" : "offline"}
            </span>
          </span>
        </div>
        <div class="server-side server-side-right">
          <span class="server-num">
            {clients != null ? `${clients}${maxClients ? "/" + maxClients : ""}` : "—"}
          </span>
          <span class="server-label">online</span>
        </div>
      </header>

      <section class="hero">
        {musicOffline.value
          ? <span class="empty">Unavailable</span>
          : <NowPlaying nowPlaying={m?.nowPlaying ?? null} pos={pos.value} dur={durRef.current} />}
      </section>

      {!musicOffline.value && m?.upcoming?.length ? (
        <section class="queue-wrap">
          <Queue items={m.upcoming} total={m.queueLength} />
        </section>
      ) : null}

      <section class="resources">
        <Metric label="CPU" value={cpuPct} history={s?.history.cpu} warn={60} hot={85} />
        <Metric label="RAM" value={ramPct} history={s?.history.ram} warn={60} hot={85} />
        <Metric label="Disk" value={diskPct} history={s?.history.disk} warn={60} hot={85} />
      </section>

      <section class="meta">
        <Cell label="Temp" value={tempC != null ? `${tempC.toFixed(0)}°` : "—"}
          warn={tempC != null && tempC >= 65} hot={tempC != null && tempC >= 80} />
        <Cell label="Uptime" value={host ? fmtUptime(host.uptime.host) : "—"} />
        <Cell label="Time" value={host
          ? new Date(host.clock.iso).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit",
              timeZone: host.clock.timezone, timeZoneName: "short",
            })
          : "—"} />
      </section>

      {containers.length > 0 ? (
        <div class="health-wrap">
          <span class="health-label">Services</span>
          <div class="health">
            {containers.map((c) => <HealthRow key={c.name} c={c} />)}
          </div>
        </div>
      ) : s?.containers.ok === false ? (
        <div class="health-wrap">
          <span class="health-label">Services</span>
          <div class="health-error">unavailable — {s.containers.error}</div>
        </div>
      ) : null}

      {s?.build ? <Build {...s.build} /> : null}
    </>
  );
}

function Metric({ label, value, history, warn, hot }: {
  label: string; value: number | null; history?: number[]; warn: number; hot: number;
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
  label: string; value: string; warn?: boolean; hot?: boolean;
}) {
  const level = hot ? "hot" : warn ? "warn" : "";
  return (
    <div class={`cell ${level}`}>
      <span class="k">{label}</span>
      <span class="v">{value}</span>
    </div>
  );
}