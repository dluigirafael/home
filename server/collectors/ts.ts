import { CONFIG } from "../config.ts";

export interface TSInfo {
  online: boolean;
  clients: number | null;
  maxClients: number | null;
}

export interface TSStats {
  info: TSInfo;
  humans: number | null;
}

const OFFLINE: TSInfo = { online: false, clients: null, maxClients: null };

export async function collectTs(): Promise<TSStats> {
  if (!CONFIG.tsApiKey) return { info: OFFLINE, humans: null };

  const [info, humans] = await Promise.all([
    readServerInfo().catch(() => OFFLINE),
    readHumans().catch(() => null),
  ]);

  return { info, humans };
}

async function tsRequest(path: string): Promise<any> {
  const url = `http://${CONFIG.tsHost}:${CONFIG.tsPort}${path}`;
  const res = await fetch(url, {
    headers: { "x-api-key": CONFIG.tsApiKey },
    signal: AbortSignal.timeout(CONFIG.tsTimeoutMs),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

async function readServerInfo(): Promise<TSInfo> {
  const data = await tsRequest("/1/serverinfo");
  const d = Array.isArray(data.body) ? data.body[0] : data.body;
  const online = Number(d.virtualserver_clientsonline ?? 0);
  const query = Number(d.virtualserver_queryclientsonline ?? 0);
  return {
    online: true,
    clients: Math.max(0, online - query) || null,
    maxClients: Number(d.virtualserver_maxclients ?? 0) || null,
  };
}

async function readHumans(): Promise<number | null> {
  const groups = await tsRequest("/1/servergrouplist");
  const groupList = Array.isArray(groups.body) ? groups.body : [];
  const botGroup = groupList.find((g: any) => g.name === CONFIG.tsBotGroup);
  if (!botGroup) return null;

  const sgid = String(botGroup.sgid);
  const clients = await tsRequest("/1/clientlist?-groups");
  const list = Array.isArray(clients.body) ? clients.body : [];

  return list.filter((c: any) => {
    if (String(c.client_type) !== "0") return false;
    const groups = String(c.client_servergroups ?? "").split(",").map((s) => s.trim());
    return !groups.includes(sgid);
  }).length;
}