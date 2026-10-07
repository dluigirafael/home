import { CONFIG } from "./config.ts";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof import("node:http");

export interface TSInfo {
  online: boolean;
  clients: number | null;
  maxClients: number | null;
}

export interface TSStats {
  info: TSInfo;
  humans: number | null;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function collectTs(): Promise<Result<TSStats>> {
  if (!CONFIG.tsApiKey) return { ok: false, error: "TS_API_KEY not set" };
  try {
    const [info, humans] = await Promise.all([readServerInfo(), readHumans()]);
    return { ok: true, data: { info, humans } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ts]", msg);
    return { ok: false, error: msg };
  }
}

function tsRequest(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: CONFIG.tsHost,
        port: CONFIG.tsPort,
        path,
        method: "GET",
        headers: { "x-api-key": CONFIG.tsApiKey },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error("invalid JSON")); }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(CONFIG.tsTimeoutMs, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function readServerInfo(): Promise<TSInfo> {
  const d = await tsRequest("/1/serverinfo");
  const row = Array.isArray(d.body) ? d.body[0] : d.body;
  const online = Number(row.virtualserver_clientsonline ?? 0);
  const query = Number(row.virtualserver_queryclientsonline ?? 0);
  return {
    online: true,
    clients: Math.max(0, online - query) || null,
    maxClients: Number(row.virtualserver_maxclients ?? 0) || null,
  };
}

async function readHumans(): Promise<number | null> {
  const groups = await tsRequest("/1/servergrouplist");
  const gl = Array.isArray(groups.body) ? groups.body : [];
  const bot = gl.find((g: any) => g.name === CONFIG.tsBotGroup);
  if (!bot) return null;
  const sgid = String(bot.sgid);

  const clients = await tsRequest("/1/clientlist?-groups");
  const list = Array.isArray(clients.body) ? clients.body : [];
  return list.filter((c: any) => {
    if (String(c.client_type) !== "0") return false;
    const gs = String(c.client_servergroups ?? "").split(",").map((s) => s.trim());
    return !gs.includes(sgid);
  }).length;
}