interface Props {
  values: number[];
  target: number;
  /** CSS colour for the trace. */
  color: string;
  width?: number;
  height?: number;
}

/** Rolling-rate trace with the target drawn as a dashed reference line. */
export default function Sparkline({ values, target, color, width = 240, height = 34 }: Props) {
  if (values.length < 2) {
    return <div className="spark spark--empty">collecting…</div>;
  }

  const max = Math.max(target * 1.25, ...values);
  const min = 0;
  const span = max - min || 1;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / span) * height;

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const targetY = y(target).toFixed(1);

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.14" />
      <line x1="0" x2={width} y1={targetY} y2={targetY} stroke="var(--line-target)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
