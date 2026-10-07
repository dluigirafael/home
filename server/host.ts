import { statfs } from "node:fs/promises";

export interface CPUInfo { cores: number; load1: number; percent: number }
export interface MemInfo { total: number; used: number; free: number; percent: number }
export interface DiskInfo { total: number; used: number; free: number; percent: number }
export interface TempInfo { zone: string; celsius: number; sensor: string }
export interface UptimeInfo { host: number; process: number }
export interface ClockInfo { iso: string; epoch: number; timezone: string }

export interface HostStats {
  cpu: CPUInfo;
  mem: MemInfo;
  disk: DiskInfo | null;
  temps: TempInfo[];
  uptime: UptimeInfo;
  clock: ClockInfo;
}

const CPU_HWMON = new Set(["k10temp", "zenpower", "coretemp", "cpu_thermal"]);
const PREFERRED = [/^Tctl$/i, /^Package id 0$/i, /^Composite$/i, /^CPU/i];
const PROCESS_START = Date.now();

let prev: { total: number; idle: number; ts: number } | null = null;

export async function collectHost(): Promise<HostStats> {
  const [cpu, disk, temps] = await Promise.all([
    readCPU(),
    readDisk().catch(() => null),
    readTemps().catch(() => []),
  ]);

  return {
    cpu,
    mem: readMem(),
    disk,
    temps,
    uptime: { host: Deno.osUptime(), process: (Date.now() - PROCESS_START) / 1000 },
    clock: readClock(),
  };
}

async function readCPU(): Promise<CPUInfo> {
  const line = (await Deno.readTextFile("/proc/stat")).split("\n")[0];
  const parts = line.split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal guest guest_nice
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);

  const now = Date.now();
  let percent = 0;
  if (prev && now - prev.ts < 10_000) {
    const dt = total - prev.total;
    const di = idle - prev.idle;
    if (dt > 0) percent = ((dt - di) / dt) * 100;
  }
  prev = { total, idle, ts: now };

  return {
    cores: navigator.hardwareConcurrency,
    load1: Deno.loadavg()[0],
    percent: Math.max(0, Math.min(100, percent)),
  };
}

function readMem(): MemInfo {
  const m = Deno.systemMemoryInfo();
  const used = m.total - m.available;
  return { total: m.total, used, free: m.available, percent: (used / m.total) * 100 };
}

async function readDisk(): Promise<DiskInfo> {
  const fs = await statfs("/");
  const total = fs.blocks * fs.bsize;
  const free = fs.bavail * fs.bsize;
  const used = total - free;
  return { total, used, free, percent: (used / total) * 100 };
}

async function readTemps(): Promise<TempInfo[]> {
  const seen = new Set<string>();
  const out: TempInfo[] = [];

  for await (const e of Deno.readDir("/sys/class/hwmon")) {
    if (!e.name.startsWith("hwmon")) continue;
    const base = `/sys/class/hwmon/${e.name}`;
    const sensor = (await Deno.readTextFile(`${base}/name`).catch(() => "")).trim();
    if (!CPU_HWMON.has(sensor) || seen.has(sensor)) continue;

    for await (const f of Deno.readDir(base)) {
      if (!/^temp\d+_input$/.test(f.name)) continue;
      const raw = Number(await Deno.readTextFile(`${base}/${f.name}`).catch(() => "0"));
      if (!raw) continue;
      const c = raw > 1000 ? raw / 1000 : raw;
      if (c < 20 || c > 120) continue;
      const idx = f.name.match(/^temp(\d+)_input$/)![1];
      const label = (await Deno.readTextFile(`${base}/temp${idx}_label`).catch(() => "")).trim();
      out.push({ zone: label || `temp${idx}`, celsius: c, sensor });
      seen.add(sensor);
      break;
    }
  }
  return out.sort((a, b) => score(a.zone) - score(b.zone));
}

function score(z: string): number {
  for (let i = 0; i < PREFERRED.length; i++) if (PREFERRED[i].test(z)) return i;
  return 999;
}

function readClock(): ClockInfo {
  const now = new Date();
  return {
    iso: now.toISOString(),
    epoch: Math.floor(now.getTime() / 1000),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}