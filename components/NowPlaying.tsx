import { fmt } from "../assets/format.ts";

interface Props {
  nowPlaying: { title: string; artist: string } | null;
  pos: number;
  dur: number;
}

export function NowPlaying({ nowPlaying, pos, dur }: Props) {
  if (!nowPlaying) return <span class="empty">Nothing playing</span>;

  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <>
      <div class="title">{nowPlaying.title || "Unknown"}</div>
      {nowPlaying.artist && <div class="artist">{nowPlaying.artist}</div>}
      <div class="progress">
        <span class="t">{fmt(pos)}</span>
        <div class="bar"><span style={{ width: `${pct}%` }} /></div>
        <span class="t">{fmt(dur)}</span>
      </div>
    </>
  );
}