import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { displayValue, slugifyKey } from '../lib/format';
import { FIELD_TYPE_LABELS } from '../lib/types';
import type {
  ExtractionRule,
  FieldType,
  PatientSummary,
  RuleTestResult,
  TemplateField,
} from '../lib/types';
import { Modal, Spinner, StringListEditor, useToast } from './ui';
import { RULE_LABELS, RuleEditor, makeRule } from './RuleEditor';

type Draft = Omit<TemplateField, 'id' | 'templateId' | 'position'> & {
  id?: number;
  position?: number;
};

function emptyDraft(section: string): Draft {
  return {
    key: '',
    label: '',
    type: 'text',
    section,
    unit: null,
    description: null,
    required: false,
    options: [],
    extraction: { enabled: true, rules: [] },
  };
}

/**
 * Édition d'une variable de la fiche : identité, type, et paramétrage de son
 * extraction automatique. Le banc d'essai intégré évite d'avoir à relancer une
 * extraction complète pour vérifier une règle.
 */
export function FieldEditor({
  templateId,
  field,
  sections,
  patients,
  onClose,
  onSaved,
}: {
  templateId: number;
  /** `null` pour créer une nouvelle variable. */
  field: TemplateField | null;
  sections: string[];
  patients: PatientSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => field ?? emptyDraft(sections[0] ?? 'Général'));
  const [keyTouched, setKeyTouched] = useState(field !== null);
  const [saving, setSaving] = useState(false);
  const [newSection, setNewSection] = useState(false);

  const needsOptions = draft.type === 'enum' || draft.type === 'multi';

  const problems = useMemo(() => {
    const list: string[] = [];
    if (draft.label.trim().length === 0) list.push('Le libellé est obligatoire.');
    if (!/^[a-z][a-z0-9_]*$/.test(draft.key)) {
      list.push(
        'La clé doit commencer par une lettre minuscule et ne contenir que lettres, chiffres et « _ ».',
      );
    }
    if (needsOptions && draft.options.length === 0) {
      list.push('Une variable à choix doit avoir au moins une option.');
    }
    return list;
  }, [draft, needsOptions]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateRule(index: number, rule: ExtractionRule) {
    const rules = [...draft.extraction.rules];
    rules[index] = rule;
    update({ extraction: { ...draft.extraction, rules } });
  }

  function moveRule(index: number, direction: -1 | 1) {
    const target = index + direction;
    const rules = [...draft.extraction.rules];
    if (target < 0 || target >= rules.length) return;
    const moved = rules[index]!;
    rules[index] = rules[target]!;
    rules[target] = moved;
    update({ extraction: { ...draft.extraction, rules } });
  }

  async function save() {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const payload = {
        key: draft.key,
        label: draft.label.trim(),
        type: draft.type,
        section: draft.section.trim() || 'Général',
        unit: draft.unit?.trim() || null,
        description: draft.description?.trim() || null,
        required: draft.required,
        options: draft.options,
        extraction: draft.extraction,
      };
      if (field) await api.updateField(field.id, payload);
      else await api.createField(templateId, payload);
      toast.success(field ? 'Variable mise à jour.' : 'Variable ajoutée.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={field ? `Modifier « ${field.label} »` : 'Nouvelle variable'}
      onClose={onClose}
      width={880}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save} disabled={saving || problems.length > 0}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="stack">
        {problems.length > 0 && (
          <div className="notice notice-warn">
            <span aria-hidden="true">⚠</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ------------------------------------------------- identité */}
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="field-label">Libellé</label>
            <input
              id="field-label"
              type="text"
              value={draft.label}
              autoFocus
              placeholder="Âge du patient"
              onChange={(e) => {
                const label = e.target.value;
                // La clé technique suit le libellé tant qu'elle n'a pas été
                // modifiée à la main.
                update(keyTouched ? { label } : { label, key: slugifyKey(label) });
              }}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="field-key">Clé technique</label>
            <input
              id="field-key"
              type="text"
              className="mono"
              value={draft.key}
              onChange={(e) => {
                setKeyTouched(true);
                update({ key: e.target.value });
              }}
            />
            <div className="field-hint">En-tête de colonne dans le CSV.</div>
          </div>
        </div>

        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="field-type">Type</label>
            <select
              id="field-type"
              value={draft.type}
              onChange={(e) => update({ type: e.target.value as FieldType })}
            >
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="field-section">Section</label>
            {newSection ? (
              <input
                id="field-section"
                type="text"
                value={draft.section}
                placeholder="Nom de la section"
                onChange={(e) => update({ section: e.target.value })}
              />
            ) : (
              <select
                id="field-section"
                value={draft.section}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewSection(true);
                    update({ section: '' });
                  } else update({ section: e.target.value });
                }}
              >
                {sections.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
                <option value="__new__">+ Nouvelle section…</option>
              </select>
            )}
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="field-unit">Unité</label>
            <input
              id="field-unit"
              type="text"
              value={draft.unit ?? ''}
              placeholder="ans, mg/L…"
              onChange={(e) => update({ unit: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="field-description">Définition</label>
          <textarea
            id="field-description"
            value={draft.description ?? ''}
            placeholder="Précisez comment la variable est définie et mesurée."
            onChange={(e) => update({ description: e.target.value })}
          />
          <div className="field-hint">
            Reprise dans le dictionnaire des variables exporté avec les données.
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => update({ required: e.target.checked })}
          />
          <span>Variable obligatoire — signalée si elle reste vide</span>
        </label>

        {needsOptions && (
          <div className="field">
            <label>Options</label>
            <StringListEditor
              values={draft.options}
              onChange={(options) => update({ options })}
              placeholder="Favorable, Défavorable…"
              ariaLabel="Nouvelle option"
            />
            <div className="field-hint">
              Seules ces valeurs seront acceptées, en saisie comme en extraction.
            </div>
          </div>
        )}

        {/* ---------------------------------------------- extraction */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 style={{ fontSize: '0.95rem' }}>Extraction automatique</h3>
            <div className="spacer" />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.extraction.enabled}
                onChange={(e) =>
                  update({ extraction: { ...draft.extraction, enabled: e.target.checked } })
                }
              />
              <span>Activée</span>
            </label>
          </div>

          {!draft.extraction.enabled ? (
            <p className="small muted">
              Extraction désactivée : cette variable restera en saisie manuelle.
            </p>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {draft.extraction.rules.length === 0 && (
                <p className="small muted">
                  Aucune règle. Ajoutez-en une pour que cette variable soit renseignée
                  automatiquement à partir des documents.
                </p>
              )}

              {draft.extraction.rules.map((rule, index) => (
                <RuleEditor
                  key={index}
                  rule={rule}
                  fieldType={draft.type}
                  index={index}
                  total={draft.extraction.rules.length}
                  onChange={(next) => updateRule(index, next)}
                  onMove={(direction) => moveRule(index, direction)}
                  onRemove={() =>
                    update({
                      extraction: {
                        ...draft.extraction,
                        rules: draft.extraction.rules.filter((_, i) => i !== index),
                      },
                    })
                  }
                />
              ))}

              <div className="row" style={{ gap: 6 }}>
                <span className="small secondary">Ajouter une règle :</span>
                {(Object.keys(RULE_LABELS) as ExtractionRule['kind'][]).map((kind) => (
                  <button
                    key={kind}
                    className="btn-sm"
                    onClick={() =>
                      update({
                        extraction: {
                          ...draft.extraction,
                          rules: [...draft.extraction.rules, makeRule(kind)],
                        },
                      })
                    }
                  >
                    {RULE_LABELS[kind]}
                  </button>
                ))}
              </div>

              <PostProcessEditor draft={draft} onChange={update} />
              <RuleTestBench draft={draft} patients={patients} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Post-traitement : conversion des valeurs brutes et contrôle de plausibilité. */
function PostProcessEditor({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const post = draft.extraction.postProcess ?? {};
  const numeric = draft.type === 'number' || draft.type === 'integer';
  const [mapText, setMapText] = useState(() =>
    Object.entries(post.valueMap ?? {})
      .map(([from, to]) => `${from} = ${to}`)
      .join('\n'),
  );

  function setPost(patch: Record<string, unknown>) {
    onChange({
      extraction: { ...draft.extraction, postProcess: { ...post, ...patch } },
    });
  }

  return (
    <details className="section">
      <summary>Post-traitement</summary>
      <div style={{ marginTop: 14 }}>
        <div className="field">
          <label htmlFor="value-map">Correspondances de valeurs</label>
          <textarea
            id="value-map"
            className="mono"
            value={mapText}
            placeholder={'CT = Scanner\nMR = IRM\nH = Masculin'}
            onChange={(e) => {
              setMapText(e.target.value);
              const valueMap: Record<string, string> = {};
              for (const line of e.target.value.split('\n')) {
                const [from, ...rest] = line.split('=');
                const to = rest.join('=').trim();
                if (from?.trim() && to) valueMap[from.trim()] = to;
              }
              setPost({ valueMap: Object.keys(valueMap).length > 0 ? valueMap : undefined });
            }}
          />
          <div className="field-hint">
            Une correspondance par ligne, au format « texte trouvé = valeur retenue ». Utile pour
            ramener des abréviations ou des codes vers vos options.
          </div>
        </div>

        {numeric && (
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1, minWidth: 110 }}>
              <label htmlFor="post-min">Minimum plausible</label>
              <input
                id="post-min"
                type="number"
                value={post.min ?? ''}
                onChange={(e) =>
                  setPost({ min: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 110 }}>
              <label htmlFor="post-max">Maximum plausible</label>
              <input
                id="post-max"
                type="number"
                value={post.max ?? ''}
                onChange={(e) =>
                  setPost({ max: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 110 }}>
              <label htmlFor="post-scale">Facteur de conversion</label>
              <input
                id="post-scale"
                type="number"
                step="any"
                value={post.scale ?? ''}
                placeholder="1"
                onChange={(e) =>
                  setPost({ scale: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
          </div>
        )}
        {numeric && (
          <div className="field-hint">
            Une valeur hors bornes est rejetée et la règle suivante prend le relais — cela évite
            de capturer « 120 ans d'évolution » comme un âge.
          </div>
        )}
      </div>
    </details>
  );
}

/** Banc d'essai : évalue les règles sans rien enregistrer. */
function RuleTestBench({ draft, patients }: { draft: Draft; patients: PatientSummary[] }) {
  const [sampleText, setSampleText] = useState('');
  const [patientId, setPatientId] = useState<number | ''>('');
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Les règles ayant changé, l'ancien résultat n'a plus de sens.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [draft.extraction, draft.type, draft.options]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.testRule({
        field: {
          key: draft.key || 'test',
          label: draft.label || 'Test',
          type: draft.type,
          options: draft.options,
          extraction: draft.extraction,
        },
        sampleText: sampleText.trim() || undefined,
        patientId: patientId === '' ? undefined : patientId,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="section">
      <summary>Tester les règles</summary>
      <div style={{ marginTop: 14 }}>
        <div className="field">
          <label htmlFor="sample-text">Texte de test</label>
          <textarea
            id="sample-text"
            value={sampleText}
            placeholder="Collez un extrait de compte rendu pour vérifier ce que la règle capture…"
            onChange={(e) => setSampleText(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="test-patient">…ou tester sur un dossier réel</label>
          <select
            id="test-patient"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— aucun —</option>
            {patients
              .filter((p) => p.documentCount > 0)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} ({p.documentCount} document{p.documentCount > 1 ? 's' : ''})
                </option>
              ))}
          </select>
        </div>

        <button
          className="btn-sm btn-primary"
          onClick={run}
          disabled={busy || (sampleText.trim().length === 0 && patientId === '')}
        >
          {busy ? <Spinner label="Test…" /> : 'Tester'}
        </button>

        {error && (
          <div className="notice notice-error" style={{ marginTop: 12 }}>
            <span aria-hidden="true">⚠</span>
            <div>{error}</div>
          </div>
        )}

        {result && (
          <div className="notice" style={{ marginTop: 12 }} data-found={result.found}>
            <span aria-hidden="true">{result.found ? '✓' : '∅'}</span>
            <div style={{ flex: 1 }}>
              {result.found ? (
                <>
                  <div>
                    Valeur extraite :{' '}
                    <strong>{displayValue(result.value, { type: draft.type })}</strong>
                    {result.confidence != null && (
                      <span className="muted"> · confiance {Math.round(result.confidence * 100)} %</span>
                    )}
                  </div>
                  {result.evidence && (
                    <div className="small muted" style={{ marginTop: 6 }}>
                      <div style={{ fontStyle: 'italic' }}>« {result.evidence.snippet} »</div>
                      <div style={{ marginTop: 3 }}>
                        {result.evidence.rule} — {result.evidence.documentName}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  Aucune valeur trouvée dans les {result.documentsTested} source
                  {result.documentsTested > 1 ? 's' : ''} testée
                  {result.documentsTested > 1 ? 's' : ''}. Vérifiez les libellés, le type de la
                  variable et les bornes de plausibilité.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
