import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

const TABS = [
  ['table', 'Tableau de données'],
  ['charts', 'Distributions'],
  ['completeness', 'Complétude'],
  ['export', 'Export'],
] as const;

type Tab = (typeof TABS)[number][0];

/**
 * La vue courante vit dans l'URL, pas dans un état interne : le rail d'outils
 * peut ainsi pointer directement sur une vue, et un lien vers une distribution
 * précise reste partageable entre deux personnes de l'équipe.
 */
function useTab(): [Tab, (tab: Tab) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get('vue');
  const tab = TABS.some(([key]) => key === requested) ? (requested as Tab) : 'table';
  return [tab, (next) => setParams({ vue: next })];
}

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
  const [tab, setTab] = useTab();

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
              hint={
                `${countBySource(rows, 'auto')} par règle` +
                (countBySource(rows, 'llm') > 0 ? `, ${countBySource(rows, 'llm')} par Claude` : '')
              }
            />
          </div>

          <div className="card">
            <div className="card-head">
              <div className="row" style={{ gap: 4 }} role="tablist" aria-label="Vue des résultats">
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
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
              {tab === 'export' && <ExportPanel templateId={template.id} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function countBySource(rows: DatasetRow[], source: 'manual' | 'auto' | 'llm'): number {
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
          <span className="dot" style={{ background: 'var(--source-rule)' }} />
          Règle d'extraction
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--source-llm)' }} />
          Proposé par Claude
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--source-manual)' }} />
          Vérifié ou saisi à la main
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--source-empty)' }} />
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
                  const origin =
                    source === 'manual'
                      ? { color: 'var(--source-manual)', label: 'Vérifié ou saisi à la main' }
                      : source === 'llm'
                        ? { color: 'var(--source-llm)', label: 'Proposé par Claude' }
                        : source === 'auto'
                          ? { color: 'var(--source-rule)', label: "Règle d'extraction" }
                          : { color: 'var(--source-empty)', label: 'Non renseigné' };
                  return (
                    <td key={field.id}>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {/* La pastille double la légende ; son infobulle
                            nomme l'origine, que la couleur seule ne suffit
                            pas à porter. */}
                        <span
                          className="dot"
                          style={{ background: origin.color }}
                          title={origin.label}
                        />
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
              <th className="num">Règle</th>
              <th className="num">Claude</th>
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
                    {field.rate} % ({field.auto + field.llm + field.manual}/{patientCount})
                  </div>
                </td>
                <td className="num">{field.auto}</td>
                <td className="num">{field.llm || '—'}</td>
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
    <div className="stack" style={{ gap: 16 }}>
      <p className="small secondary" style={{ maxWidth: '72ch' }}>
        Le fichier reflète exactement le tableau de données, valeurs relues
        comprises.
      </p>

      <div className="export-choice">
        <div>
          <h3 style={{ marginBottom: 4 }}>Classeur Excel</h3>
          <p className="small secondary" style={{ maxWidth: '58ch' }}>
            Trois feuilles : les données, le dictionnaire des variables, et une
            synthèse de cohorte avec effectifs, complétude et indicateurs de
            position. Les types sont portés par le fichier — une date reste une
            date, un nombre reste un nombre — donc aucun assistant
            d'importation ni reformatage à l'ouverture.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="checkbox" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />
            <span>En-têtes en clair</span>
          </label>
          <a className="btn btn-primary" href={api.xlsxUrl(templateId, labels)}>
            Télécharger le classeur
          </a>
        </div>
      </div>

      <div className="export-choice">
        <div>
          <h3 style={{ marginBottom: 4 }}>Figures en diaporama</h3>
          <p className="small secondary" style={{ maxWidth: '58ch' }}>
            Une planche par variable décrite, dessinée en formes natives — nette
            à toute échelle et modifiable sous PowerPoint, sans passer par une
            capture d'écran. Chaque planche porte son numéro de figure et sa
            page, de quoi la citer dans le texte d'un article.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href={api.pptxUrl(templateId)}>
            Télécharger les figures
          </a>
        </div>
      </div>

      <h3 style={{ marginTop: 8 }}>Formats texte</h3>
      <p className="small secondary" style={{ maxWidth: '72ch' }}>
        Pour R, Python ou SPSS. Réglez la mise en forme selon le logiciel qui
        recevra le jeu de données.
      </p>

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
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
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
          <a className="btn" href={api.templateJsonUrl(templateId)}>
            Fiche au format JSON
          </a>
          <a
            className="btn btn-primary"
            href={api.csvUrl(templateId, { delimiter, booleans, labels })}
          >
            Télécharger le CSV
          </a>
        </div>
      </div>

      <p className="small muted" style={{ maxWidth: '72ch' }}>
        Le fichier est encodé en UTF-8 avec marque d'ordre des octets, pour
        qu'Excel affiche correctement les accents. Les variables à choix
        multiple sont exportées dans une seule colonne, options séparées par
        « | ».
      </p>
    </div>
  );
}
