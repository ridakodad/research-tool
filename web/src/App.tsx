import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeToggle } from './components/ui';
import { Brand } from './components/Brand';
import {
  IconChart,
  IconExport,
  IconExtract,
  IconFolders,
  IconForm,
  IconGauge,
  IconSidebar,
  IconTable,
  IconWorkspace,
} from './components/icons';
import { WorkspaceProvider, useWorkspace } from './lib/workspace';
import { DossiersPage } from './pages/DossiersPage';
import { DossierDetailPage } from './pages/DossierDetailPage';
import { FichePage } from './pages/FichePage';
import { ResultatsPage } from './pages/ResultatsPage';
import { WorkspacePage } from './pages/WorkspacePage';

/**
 * Coquille de l'espace de travail.
 *
 * L'application n'est pas un formulaire à parcourir du début à la fin : c'est
 * un atelier où le chercheur prend l'outil dont il a besoin. Le rail de gauche
 * les présente tous en permanence, groupés par nature du travail — constituer
 * le corpus, régler les instruments, lire les résultats, sortir les données.
 * L'extraction n'est qu'un de ces outils.
 */

interface Tool {
  to: string;
  label: string;
  icon: typeof IconWorkspace;
  /** Chiffre-clé, quand il en existe un qui aide à décider où aller. */
  count?: number | null;
  /** Le lien reste actif sur les routes filles (détail d'un dossier). */
  matchPrefix?: string;
}

function ToolRail({ collapsed }: { collapsed: boolean }) {
  const { patients, fields, completeness, loading } = useWorkspace();
  const { pathname, search, hash } = useLocation();

  const groups: { label: string; tools: Tool[] }[] = [
    {
      label: 'Corpus',
      tools: [
        {
          to: '/dossiers',
          label: 'Dossiers patients',
          icon: IconFolders,
          count: loading ? null : patients,
          matchPrefix: '/dossiers',
        },
      ],
    },
    {
      label: 'Instruments',
      tools: [
        {
          to: '/fiche',
          label: "Fiche d'exploitation",
          icon: IconForm,
          count: loading ? null : fields,
          matchPrefix: '/fiche',
        },
        { to: '/dossiers#extraction', label: 'Extraction', icon: IconExtract },
      ],
    },
    {
      label: 'Analyse',
      tools: [
        { to: '/resultats?vue=table', label: 'Tableau de données', icon: IconTable },
        { to: '/resultats?vue=charts', label: 'Distributions', icon: IconChart },
        {
          to: '/resultats?vue=completeness',
          label: 'Complétude',
          icon: IconGauge,
          count: loading ? null : completeness,
        },
      ],
    },
    {
      label: 'Sortie',
      tools: [{ to: '/resultats?vue=export', label: 'Export', icon: IconExport }],
    },
  ];

  /**
   * Un seul outil est mis en avant à la fois. Plusieurs entrées visent la même
   * route en variant l'ancre ou la vue : la comparaison porte donc sur le
   * chemin, la vue et l'ancre pris ensemble, sinon deux entrées voisines
   * s'allumeraient en même temps.
   */
  const isActive = (tool: Tool): boolean => {
    const [target, targetHash] = tool.to.split('#');
    const [targetPath, targetQuery] = (target ?? '').split('?');

    if (targetHash) return pathname === targetPath && hash === `#${targetHash}`;
    if (tool.matchPrefix) return pathname.startsWith(tool.matchPrefix) && hash === '';
    if (targetQuery) {
      // `/resultats` sans paramètre affiche le tableau : la première entrée de
      // la famille reste donc allumée sur l'URL nue.
      const effective = search === '' ? '?vue=table' : search;
      return pathname === targetPath && effective === `?${targetQuery}`;
    }
    return pathname === targetPath;
  };

  return (
    <nav
      className={collapsed ? 'rail rail-collapsed' : 'rail'}
      aria-label="Outils de l'espace de recherche"
    >
      <div className="rail-group">
        <NavLink
          to="/"
          end
          className={({ isActive: active }) => (active ? 'rail-item active' : 'rail-item')}
          title={collapsed ? 'Plan de travail' : undefined}
        >
          <IconWorkspace />
          <span className="rail-text">Plan de travail</span>
        </NavLink>
      </div>

      {groups.map((group) => (
        <div className="rail-group" key={group.label}>
          <div className="rail-label">{group.label}</div>
          {group.tools.map((tool) => {
            const Icon = tool.icon;
            const active = isActive(tool);
            return (
              <NavLink
                key={tool.to}
                to={tool.to}
                /* Forme fonction imposée : avec une chaîne, NavLink ajoute sa
                   propre classe « active », calculée sur le seul chemin. Les
                   quatre vues de résultats partagent le même chemin et
                   s'allumeraient donc toutes en même temps. */
                className={() => (active ? 'rail-item active' : 'rail-item')}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? tool.label : undefined}
              >
                <Icon />
                <span className="rail-text">{tool.label}</span>
                {tool.count != null && (
                  <span className="rail-count">
                    {tool.label === 'Complétude' ? `${tool.count} %` : tool.count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function App() {
  const location = useLocation();
  // Le repli du rail est un réglage de poste de travail : il suit
  // l'utilisateur d'une session à l'autre.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('rail:collapsed') === '1',
  );

  const toggleRail = () => {
    setCollapsed((current) => {
      localStorage.setItem('rail:collapsed', current ? '0' : '1');
      return !current;
    });
  };

  return (
    <WorkspaceProvider>
      <div className={collapsed ? 'app rail-is-collapsed' : 'app'}>
        <a className="skip-link" href="#plan-de-travail">
          Aller au contenu
        </a>

        <header className="topbar">
          <button
            className="btn-icon btn-quiet"
            onClick={toggleRail}
            aria-label={collapsed ? "Déployer le rail d'outils" : "Replier le rail d'outils"}
            title={collapsed ? 'Déployer les outils' : 'Replier les outils'}
            aria-expanded={!collapsed}
          >
            <IconSidebar size={18} />
          </button>
          <Brand />
          <div className="topbar-end">
            <ThemeToggle />
          </div>
        </header>

        <div className="shell">
          <ToolRail collapsed={collapsed} />

          <main className="canvas" id="plan-de-travail">
            {/* La clé de route rejoue l'animation d'entrée : le changement
                d'outil se voit, sans que rien ne bouge pendant la lecture. */}
            <div className="view" key={location.pathname}>
              <Routes>
                <Route path="/" element={<WorkspacePage />} />
                <Route path="/dossiers" element={<DossiersPage />} />
                <Route path="/dossiers/:id" element={<DossierDetailPage />} />
                <Route path="/fiche" element={<FichePage />} />
                <Route path="/resultats" element={<ResultatsPage />} />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <h3>Page introuvable</h3>
                      <p>Le lien demandé ne correspond à aucun outil de l'espace de travail.</p>
                    </div>
                  }
                />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
