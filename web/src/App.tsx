import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeToggle } from './components/ui';
import { DossiersPage } from './pages/DossiersPage';
import { DossierDetailPage } from './pages/DossierDetailPage';
import { FichePage } from './pages/FichePage';
import { ResultatsPage } from './pages/ResultatsPage';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>Exploitation de dossiers</span>
        </div>

        <nav className="nav" aria-label="Navigation principale">
          <NavLink to="/dossiers" className={({ isActive }) => (isActive ? 'active' : '')}>
            Dossiers patients
          </NavLink>
          <NavLink to="/fiche" className={({ isActive }) => (isActive ? 'active' : '')}>
            Fiche d'exploitation
          </NavLink>
          <NavLink to="/resultats" className={({ isActive }) => (isActive ? 'active' : '')}>
            Résultats
          </NavLink>
        </nav>

        <div className="topbar-end">
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dossiers" replace />} />
          <Route path="/dossiers" element={<DossiersPage />} />
          <Route path="/dossiers/:id" element={<DossierDetailPage />} />
          <Route path="/fiche" element={<FichePage />} />
          <Route path="/resultats" element={<ResultatsPage />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <h3>Page introuvable</h3>
                <p>Le lien demandé ne correspond à aucun écran de l'application.</p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
