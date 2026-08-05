import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatDateTime, plural } from '../lib/format';
import { FolderUploader } from '../components/FolderUploader';
import {
  ConfirmButton,
  EmptyState,
  ErrorPanel,
  LoadingPanel,
  Modal,
  Spinner,
  useToast,
} from '../components/ui';
import { IconAlert } from '../components/icons';
import { Panel, PanelGroupControls } from '../components/Panel';
import { StatTile } from '../components/charts/StatTile';
import type {
  Capabilities,
  ExtractionMode,
  ExtractionRunResult,
  PatientSummary,
  TemplateWithFields,
} from '../lib/types';

export function DossiersPage() {
  const toast = useToast();
  const { hash } = useLocation();
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [template, setTemplate] = useState<TemplateWithFields | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<ExtractionRunResult | null>(null);
  const [mode, setMode] = useState<ExtractionMode>('rules');

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, templates, caps] = await Promise.all([
        api.listPatients(),
        api.listTemplates(),
        api.capabilities().catch(() => null),
      ]);
      setPatients(list.patients);
      setTemplate(templates.active);
      setCapabilities(caps);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Le rail d'outils pointe sur `#extraction`, mais la carte visée n'existe
   * qu'une fois les dossiers chargés : le saut natif du navigateur arrive trop
   * tôt. On rejoue donc le déplacement quand la cible apparaît.
   */
  useEffect(() => {
    if (hash !== '#extraction' || patients === null) return;
    const target = document.getElementById('extraction');
    if (!target) return;
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: motionOk ? 'smooth' : 'auto', block: 'start' });
  }, [hash, patients]);

  async function runExtraction() {
    if (!template) return;
    setRunning(true);
    try {
      const result = await api.runExtraction({ templateId: template.id, mode });
      setLastRun(result);
      toast.success(
        `Extraction terminée : ${result.totals.extracted} valeurs trouvées sur ${plural(result.patientsProcessed, 'dossier')}.`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function removePatient(id: number, code: string) {
    try {
      await api.deletePatient(id);
      toast.success(`Dossier ${code} supprimé.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!patients) return <LoadingPanel />;

  const llmReady = capabilities?.llm.available ?? false;

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? patients.filter(
        (p) =>
          p.code.toLowerCase().includes(needle) ||
          (p.label ?? '').toLowerCase().includes(needle),
      )
    : patients;

  const totalDocuments = patients.reduce((sum, p) => sum + p.documentCount, 0);
  const withoutDocuments = patients.filter((p) => p.documentCount === 0).length;
  const unreadable = patients.reduce((sum, p) => sum + p.unreadableCount, 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dossiers patients</h1>
          <p className="sub">
            Importez les dossiers, puis lancez l'extraction pour remplir automatiquement la fiche
            d'exploitation à partir des documents.
          </p>
        </div>
        <div className="page-head-actions">
          <PanelGroupControls keys={['corpus.extraction', 'corpus.liste']} />
          <button className="btn-quiet" onClick={() => setShowCreate(true)}>Nouveau dossier</button>
          <button className="btn-primary" onClick={() => setShowImport(true)}>
            Importer des dossiers
          </button>
        </div>
      </div>

      {capabilities && !capabilities.ocr.available && (
        <div className="notice notice-warn">
          <IconAlert size={18} />
          <div>
            <strong>Reconnaissance de texte indisponible.</strong> Les images et les documents
            scannés seront importés sans contenu textuel exploitable — leurs variables devront
            être saisies manuellement.
            {capabilities.ocr.reason && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Détail : {capabilities.ocr.reason}
              </div>
            )}
          </div>
        </div>
      )}

      {patients.length > 0 && (
        <div className="grid grid-4">
          <StatTile label="Dossiers" value={patients.length} />
          <StatTile
            label="Documents importés"
            value={totalDocuments}
            hint={unreadable > 0 ? `${unreadable} sans texte exploitable` : undefined}
          />
          <StatTile
            label="Dossiers sans document"
            value={withoutDocuments}
            hint={withoutDocuments > 0 ? 'Rien à extraire pour ceux-ci' : undefined}
          />
          <StatTile
            label="Fiche active"
            value={<span style={{ fontSize: '1rem' }}>{template?.name ?? '—'}</span>}
            hint={template ? plural(template.fields.length, 'variable') : undefined}
          />
        </div>
      )}

      {patients.length > 0 && (
        /* Cible du raccourci « Extraction » du rail d'outils. */
        <div className="anchor-target" id="extraction">
        <Panel
          id="corpus.extraction"
          title="Extraction automatique"
          summary={`Fiche « ${template?.name ?? '—'} »`}
          actions={
            <>
              <div>
                <label htmlFor="extraction-mode" style={{ marginBottom: 4 }}>
                  Moteur
                </label>
                <select
                  id="extraction-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ExtractionMode)}
                  style={{ minWidth: 230 }}
                >
                  <option value="rules">Règles seules — gratuit, reproductible</option>
                  <option value="hybrid" disabled={!llmReady}>
                    Règles puis Claude — recommandé
                  </option>
                  <option value="llm" disabled={!llmReady}>
                    Claude seul
                  </option>
                </select>
              </div>
              <button
                className="btn-primary"
                onClick={runExtraction}
                disabled={running || !template}
                style={{ alignSelf: 'flex-end' }}
              >
                {running ? <Spinner label="Extraction…" /> : 'Lancer l’extraction'}
              </button>
            </>
          }
        >
          <div className="stack">
            {!llmReady && (
              <div className="notice">
                <span aria-hidden="true">ℹ</span>
                <div>
                  <strong>Extraction par Claude non configurée.</strong> Les règles traitent les
                  libellés ; Claude traite en plus le texte rédigé, où aucun libellé n'annonce la
                  valeur. Renseignez <span className="mono">ANTHROPIC_API_KEY</span> dans
                  l'environnement du serveur pour l'activer.
                  {capabilities?.llm.reason && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      Détail : {capabilities.llm.reason}
                    </div>
                  )}
                </div>
              </div>
            )}

            {llmReady && mode !== 'rules' && (
              <div className="small muted">
                Modèle {capabilities?.llm.model} · effort {capabilities?.llm.effort}. Chaque valeur
                proposée doit citer un extrait retrouvé dans le document, sinon elle est écartée.
              </div>
            )}

            {lastRun && (
              <div>
                <div className="row" style={{ gap: 20 }}>
                  <span>
                    <strong>{lastRun.totals.extracted}</strong>{' '}
                    <span className="secondary">valeurs extraites</span>
                  </span>
                  <span>
                    <strong>{lastRun.totals.notFound}</strong>{' '}
                    <span className="secondary">non trouvées</span>
                  </span>
                  <span>
                    <strong>{lastRun.totals.keptManual}</strong>{' '}
                    <span className="secondary">saisies manuelles préservées</span>
                  </span>
                  {lastRun.totals.unverified > 0 && (
                    <span title="Valeurs proposées par Claude sans citation retrouvable dans les documents">
                      <strong>{lastRun.totals.unverified}</strong>{' '}
                      <span className="secondary">écartées, non justifiées</span>
                    </span>
                  )}
                  {lastRun.totals.invalid > 0 && (
                    <span title="Valeurs incompatibles avec le type ou les options de la fiche">
                      <strong>{lastRun.totals.invalid}</strong>{' '}
                      <span className="secondary">écartées, hors format</span>
                    </span>
                  )}
                </div>

                {lastRun.usage && (
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Jetons consommés : {lastRun.usage.inputTokens.toLocaleString('fr-FR')} en
                    entrée ({lastRun.usage.cacheReadTokens.toLocaleString('fr-FR')} lus depuis le
                    cache), {lastRun.usage.outputTokens.toLocaleString('fr-FR')} en sortie.
                  </div>
                )}

                {lastRun.errors.length > 0 && (
                  <div className="notice notice-warn" style={{ marginTop: 10 }}>
                    <span aria-hidden="true">⚠</span>
                    <div>
                      <strong>{lastRun.errors.length} dossier(s) non traités par Claude.</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                        {lastRun.errors.slice(0, 5).map((e) => (
                          <li key={e.patientCode}>
                            {e.patientCode} — {e.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="small muted" style={{ marginTop: 8 }}>
                  Les valeurs corrigées à la main ne sont jamais écrasées par une nouvelle
                  extraction. Ouvrez un dossier pour vérifier chaque valeur et sa source.
                </div>
              </div>
            )}
          </div>
        </Panel>
        </div>
      )}

      <Panel
        id="corpus.liste"
        title="Liste des dossiers"
        summary={plural(filtered.length, 'dossier')}
        padded={false}
        actions={
          <input
            type="search"
            value={search}
            placeholder="Rechercher un dossier…"
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
            aria-label="Rechercher un dossier"
          />
        }
      >

        {patients.length === 0 ? (
          <EmptyState
            title="Aucun dossier pour l'instant"
            action={
              <button className="btn-primary" onClick={() => setShowImport(true)}>
                Importer des dossiers
              </button>
            }
          >
            Déposez une arborescence de dossiers patients : chaque sous-dossier devient un dossier,
            ses fichiers sont analysés à l'import.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="Aucun résultat">
            Aucun dossier ne correspond à « {search} ».
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Libellé</th>
                  <th className="num">Documents</th>
                  <th>État de l'analyse</th>
                  <th>Créé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <Link to={`/dossiers/${patient.id}`} style={{ fontWeight: 600 }}>
                        {patient.code}
                      </Link>
                    </td>
                    <td className="secondary">{patient.label ?? '—'}</td>
                    <td className="num">{patient.documentCount}</td>
                    <td>
                      {patient.documentCount === 0 ? (
                        <span className="badge badge-empty">Aucun document</span>
                      ) : patient.unreadableCount > 0 ? (
                        <span className="badge badge-warn">
                          {patient.unreadableCount} sans texte
                        </span>
                      ) : (
                        <span className="badge badge-manual">Analysé</span>
                      )}
                    </td>
                    <td className="small muted nowrap">{formatDateTime(patient.createdAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <Link className="btn btn-sm" to={`/dossiers/${patient.id}`}>
                          Ouvrir
                        </Link>
                        <ConfirmButton
                          label="Supprimer"
                          confirmLabel="Confirmer"
                          title="Supprime le dossier et tous ses documents"
                          onConfirm={() => void removePatient(patient.id, patient.code)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {showImport && (
        <Modal title="Importer des dossiers patients" onClose={() => setShowImport(false)} width={860}>
          <FolderUploader onDone={() => void load()} />
        </Modal>
      )}

      {showCreate && (
        <CreatePatientModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreatePatientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (code.trim().length === 0) return;
    setBusy(true);
    try {
      await api.createPatient({ code: code.trim(), label: label.trim() || null });
      toast.success(`Dossier ${code.trim()} créé.`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouveau dossier patient"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={submit} disabled={busy || code.trim().length === 0}>
            Créer
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="patient-code">Code du dossier</label>
        <input
          id="patient-code"
          type="text"
          value={code}
          placeholder="PAT-001"
          autoFocus
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <div className="field-hint">
          Identifiant anonymisé de l'observation. Il doit être unique et sert de clé dans
          l'export CSV.
        </div>
      </div>
      <div className="field">
        <label htmlFor="patient-label">Libellé (facultatif)</label>
        <input
          id="patient-label"
          type="text"
          value={label}
          placeholder="Groupe témoin, inclusion mars 2024…"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
    </Modal>
  );
}
