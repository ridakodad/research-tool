import type { FieldValue, TemplateField } from '../lib/types';

/**
 * Contrôle de saisie adapté au type de la variable.
 *
 * La saisie manuelle fait autorité sur l'extraction automatique : ces contrôles
 * n'acceptent que des valeurs conformes au type déclaré, de façon qu'une
 * relecture ne puisse pas introduire d'incohérence dans le jeu de données.
 */
export function ValueEditor({
  field,
  value,
  onChange,
  id,
}: {
  field: TemplateField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  id?: string;
}) {
  switch (field.type) {
    case 'boolean':
      return (
        <select
          id={id}
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? null : e.target.value === 'true')
          }
        >
          <option value="">— non renseigné —</option>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      );

    case 'enum':
      return (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">— non renseigné —</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case 'multi': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="row" style={{ gap: 10 }}>
          {field.options.map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className="checkbox" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((v) => v !== option)
                      : [...selected, option];
                    onChange(next.length > 0 ? next : null);
                  }}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case 'date':
      return (
        <input
          id={id}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );

    case 'number':
    case 'integer':
      return (
        <input
          id={id}
          type="number"
          step={field.type === 'integer' ? 1 : 'any'}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
        />
      );

    default:
      return (
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
  }
}

/** Indique d'où vient une valeur : extraction, relecture, ou absence. */
export function SourceBadge({
  source,
  confidence,
}: {
  source: 'auto' | 'manual' | 'empty' | undefined;
  confidence?: number | null;
}) {
  if (source === 'manual') return <span className="badge badge-manual">Vérifié</span>;
  if (source === 'auto') {
    return (
      <span className="badge badge-auto">
        Automatique
        {confidence != null && ` · ${Math.round(confidence * 100)} %`}
      </span>
    );
  }
  return <span className="badge badge-empty">Non renseigné</span>;
}
