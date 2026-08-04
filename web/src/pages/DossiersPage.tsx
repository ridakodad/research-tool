import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { StatTile } from '../components/charts/StatTile';
import type { Capabilities, ExtractionRunResult, PatientSummary, TemplateWithFields } from '../lib/types';

export function DossiersPage() {
  const toast = useToast();
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [template, setTemplate] = useState<TemplateWithFields | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<ExtractionRunResult | null>(null);

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

  async function runExtraction() {
    if (!template) return;
    setRunning(true);
    try {
      const result = await api.runExtraction({ templateId: template.id });
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
          <button onClick={() => setShowCreate(true)}>Nouveau dossier</button>
          <button className="btn-primary" onClick={() => setShowImport(true)}>
            Importer des dossiers
          </button>
        </div>
      </div>

      {capabilities && !capabilities.ocr.available && (
        <div className="notice notice-warn">
          <span aria-hidden="true">⚠</span>
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
        <div className="card">
          <div className="card-head">
            <h2>Extraction automatique</h2>
            <span className="sub">
              Applique la fiche « {template?.name ?? '—'} » à l'ensemble des dossiers.
            </span>
            <div className="card-actions">
              <button className="btn-primary" onClick={runExtraction} disabled={running || !template}>
                {running ? <Spinner label="Extraction…" /> : 'Lancer l’extraction'}
              </button>
            </div>
          </div>
          {lastRun && (
            <div className="card-body">
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
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                Les valeurs corrigées à la main ne sont jamais écrasées par une nouvelle
                extraction. Ouvrez un dossier pour vérifier chaque valeur et sa source.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Liste des dossiers</h2>
          <span className="sub">{plural(filtered.length, 'dossier')}</span>
          <div className="card-actions">
            <input
              type="search"
              value={search}
              placeholder="Rechercher un dossier…"
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
              aria-label="Rechercher un dossier"
            />
          </div>
        </div>

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
      </div>

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
