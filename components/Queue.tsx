import { fmt } from "../assets/format.ts";

interface Props {
  items?: Array<{ title: string; artist?: string; duration?: number }>;
  total?: number;
}

export function Queue({ items, total }: Props) {
  const list = (items ?? []).slice(0, 5);
  if (list.length === 0) return null;

  return (
    <div class="queue">
      <h2>
        <span>Up Next</span>
        <span class="count">{total ?? list.length}</span>
      </h2>
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