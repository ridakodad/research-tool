import { useState } from 'react';

/**
 * Identité visuelle de l'établissement.
 *
 * Le logo officiel n'est pas embarqué dans le dépôt : c'est une marque déposée,
 * pas un élément du code. Il est chargé depuis `web/public/`, où chaque
 * installation dépose le sien.
 *
 * Tant qu'aucun fichier n'est présent, une marque de repli neutre prend la
 * place — un monogramme aux couleurs de la charte, jamais une imitation
 * approximative du logo, qui donnerait à l'application un air d'officiel
 * qu'elle n'a pas.
 */

/**
 * Noms acceptés, dans l'ordre d'essai. Le vectoriel d'abord : c'est le format
 * qui reste net à toutes les tailles. Couvrir les trois extensions évite
 * d'avoir à modifier ce fichier selon ce que l'établissement fournit.
 */
const LOGO_CANDIDATES = [
  '/logo-hopital.svg',
  '/logo-hopital.png',
  '/logo-hopital.jpg',
] as const;

export const INSTITUTION = 'Hôpital Universitaire International Mohammed VI';
export const CITY = 'Rabat';

export function Brand() {
  // Index du candidat en cours ; au-delà du dernier, on affiche le monogramme.
  const [attempt, setAttempt] = useState(0);
  const source = LOGO_CANDIDATES[attempt];

  return (
    <div className="brand">
      {source ? (
        <img
          className="brand-logo"
          src={source}
          alt={`${INSTITUTION} — ${CITY}`}
          /* Réservé avant chargement : évite que la barre supérieure ne saute
             quand l'image arrive. */
          width={120}
          height={34}
          onError={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <span className="brand-mark" aria-hidden="true">
          E
        </span>
      )}

      <span className="brand-divider" aria-hidden="true" />

      <span className="brand-text">
        <span className="brand-title">Espace de recherche</span>
        <span className="brand-sub">Exploitation de dossiers</span>
      </span>
    </div>
  );
}
