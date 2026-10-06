import { TS_HOST, TS_PORT, TS_API_KEY, TS_BOT_GROUP, TS_TIMEOUT } from "../config.js";

const OFFLINE = { online: false, clients: null, maxClients: null };

async function request(path) {
	const res = await fetch(`http://${TS_HOST}:${TS_PORT}${path}`, {
		headers: { "x-api-key": TS_API_KEY },
		signal: AbortSignal.timeout(TS_TIMEOUT),
	});
	return { status: res.status, body: await res.text() };
}

export async function collectTs() {
	if (!TS_API_KEY) return { info: OFFLINE, humans: null };

	const [info, humans] = await Promise.all([
		readServerInfo().catch(() => OFFLINE),
		readHumans().catch(() => null),
	]);

	return { info, humans };
}

async function readServerInfo() {
	const r = await request("/1/serverinfo");
	if (r.status < 200 || r.status >= 300) return OFFLINE;

	const parsed = JSON.parse(r.body);
	const d = Array.isArray(parsed.body) ? parsed.body[0] : parsed.body;
	const online = Number(d.virtualserver_clientsonline ?? 0);
	const query = Number(d.virtualserver_queryclientsonline ?? 0);

	return {
		online: true,
		clients: Math.max(0, online - query) || null,
		maxClients: Number(d.virtualserver_maxclients ?? 0) || null,
	};
}

async function readHumans() {
	const [groupR, listR] = await Promise.all([request("/1/servergrouplist"), request("/1/clientlist?-groups")]);

	if (groupR.status < 200 || groupR.status >= 300) return null;
	if (listR.status < 200 || listR.status >= 300) return null;

	const groups = JSON.parse(groupR.body);
	const groupList = Array.isArray(groups.body) ? groups.body : [];
	const match = groupList.find((g) => g.name === TS_BOT_GROUP);
	if (!match) return null;

	const botGroup = String(match.sgid);
	const clients = JSON.parse(listR.body);
	const clientList = Array.isArray(clients.body) ? clients.body : [];

	return clientList.filter((c) => {
		if (String(c.client_type) !== "0") return false;
		const ids = String(c.client_servergroups || "")
			.split(",")
			.map((s) => s.trim());
		return !ids.includes(botGroup);
	}).length;
}
