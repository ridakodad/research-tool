/**
 * Repliage de texte pour une recherche insensible à la casse et aux accents,
 * en conservant la correspondance avec les positions du texte d'origine.
 *
 * Un simple `normalize('NFD').replace(/\p{M}/gu,'')` décale les index et rend
 * impossible la citation exacte de l'extrait justificatif. On construit donc
 * une table de correspondance index replié -> index original.
 */
export interface FoldedText {
  /** Texte minuscule, sans diacritiques. */
  folded: string;
  /** `map[i]` = index dans le texte original du caractère `folded[i]`. */
  map: number[];
  /** Texte d'origine, pour les extraits. */
  original: string;
}

const COMBINING = /\p{M}/u;

export function foldText(original: string): FoldedText {
  let folded = '';
  const map: number[] = [];

  for (let i = 0; i < original.length; i++) {
    const ch = original[i]!;
    // Décompose puis retire les marques diacritiques ; « é » -> « e », « œ » reste « œ ».
    const decomposed = ch.normalize('NFD');
    let out = '';
    for (const part of decomposed) {
      if (!COMBINING.test(part)) out += part;
    }
    out = out.toLowerCase();
    for (const c of out) {
      folded += c;
      map.push(i);
    }
  }

  return { folded, map, original };
}

/** Convertit un intervalle du texte replié en intervalle du texte original. */
export function toOriginalRange(
  ft: FoldedText,
  foldedStart: number,
  foldedEnd: number,
): { start: number; end: number } {
  if (ft.map.length === 0) return { start: 0, end: 0 };
  const clampedStart = Math.max(0, Math.min(foldedStart, ft.map.length - 1));
  const start = ft.map[clampedStart]!;
  if (foldedEnd <= foldedStart) return { start, end: start };
  // `foldedEnd` est exclusif : on prend le dernier caractère inclus puis +1.
  const lastIdx = Math.max(0, Math.min(foldedEnd - 1, ft.map.length - 1));
  const end = ft.map[lastIdx]! + 1;
  return { start, end: Math.max(start, end) };
}

/** Replie une chaîne sans table de correspondance (pour les motifs et les clés de mapping). */
export function fold(s: string): string {
  let out = '';
  for (const part of s.normalize('NFD')) {
    if (!COMBINING.test(part)) out += part;
  }
  return out.toLowerCase();
}

/** Échappe une chaîne destinée à être insérée dans une expression régulière. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extrait un fragment de texte autour d'une correspondance, pour l'affichage. */
export function makeSnippet(
  text: string,
  start: number,
  end: number,
  padding = 90,
): string {
  const from = Math.max(0, start - padding);
  const to = Math.min(text.length, end + padding);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return (prefix + text.slice(from, to) + suffix).replace(/\s+/g, ' ').trim();
}
