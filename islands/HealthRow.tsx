import { useState, useEffect } from "preact/hooks";
import type { ContainerInfo } from "../server/docker.ts";
import { fmtUptime, slugFor, iconUrl, fallbackIconUrl } from "../assets/format.ts";

export default function HealthRow({ c }: { c: ContainerInfo }) {
  const slug = slugFor(c.name);
  const [src, setSrc] = useState(() => iconUrl(slug));
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setSrc(iconUrl(slug));
    setHidden(false);
  }, [slug]);

  const cls = c.state === "running" ? "ok" : c.state === "partial" ? "warn" : "bad";
  const label = c.state === "partial" ? `${c.name} ${c.running}/${c.total}` : c.name;

  const onError = () => {
    if (src.endsWith(".svg")) setSrc(fallbackIconUrl(slug));
    else setHidden(true);
  };

  return (
    <div class="h-item">
      {hidden
        ? <span class="h-icon" aria-hidden="true" />
        : <img class="h-icon" src={src} alt="" loading="lazy" onError={onError} />}
      <span class={`h-dot ${cls}`} />
      <div class="h-meta">
        <span class="h-name">{label}</span>
        <span class="h-sub">
          {c.uptime != null && <span>{fmtUptime(c.uptime)}</span>}
          {c.restarts > 0 && (
            <span class={c.restarts > 5 ? "bad" : ""}>↻ {c.restarts}</span>
          )}
        </span>
      </div>
    </div>
  );
}