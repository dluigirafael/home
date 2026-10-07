import { CONFIG } from "../config.ts";

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

export async function collectHost(): Promise<HostStats> {
  const [disk, temps] = await Promise.all([
    readDisk().catch(() => null),
    readTemps().catch(() => []),
  ]);

  return {
    cpu: readCPU(),
    mem: readMem(),
    disk,
    temps,
    uptime: {
      host: Deno.osUptime(),
      process: (Date.now() - PROCESS_START) / 1000,
    },
    clock: readClock(),
  };
}

function readCPU(): CPUInfo {
  const [load1] = Deno.loadavg();
  const cores = navigator.hardwareConcurrency;
  return {
    cores,
    load1,
    percent: Math.min(100, (load1 / cores) * 100),
  };
}

function readMem(): MemInfo {
  const m = Deno.systemMemoryInfo();
  const used = m.total - m.available;
  return {
    total: m.total,
    used,
    free: m.available,
    percent: (used / m.total) * 100,
  };
}

async function readDisk(): Promise<DiskInfo> {
  const { statfs } = await import("node:fs/promises");
  const fs = await statfs("/");
  const total = fs.blocks * fs.bsize;
  const free = fs.bavail * fs.bsize;
  const used = total - free;
  return { total, used, free, percent: (used / total) * 100 };
}

async function readTemps(): Promise<TempInfo[]> {
  const seen = new Set<string>();
  const results: TempInfo[] = [];

  for await (const entry of Deno.readDir("/sys/class/hwmon")) {
    if (!entry.name.startsWith("hwmon")) continue;
    const base = `/sys/class/hwmon/${entry.name}`;
    const sensor = await readText(`${base}/name`).catch(() => "");
    if (!CPU_HWMON.has(sensor.trim())) continue;
    if (seen.has(sensor.trim())) continue;

    for await (const f of Deno.readDir(base)) {
      if (!/^temp\d+_input$/.test(f.name)) continue;
      const raw = Number(await readText(`${base}/${f.name}`).catch(() => "0"));
      if (!raw) continue;
      const celsius = raw > 1000 ? raw / 1000 : raw;
      if (celsius < 20 || celsius > 120) continue;

      const idx = f.name.match(/^temp(\d+)_input$/)![1];
      const label = (await readText(`${base}/temp${idx}_label`).catch(() => "")).trim();
      results.push({ zone: label || `temp${idx}`, celsius, sensor: sensor.trim() });
      seen.add(sensor.trim());
      break;
    }
  }

  results.sort((a, b) => score(a.zone) - score(b.zone));
  return results;
}

function score(zone: string): number {
  for (let i = 0; i < PREFERRED.length; i++) {
    if (PREFERRED[i].test(zone)) return i;
  }
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

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}