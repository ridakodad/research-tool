import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { displayValue, formatNumber, plural } from '../lib/format';
import { EmptyState, ErrorPanel, LoadingPanel } from '../components/ui';
import { Meter, StatTile } from '../components/charts/StatTile';
import { CategoryBars } from '../components/charts/CategoryBars';
import { Histogram } from '../components/charts/Histogram';
import { ChartHeader } from '../components/charts/primitives';
import type {
  CompletenessField,
  DatasetRow,
  FieldStats,
  Template,
  TemplateWithFields,
} from '../lib/types';

type Tab = 'table' | 'charts' | 'completeness';

export function ResultatsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [template, setTemplate] = useState<TemplateWithFields | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [summary, setSummary] = useState<{ patients: number; fields: number; completeness: number } | null>(null);
  const [stats, setStats] = useState<FieldStats[]>([]);
  const [completeness, setCompleteness] = useState<CompletenessField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('table');

  const load = useCallback(async (id?: number) => {
    setLoading(true);
    try {
      setError(null);
      const list = await api.listTemplates();
      setTemplates(list.templates);
      const target = id ?? list.active?.id ?? list.templates[0]?.id;
      if (!target) {
        setTemplate(null);
        return;
      }
      setTemplateId(target);

      const [dataset, statsData, completenessData] = await Promise.all([
        api.dataset(target),
        api.stats(target),
        api.completeness(target),
      ]);
      setTemplate(dataset.template);
      setRows(dataset.rows);
      setSummary(dataset.summary);
      setStats(statsData.stats);
      setCompleteness(completenessData.fields);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (loading && !template) return <LoadingPanel />;

  if (!template) {
    return (
      <EmptyState title="Aucune fiche d'exploitation">
        Créez d'abord une fiche depuis l'onglet « Fiche d'exploitation ».
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Résultats</h1>
          <p className="sub">
            Jeu de données constitué à partir des dossiers, tel qu'il sera exporté. Chaque ligne
            correspond à un dossier patient.
          </p>
        </div>
        <div className="page-head-actions">
          <select
            value={templateId ?? ''}
            onChange={(e) => void load(Number(e.target.value))}
            aria-label="Fiche d'exploitation"
            style={{ minWidth: 200 }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isActive ? ' — active' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Aucune donnée"
          action={
            <Link className="btn btn-primary" to="/dossiers">
              Importer des dossiers
            </Link>
          }
        >
          Importez des dossiers patients et lancez l'extraction pour voir apparaître les résultats.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-4">
            <StatTile label="Dossiers" value={summary?.patients ?? 0} />
            <StatTile label="Variables" value={summary?.fields ?? 0} />
            <StatTile
              label="Complétude globale"
              value={`${summary?.completeness ?? 0} %`}
              accent
              hint="Part des cases renseignées"
            />
            <StatTile
              label="Valeurs vérifiées"
              value={countBySource(rows, 'manual')}
              hint={`${countBySource(rows, 'auto')} issues de l'extraction`}
            />
          </div>

          <ExportPanel templateId={template.id} />

          <div className="card">
            <div className="card-head">
              <div className="row" style={{ gap: 4 }}>
                {(
                  [
                    ['table', 'Tableau brut'],
                    ['charts', 'Graphiques'],
                    ['completeness', 'Complétude'],
                  ] as [Tab, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={tab === key ? 'btn-primary btn-sm' : 'btn-sm'}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-body">
              {tab === 'table' && <RawTable template={template} rows={rows} />}
              {tab === 'charts' && <ChartsPanel stats={stats} patientCount={rows.length} />}
              {tab === 'completeness' && (
                <CompletenessPanel fields={completeness} patientCount={rows.length} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function countBySource(rows: DatasetRow[], source: 'manual' | 'auto'): number {
  return rows.reduce(
    (sum, row) => sum + Object.values(row.sources).filter((s) => s === source).length,
    0,
  );
}

/* ------------------------------------------------------------ tableau brut */

function RawTable({ template, rows }: { template: TemplateWithFields; rows: DatasetRow[] }) {
  const [search, setSearch] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyIncomplete && row.filled === template.fields.length) return false;
      if (!needle) return true;
      if (row.patientCode.toLowerCase().includes(needle)) return true;
      return Object.values(row.values).some((v) =>
        v !== null && String(v).toLowerCase().includes(needle),
      );
    });
  }, [rows, search, onlyIncomplete, template.fields.length]);

  return (
    <div className="stack">
      <div className="row">
        <input
          type="search"
          value={search}
          placeholder="Rechercher dans le tableau…"
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
          aria-label="Rechercher dans le tableau"
        />
        <label className="checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={onlyIncomplete}
            onChange={(e) => setOnlyIncomplete(e.target.checked)}
          />
          <span>Dossiers incomplets seulement</span>
        </label>
        <div className="spacer" />
        <span className="small secondary">{plural(filtered.length, 'ligne')}</span>
      </div>

      <div className="row small secondary" style={{ gap: 16 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--series-1)' }} />
          Extraction automatique
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--good)' }} />
          Vérifié ou saisi à la main
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--border-strong)' }} />
          Non renseigné
        </span>
      </div>

      <div className="table-scroll" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th className="table-sticky-col">Dossier</th>
              <th className="num">Compl.</th>
              {template.fields.map((field) => (
                <th key={field.id} title={field.description ?? undefined}>
                  {field.label}
                  {field.unit && <span style={{ fontWeight: 400 }}> ({field.unit})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.patientId}>
                <td className="table-sticky-col">
                  <Link to={`/dossiers/${row.patientId}`} style={{ fontWeight: 600 }}>
                    {row.patientCode}
                  </Link>
                </td>
                <td className="num small muted">
                  {row.filled}/{template.fields.length}
                </td>
                {template.fields.map((field) => {
                  const value = row.values[field.key] ?? null;
                  const source = row.sources[field.key];
                  const color =
                    source === 'manual'
                      ? 'var(--good)'
                      : source === 'auto'
                        ? 'var(--series-1)'
                        : 'var(--border-strong)';
                  return (
                    <td key={field.id}>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span className="dot" style={{ background: color }} aria-hidden="true" />
                        <span className={value === null ? 'muted' : undefined}>
                          {displayValue(value, field)}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="small muted" style={{ textAlign: 'center', padding: 20 }}>
          Aucune ligne ne correspond aux critères.
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- graphiques */

function ChartsPanel({ stats, patientCount }: { stats: FieldStats[]; patientCount: number }) {
  const plottable = stats.filter((s) => s.chart !== 'none');

  if (plottable.length === 0) {
    return (
      <EmptyState title="Aucune variable représentable">
        Les variables en texte libre ne se prêtent pas à une représentation graphique. Ajoutez des
        variables quantitatives ou à choix pour obtenir des distributions.
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-2 grid-cards">
      {plottable.map((stat) => (
        <div className="card" key={stat.key}>
          <div className="card-body">
            <ChartHeader
              title={stat.label + (stat.unit ? ` (${stat.unit})` : '')}
              subtitle={
                stat.missing > 0
                  ? `${stat.n} observation${stat.n > 1 ? 's' : ''} · ${stat.missing} manquante${stat.missing > 1 ? 's' : ''}`
                  : `${stat.n} observation${stat.n > 1 ? 's' : ''}`
              }
            />

            {stat.n === 0 ? (
              <p className="small muted">Aucune valeur renseignée pour cette variable.</p>
            ) : stat.chart === 'histogram' ? (
              <>
                <Histogram bins={stat.bins} unit={stat.unit} />
                {stat.summary && (
                  <div
                    className="row small secondary"
                    style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}
                  >
                    <span>
                      Moyenne <strong>{formatNumber(stat.summary.mean)}</strong> ±{' '}
                      {formatNumber(stat.summary.sd)}
                    </span>
                    <span>
                      Médiane <strong>{formatNumber(stat.summary.median)}</strong> [
                      {formatNumber(stat.summary.q1)} – {formatNumber(stat.summary.q3)}]
                    </span>
                    <span>
                      Extrêmes {formatNumber(stat.summary.min)} – {formatNumber(stat.summary.max)}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <CategoryBars data={stat.categories} total={stat.n} />
            )}
          </div>
        </div>
      ))}

      {patientCount === 0 && (
        <p className="small muted">Aucun dossier : les distributions sont vides.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- complétude */

function CompletenessPanel({
  fields,
  patientCount,
}: {
  fields: CompletenessField[];
  patientCount: number;
}) {
  const sorted = [...fields].sort((a, b) => a.rate - b.rate);

  return (
    <div className="stack">
      <p className="small secondary">
        Part des dossiers pour lesquels chaque variable est renseignée. Les variables en tête de
        liste sont celles qui demandent le plus de relecture — soit la règle d'extraction est à
        revoir, soit l'information n'est pas présente dans les documents.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Section</th>
              <th style={{ width: '28%' }}>Taux de remplissage</th>
              <th className="num">Automatique</th>
              <th className="num">Vérifié</th>
              <th className="num">Vide</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((field) => (
              <tr key={field.key}>
                <td>
                  <strong>{field.label}</strong>
                  {field.required && (
                    <span style={{ color: 'var(--critical)' }} title="Obligatoire">
                      {' '}
                      *
                    </span>
                  )}
                </td>
                <td className="small secondary">{field.section}</td>
                <td>
                  <Meter value={field.rate} />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {field.rate} % ({field.auto + field.manual}/{patientCount})
                  </div>
                </td>
                <td className="num">{field.auto}</td>
                <td className="num">{field.manual}</td>
                <td className="num">{field.empty || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ export */

function ExportPanel({ templateId }: { templateId: number }) {
  const [delimiter, setDelimiter] = useState(';');
  const [booleans, setBooleans] = useState('numeric');
  const [labels, setLabels] = useState(false);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Export</h2>
        <span className="sub">Le fichier reflète exactement le tableau brut ci-dessous.</span>
      </div>
      <div className="card-body">
        <div className="row" style={{ gap: 20, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 190 }}>
            <label htmlFor="csv-delimiter">Séparateur</label>
            <select
              id="csv-delimiter"
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value)}
            >
              <option value=";">Point-virgule — Excel (français)</option>
              <option value=",">Virgule — R, Python, SPSS</option>
            </select>
          </div>

          <div style={{ minWidth: 190 }}>
            <label htmlFor="csv-booleans">Variables Oui/Non</label>
            <select id="csv-booleans" value={booleans} onChange={(e) => setBooleans(e.target.value)}>
              <option value="numeric">1 / 0 — analyse statistique</option>
              <option value="text">Oui / Non — relecture</option>
            </select>
          </div>

          <label className="checkbox" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />
            <span>En-têtes en clair plutôt que les clés techniques</span>
          </label>

          <div className="spacer" />

          <div className="row" style={{ gap: 8 }}>
            <a
              className="btn"
              href={api.dictionaryUrl(templateId, delimiter)}
              title="Description de chaque variable : type, unité, options, définition"
            >
              Dictionnaire des variables
            </a>
            <a
              className="btn btn-primary"
              href={api.csvUrl(templateId, { delimiter, booleans, labels })}
            >
              Télécharger le CSV
            </a>
          </div>
        </div>

        <p className="small muted" style={{ marginTop: 12 }}>
          Le fichier est encodé en UTF-8 avec marque d'ordre des octets, pour qu'Excel affiche
          correctement les accents. Les variables à choix multiple sont exportées dans une seule
          colonne, options séparées par « | ».
        </p>
      </div>
    </div>
  );
}
