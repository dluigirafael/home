interface Props {
  sha: string | null;
  date: string | null;
  runUrl: string | null;
}

export default function Build({ sha, date, runUrl }: Props) {
  const hasSha = !!sha;
  const d = date ? new Date(date) : null;
  const hasDate = !!d && !isNaN(d.getTime());
  if (!hasSha && !hasDate) return null;

  return (
    <footer class="build">
      {hasSha && (runUrl
        ? <a href={runUrl} target="_blank" rel="noopener">{sha!.slice(0, 7)}</a>
        : <span>{sha!.slice(0, 7)}</span>)}
      {hasSha && hasDate && <span> · </span>}
      {hasDate && <span>{d!.toISOString().slice(0, 16).replace("T", " ")}Z</span>}
    </footer>
  );
}