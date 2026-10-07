export const fmt = (sec: number): string => {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

export const fmtUptime = (sec: number): string => {
  sec = Math.floor(sec || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

export const slugFor = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const iconUrl = (slug: string): string =>
  `https://media.sys.truenas.net/apps/${slug}/icons/icon.svg`;

export const fallbackIconUrl = (slug: string): string =>
  `https://media.sys.truenas.net/apps/${slug}/icons/icon.png`;