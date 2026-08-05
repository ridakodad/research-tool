import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatDateTime, plural } from '../lib/format';
import { FolderUploader } from '../components/FolderUploader';
import { DocumentViewer, type ViewerFocus } from '../components/DocumentViewer';
import { SourceBadge, ValueEditor } from '../components/ValueEditor';
import { ErrorPanel, LoadingPanel, Modal, Spinner, useToast } from '../components/ui';
import { IconAlert, IconInfo } from '../components/icons';
import { Meter } from '../components/charts/StatTile';
import type {
  DocumentMeta,
  FieldValue,
  Patient,
  PatientRecord,
  TemplateWithFields,
} from '../lib/types';

export function DossierDetailPage() {
  const params = useParams();
  const patientId = Number(params.id);
  const toast = useToast();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [template, setTemplate] = useState<TemplateWithFields | null>(null);
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Corrections en attente d'enregistrement, par identifiant de variable. */
  const [edits, setEdits] = useState<Map<number, FieldValue>>(new Map());
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [showImport, setShowImport] = useState(false);
  /* Justification cliquée dans la fiche : amène le lecteur sur le bon
     document, à la bonne ligne. */
  const [focus, setFocus] = useState<ViewerFocus | null>(null);
  const focusNonce = useRef(0);

  const load = useCallback(async () => {
    if (!Number.isInteger(patientId)) {
      setError('Identifiant de dossier invalide.');
      return;
    }
    try {
      setError(null);
      const [detail, recordData] = await Promise.all([
        api.getPatient(patientId),
        api.getRecord(patientId),
      ]);
      setPatient(detail.patient);
      setDocuments(detail.documents);
      setTemplate(recordData.template);
      setRecord(recordData.record);
      setEdits(new Map());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const valuesByField = useMemo(() => {
    const map = new Map<number, PatientRecord['values'][number]>();
    for (const value of record?.values ?? []) map.set(value.fieldId, value);
    return map;
  }, [record]);

  const sections = useMemo(() => {
    const grouped = new Map<string, TemplateWithFields['fields']>();
    for (const field of template?.fields ?? []) {
      const list = grouped.get(field.section) ?? [];
      list.push(field);
      grouped.set(field.section, list);
    }
    return [...grouped.entries()];
  }, [template]);

  function currentValue(fieldId: number): FieldValue {
    if (edits.has(fieldId)) return edits.get(fieldId)!;
    return valuesByField.get(fieldId)?.value ?? null;
  }

  function setEdit(fieldId: number, value: FieldValue) {
    setEdits((current) => {
      const next = new Map(current);
      next.set(fieldId, value);
      return next;
    });
  }

  async function save() {
    if (!template || edits.size === 0) return;
    setSaving(true);
    try {
      const payload = [...edits.entries()].map(([fieldId, value]) => ({ fieldId, value }));
      const { record: updated } = await api.saveValues(template.id, patientId, payload);
      setRecord(updated);
      setEdits(new Map());
      toast.success(`${plural(payload.length, 'correction enregistrée', 'corrections enregistrées')}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function runExtraction() {
    if (!template) return;
    setRunning(true);
    try {
      const result = await api.runExtraction({ templateId: template.id, patientIds: [patientId] });
      const report = result.reports[0];
      toast.success(
        report
          ? `${report.extracted} valeurs extraites, ${report.notFound} non trouvées.`
          : 'Extraction terminée.',
      );
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function removeDocument(doc: DocumentMeta) {
    try {
      await api.deleteDocument(doc.id);
      toast.success(`« ${doc.filename} » supprimé.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function reparse(doc: DocumentMeta) {
    try {
      await api.reparseDocument(doc.id);
      toast.success(`« ${doc.filename} » ré-analysé.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!patient || !template || !record) return <LoadingPanel />;

  const filled = template.fields.filter((f) => {
    const value = currentValue(f.id);
    return value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
  }).length;
  const completeness = template.fields.length > 0 ? (filled / template.fields.length) * 100 : 0;
  const missingRequired = template.fields.filter(
    (f) => f.required && (currentValue(f.id) === null || currentValue(f.id) === ''),
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>
            <Link to="/dossiers">← Dossiers patients</Link>
          </div>
          <h1>{patient.code}</h1>
          <p className="sub">
            {patient.label ? `${patient.label} · ` : ''}
            {plural(documents.length, 'document')}
            {record.lastExtractionAt
              ? ` · dernière extraction le ${formatDateTime(record.lastExtractionAt)}`
              : ' · aucune extraction effectuée'}
          </p>
        </div>
        <div className="page-head-actions">
          <button onClick={() => setShowImport(true)}>Ajouter des documents</button>
          <button onClick={runExtraction} disabled={running || documents.length === 0}>
            {running ? <Spinner label="Extraction…" /> : 'Relancer l’extraction'}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || edits.size === 0}>
            {saving
              ? 'Enregistrement…'
              : edits.size > 0
                ? `Enregistrer (${edits.size})`
                : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* La relecture est un aller-retour entre la variable et le document
          qui la justifie : les deux restent donc côte à côte, et le lecteur
          de droite suit la fiche sans jamais la recouvrir. */}
      <div className="relecture">
        {/* ------------------------------------------------------- fiche */}
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Fiche d'exploitation</h2>
              <span className="sub">{template.name}</span>
            </div>
            <div className="card-body stack">
              <Meter
                value={completeness}
                label="Complétude du dossier"
                caption={`${filled} variable${filled > 1 ? 's' : ''} renseignée${filled > 1 ? 's' : ''} sur ${template.fields.length}`}
              />
              {missingRequired.length > 0 && (
                <div className="notice notice-warn">
                  <IconAlert size={18} />
                  <div>
                    <strong>Variables obligatoires non renseignées :</strong>{' '}
                    {missingRequired.map((f) => f.label).join(', ')}.
                  </div>
                </div>
              )}
              {documents.length === 0 && (
                <div className="notice notice-info">
                  <IconInfo size={18} />
                  <div>
                    Aucun document dans ce dossier. Importez des documents pour alimenter
                    l'extraction automatique, ou saisissez les variables à la main.
                  </div>
                </div>
              )}
            </div>
          </div>

          {sections.map(([section, fields]) => (
            <div className="card" key={section}>
              <div className="card-head">
                <h3>{section}</h3>
                <span className="sub">{plural(fields.length, 'variable')}</span>
              </div>
              <div className="card-body stack" style={{ gap: 18 }}>
                {fields.map((field) => {
                  const stored = valuesByField.get(field.id);
                  const edited = edits.has(field.id);
                  const inputId = `field-${field.id}`;
                  return (
                    <div key={field.id}>
                      <div className="row" style={{ marginBottom: 6, gap: 8 }}>
                        <label htmlFor={inputId} style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                          {field.label}
                          {field.unit && <span className="muted"> ({field.unit})</span>}
                          {field.required && (
                            <span style={{ color: 'var(--critical)' }} title="Variable obligatoire">
                              {' '}
                              *
                            </span>
                          )}
                        </label>
                        <div className="spacer" />
                        {edited ? (
                          <span className="badge badge-warn">Modifié</span>
                        ) : (
                          <SourceBadge source={stored?.source} confidence={stored?.confidence} />
                        )}
                      </div>

                      <ValueEditor
                        id={inputId}
                        field={field}
                        value={currentValue(field.id)}
                        onChange={(value) => setEdit(field.id, value)}
                      />

                      {field.description && <div className="field-hint">{field.description}</div>}

                      {!edited && stored?.evidence && (
                        <details style={{ marginTop: 6 }}>
                          <summary
                            className="small"
                            style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}
                          >
                            Justification — {stored.evidence.documentName}
                          </summary>
                          <div
                            className="small"
                            style={{
                              marginTop: 6,
                              padding: '8px 10px',
                              background: 'var(--surface-2)',
                              borderRadius: 'var(--radius-sm)',
                              borderLeft: '3px solid var(--series-1)',
                            }}
                          >
                            <div style={{ fontStyle: 'italic' }}>« {stored.evidence.snippet} »</div>
                            <div className="muted" style={{ marginTop: 5 }}>
                              Trouvé par {stored.evidence.rule} dans{' '}
                              <button
                                className="link-button"
                                onClick={() => {
                                  focusNonce.current += 1;
                                  setFocus({
                                    documentId: stored.evidence!.documentId,
                                    evidence: stored.evidence!,
                                    nonce: focusNonce.current,
                                  });
                                }}
                                title="Afficher le passage dans le document"
                              >
                                {stored.evidence.documentName}
                              </button>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* --------------------------------------------------- documents */}
        <DocumentViewer
          documents={documents}
          focus={focus}
          onAdd={() => setShowImport(true)}
          onReparse={(doc) => void reparse(doc)}
          onDelete={(doc) => void removeDocument(doc)}
        />
      </div>

      {showImport && (
        <Modal
          title={`Ajouter des documents — ${patient.code}`}
          onClose={() => setShowImport(false)}
          width={800}
        >
          <FolderUploader
            fixedPatient={{ id: patient.id, code: patient.code }}
            onDone={() => void load()}
          />
        </Modal>
      )}

    </div>
  );
}
