'use client';
type M = { id: string; label: string; freq: string };
// An FM dial: moods are stations along the band; the needle sits on the one playing.
export function Tuner({ moods, mood, onTune }: { moods: M[]; mood: string; onTune: (id: string) => void }) {
  const at = moods.find((m) => m.id === mood);
  const idx = Math.max(0, moods.findIndex((m) => m.id === mood));
  const left = at ? `calc(8px + (100% - 16px) * ${(idx + 0.5) / moods.length})` : '50%';
  return (
    <div className="tuner" role="radiogroup" aria-label="Mood">
      <div className="ticks" />
      <div className="needle" style={{ left }} />
      <div className="stations" style={{ display: 'grid', gridTemplateColumns: `repeat(${moods.length}, 1fr)` }}>
        {moods.map((m) => (
          <button key={m.id} role="radio" aria-checked={m.id === mood} aria-pressed={m.id === mood} onClick={() => onTune(m.id)} data-testid={`mood-${m.id}`}>
            <small className="num">{m.freq}</small>{m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
