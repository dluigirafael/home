interface Props {
  values?: number[];
  width?: number;
  height?: number;
  stroke?: number;
  maxOverride?: number;
  color?: string;
}

export default function Sparkline({
  values,
  width = 100,
  height = 16,
  stroke = 1.5,
  maxOverride,
  color = "#8a8d94",
}: Props) {
  if (!values || values.length < 2) return null;

  const max = maxOverride ?? Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - Math.min(height, (v / max) * height);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg class="spark-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        stroke-width={stroke}
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}