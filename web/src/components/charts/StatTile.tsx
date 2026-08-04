import type { ReactNode } from 'react';

/**
 * Tuile de synthèse : un libellé, une valeur, un complément facultatif.
 * Préférée à un graphique à une seule barre pour un chiffre isolé.
 */
export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Met la valeur en évidence quand elle porte le message principal. */
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-body" style={{ padding: '14px 16px' }}>
        <div className="small secondary">{label}</div>
        <div
          style={{
            fontSize: '1.75rem',
            fontWeight: 600,
            lineHeight: 1.15,
            marginTop: 2,
            color: accent ? 'var(--series-1)' : 'var(--text-primary)',
          }}
        >
          {value}
        </div>
        {hint && (
          <div className="small muted" style={{ marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Jauge de progression. La partie non remplie est un pas plus clair de la même
 * teinte, pour que l'état se lise sur toute la longueur de la barre.
 */
export function Meter({
  value,
  label,
  caption,
}: {
  /** Valeur de 0 à 100. */
  value: number;
  label?: string;
  caption?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      {label && (
        <div className="row small" style={{ marginBottom: 5 }}>
          <span className="secondary">{label}</span>
          <span
            className="spacer"
            style={{ marginLeft: 'auto' }}
            aria-hidden="true"
          />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {Math.round(clamped)} %
          </span>
        </div>
      )}
      <div
        className="meter"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progression'}
      >
        <div className="meter-fill" style={{ width: `${clamped}%` }} />
      </div>
      {caption && (
        <div className="small muted" style={{ marginTop: 5 }}>
          {caption}
        </div>
      )}
    </div>
  );
}
