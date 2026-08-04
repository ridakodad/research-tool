import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { DOC_KIND_LABELS, formatBytes, formatDateTime, plural } from '../lib/format';
import { FolderUploader } from '../components/FolderUploader';
import { SourceBadge, ValueEditor } from '../components/ValueEditor';
import {
  ConfirmButton,
  EmptyState,
  ErrorPanel,
  LoadingPanel,
  Modal,
  Spinner,
  useToast,
} from '../components/ui';
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
  const [preview, setPreview] = useState<DocumentMeta | null>(null);

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

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)' }}>
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
                  <span aria-hidden="true">⚠</span>
                  <div>
                    <strong>Variables obligatoires non renseignées :</strong>{' '}
                    {missingRequired.map((f) => f.label).join(', ')}.
                  </div>
                </div>
              )}
              {documents.length === 0 && (
                <div className="notice notice-info">
                  <span aria-hidden="true">ℹ</span>
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
                                className="btn-sm"
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  padding: 0,
                                  color: 'var(--series-1)',
                                  textDecoration: 'underline',
                                }}
                                onClick={() => {
                                  const doc = documents.find(
                                    (d) => d.id === stored.evidence!.documentId,
                                  );
                                  if (doc) setPreview(doc);
                                }}
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
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Documents</h2>
              <span className="sub">{plural(documents.length, 'fichier')}</span>
            </div>
            {documents.length === 0 ? (
              <EmptyState
                title="Aucun document"
                action={
                  <button className="btn-primary btn-sm" onClick={() => setShowImport(true)}>
                    Ajouter des documents
                  </button>
                }
              >
                Les documents importés ici alimentent l'extraction automatique.
              </EmptyState>
            ) : (
              <div className="card-body stack" style={{ gap: 12 }}>
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      paddingBottom: 12,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="badge">{DOC_KIND_LABELS[doc.kind]}</span>
                      <span className="truncate" style={{ flex: 1, fontWeight: 500 }} title={doc.filename}>
                        {doc.filename}
                      </span>
                    </div>
                    <div className="row small muted" style={{ gap: 10 }}>
                      <span>{formatBytes(doc.size)}</span>
                      {doc.parseStatus === 'ok' ? (
                        <span>{doc.textLength.toLocaleString('fr-FR')} caractères extraits</span>
                      ) : doc.parseStatus === 'empty' ? (
                        <span className="badge badge-warn">Aucun texte</span>
                      ) : doc.parseStatus === 'error' ? (
                        <span className="badge badge-error">Analyse impossible</span>
                      ) : null}
                    </div>
                    {doc.parseError && (
                      <div className="small" style={{ color: 'var(--critical)', marginTop: 4 }}>
                        {doc.parseError}
                      </div>
                    )}
                    {doc.parseStatus === 'empty' && doc.kind === 'pdf' && (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        PDF sans couche texte (document scanné) : les variables devront être
                        saisies manuellement.
                      </div>
                    )}
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      <button className="btn-sm" onClick={() => setPreview(doc)}>
                        Texte extrait
                      </button>
                      <a
                        className="btn btn-sm"
                        href={api.documentFileUrl(doc.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Fichier
                      </a>
                      <button className="btn-sm" onClick={() => void reparse(doc)} title="Relancer l'analyse du fichier">
                        Ré-analyser
                      </button>
                      <div className="spacer" />
                      <ConfirmButton
                        label="Supprimer"
                        confirmLabel="Confirmer"
                        onConfirm={() => void removeDocument(doc)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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

      {preview && <DocumentPreview doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** Affiche le texte réellement extrait — indispensable pour comprendre un échec d'extraction. */
function DocumentPreview({ doc, onClose }: { doc: DocumentMeta; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDocumentText(doc.id)
      .then((r) => setText(r.text))
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [doc.id]);

  const dicomTags = doc.metadata['dicomTags'] as Record<string, string> | undefined;

  return (
    <Modal title={doc.filename} onClose={onClose} width={880}>
      <div className="stack">
        <div className="row small secondary">
          <span className="badge">{DOC_KIND_LABELS[doc.kind]}</span>
          <span>{formatBytes(doc.size)}</span>
          <span>importé le {formatDateTime(doc.createdAt)}</span>
        </div>

        {error && <ErrorPanel message={error} />}

        {dicomTags && Object.keys(dicomTags).length > 0 && (
          <details className="section">
            <summary>Métadonnées DICOM</summary>
            <div className="table-scroll" style={{ marginTop: 10, maxHeight: 260 }}>
              <table>
                <tbody>
                  {Object.entries(dicomTags)
                    // Les codes hexadécimaux bruts doublonnent les mots-clés.
                    .filter(([key]) => !/^\d+$/.test(key))
                    .map(([key, value]) => (
                      <tr key={key}>
                        <td className="mono" style={{ width: '40%' }}>
                          {key}
                        </td>
                        <td>{value}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <div>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Texte extrait</h3>
          {text === null && !error ? (
            <Spinner label="Chargement du texte…" />
          ) : text && text.trim().length > 0 ? (
            <pre
              style={{
                margin: 0,
                padding: 14,
                background: 'var(--surface-2)',
                borderRadius: 'var(--radius-sm)',
                maxHeight: 420,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '0.82rem',
                lineHeight: 1.6,
                fontFamily: 'var(--mono)',
              }}
            >
              {text}
            </pre>
          ) : (
            <div className="notice notice-warn">
              <span aria-hidden="true">⚠</span>
              <div>
                Aucun texte n'a pu être extrait de ce document. C'est le cas des PDF scannés sans
                couche texte et des images lorsque la reconnaissance optique est indisponible.
                Les variables correspondantes devront être saisies manuellement.
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
