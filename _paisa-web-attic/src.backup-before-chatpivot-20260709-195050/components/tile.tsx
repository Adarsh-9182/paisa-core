export function Tile({ label, value, sub, title }: { label: string; value: string; sub: React.ReactNode; title?: string }) {
  return (
    <div className="tile" title={title}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

export function Delta({ changePct, goodWhenUp }: { changePct: number | null; goodWhenUp: boolean }) {
  if (changePct === null) return null;
  if (changePct === 0)
    return (
      <span className="font-bold" style={{ color: "var(--ink-3)" }}>
        → 0%{" "}
      </span>
    );
  const up = changePct > 0;
  const good = goodWhenUp ? up : !up;
  return (
    <span className="font-bold" style={{ color: good ? "var(--green)" : "var(--red)" }}>
      {up ? "↗" : "↘"} {Math.abs(changePct)}%{" "}
    </span>
  );
}
