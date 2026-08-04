import { useState } from 'react';

/**
 * Identité visuelle de l'établissement.
 *
 * Le logo officiel n'est pas embarqué dans le dépôt : il est chargé depuis
 * `web/public/logo-hopital.png`, que l'établissement dépose lui-même. Tant que
 * le fichier est absent, une marque de repli neutre prend sa place — un
 * monogramme aux couleurs de la charte, jamais une imitation approximative du
 * logo, qui donnerait à l'application un air d'officiel qu'elle n'a pas.
 */

/** Servi à la racine par Vite depuis `web/public/`. */
const LOGO_URL = '/logo-hopital.png';

export const INSTITUTION = 'Hôpital Universitaire International Mohammed VI';
export const CITY = 'Rabat';

export function Brand() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="brand">
      {logoFailed ? (
        <span className="brand-mark" aria-hidden="true">
          E
        </span>
      ) : (
        <img
          className="brand-logo"
          src={LOGO_URL}
          alt={`${INSTITUTION} — ${CITY}`}
          /* Réservé avant chargement : évite que la barre supérieure ne saute
             quand l'image arrive. */
          width={120}
          height={34}
          onError={() => setLogoFailed(true)}
        />
      )}

      <span className="brand-divider" aria-hidden="true" />

      <span className="brand-text">
        <span className="brand-title">Espace de recherche</span>
        <span className="brand-sub">Exploitation de dossiers</span>
      </span>
    </div>
  );
}
