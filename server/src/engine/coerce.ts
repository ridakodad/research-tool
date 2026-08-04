import type { FieldType, FieldValue, FieldPostProcess } from '../domain/types.js';
import { fold } from './fold.js';

export type CoerceResult =
  | { ok: true; value: FieldValue }
  | { ok: false; reason: string };

const MONTHS_FR: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fevr: 2, fev: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, aou: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

const TRUE_WORDS = new Set([
  'oui', 'yes', 'true', 'vrai', '1', '+', 'positif', 'positive', 'present',
  'presente', 'presents', 'presentes', 'o', 'y', 'x',
]);
const FALSE_WORDS = new Set([
  'non', 'no', 'false', 'faux', '0', '-', 'negatif', 'negative', 'absent',
  'absente', 'absents', 'absentes', 'n', 'nil', 'neant',
]);

/** Sépare une valeur multi-choix : virgule, point-virgule, barre, saut de ligne, «+». */
const MULTI_SPLIT = /[;,/\n|]+|\s+\+\s+/;

function cleanText(raw: string): string {
  return raw
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    // Ponctuation résiduelle en fin de capture (« Âge : 54 ans. » -> « 54 ans »).
    .replace(/^[\s:;=.\-–—]+/, '')
    .replace(/[\s:;.,\-–—]+$/, '')
    .trim();
}

/**
 * Extrait le premier nombre d'une chaîne en gérant la virgule décimale
 * française et les espaces de milliers. « 12,5 g/dL » -> 12.5
 */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/ /g, ' ');
  const m = /-?\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/.exec(s);
  if (!m) return null;
  const normalized = m[0].replace(/[  ]/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejette les dates qui « débordent » (31/02 par exemple).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function expandYear(yy: number): number {
  if (yy >= 100) return yy;
  const pivot = new Date().getUTCFullYear() % 100;
  return yy <= pivot ? 2000 + yy : 1900 + yy;
}

/** Convertit une date écrite sous les formes usuelles en ISO `YYYY-MM-DD`. */
export function parseDate(raw: string): string | null {
  const s = fold(cleanText(raw));

  // YYYY-MM-DD / YYYY/MM/DD
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY (convention francophone : jour en premier)
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return buildDate(expandYear(Number(m[3])), Number(m[2]), Number(m[1]));

  // 12 mars 2021
  m = /(\d{1,2})\s*(?:er)?\s+([a-z]+)\.?\s+(\d{4})/.exec(s);
  if (m) {
    const month = MONTHS_FR[m[2]!];
    if (month) return buildDate(Number(m[3]), month, Number(m[1]));
  }

  // mars 2021 -> premier du mois
  m = /^([a-z]+)\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS_FR[m[1]!];
    if (month) return buildDate(Number(m[2]), month, 1);
  }

  // YYYYMMDD (format DICOM DA)
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.replace(/\s/g, ''));
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));

  return null;
}

/** Interprète une valeur booléenne écrite en clair. */
export function parseBoolean(raw: string): boolean | null {
  const s = fold(cleanText(raw));
  if (s.length === 0) return null;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  // Formulations négatives fréquentes dans les comptes rendus. Pas de `\b`
  // final : « absence de » enchaîne deux caractères de mot, la frontière
  // n'existe pas et la négation serait manquée.
  if (/^(pas d|absence d|aucun|sans|jamais|nie |non )/.test(s)) return false;
  if (/^(presence d|notion d|oui )/.test(s)) return true;
  // Premier mot seul (« oui, depuis 3 ans »).
  const first = s.split(/[\s,;]/)[0] ?? '';
  if (TRUE_WORDS.has(first)) return true;
  if (FALSE_WORDS.has(first)) return false;
  return null;
}

/** Rapproche un texte libre d'une option de la liste (comparaison repliée). */
function matchOption(raw: string, options: string[]): string | null {
  const s = fold(cleanText(raw));
  if (s.length === 0) return null;
  for (const opt of options) {
    if (fold(opt) === s) return opt;
  }
  // Correspondance partielle : l'option est citée dans le texte capturé.
  for (const opt of options) {
    const f = fold(opt);
    if (f.length >= 3 && s.includes(f)) return opt;
  }
  return null;
}

function applyValueMap(raw: string, map: Record<string, string> | undefined): string {
  if (!map) return raw;
  const s = fold(cleanText(raw));
  for (const [from, to] of Object.entries(map)) {
    if (fold(from) === s) return to;
  }
  for (const [from, to] of Object.entries(map)) {
    const f = fold(from);
    if (f.length >= 3 && s.includes(f)) return to;
  }
  return raw;
}

/**
 * Convertit une valeur brute (chaîne extraite, ou valeur déjà typée émise par
 * une règle mot-clé) vers le type déclaré de la variable.
 */
export function coerce(
  raw: FieldValue,
  type: FieldType,
  options: string[],
  post?: FieldPostProcess,
): CoerceResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'valeur vide' };

  // Une règle `keyword` peut émettre directement un booléen ou un nombre.
  if (typeof raw === 'boolean') {
    if (type === 'boolean') return { ok: true, value: raw };
    if (type === 'text') return { ok: true, value: raw ? 'Oui' : 'Non' };
    return { ok: false, reason: `booléen incompatible avec le type ${type}` };
  }
  if (Array.isArray(raw)) {
    if (type !== 'multi') return { ok: false, reason: `liste incompatible avec le type ${type}` };
    const picked = raw
      .map((v) => matchOption(String(v), options))
      .filter((v): v is string => v !== null);
    return picked.length > 0
      ? { ok: true, value: [...new Set(picked)] }
      : { ok: false, reason: 'aucune option reconnue' };
  }

  const rawText = typeof raw === 'number' ? String(raw) : raw;
  const text = cleanText(rawText);
  if (text.length === 0) return { ok: false, reason: 'valeur vide' };

  switch (type) {
    case 'text': {
      const mapped = applyValueMap(text, post?.valueMap);
      return { ok: true, value: mapped };
    }

    case 'number':
    case 'integer': {
      const n = parseNumber(text);
      if (n === null) return { ok: false, reason: `nombre introuvable dans « ${text} »` };
      let v = post?.scale ? n * post.scale : n;
      if (type === 'integer') v = Math.round(v);
      if (post?.min !== undefined && v < post.min) {
        return { ok: false, reason: `valeur ${v} sous le minimum ${post.min}` };
      }
      if (post?.max !== undefined && v > post.max) {
        return { ok: false, reason: `valeur ${v} au-dessus du maximum ${post.max}` };
      }
      return { ok: true, value: v };
    }

    case 'date': {
      const d = parseDate(text);
      return d
        ? { ok: true, value: d }
        : { ok: false, reason: `date non reconnue dans « ${text} »` };
    }

    case 'boolean': {
      const mapped = applyValueMap(text, post?.valueMap);
      const b = parseBoolean(mapped);
      return b === null
        ? { ok: false, reason: `booléen non reconnu dans « ${text} »` }
        : { ok: true, value: b };
    }

    case 'enum': {
      const mapped = applyValueMap(text, post?.valueMap);
      // Le mapping peut déjà renvoyer une option canonique.
      const direct = options.find((o) => fold(o) === fold(mapped));
      if (direct) return { ok: true, value: direct };
      const opt = matchOption(mapped, options);
      return opt
        ? { ok: true, value: opt }
        : { ok: false, reason: `« ${text} » ne correspond à aucune option` };
    }

    case 'multi': {
      const parts = text.split(MULTI_SPLIT).map((p) => p.trim()).filter(Boolean);
      const picked: string[] = [];
      for (const part of parts) {
        const mapped = applyValueMap(part, post?.valueMap);
        const direct = options.find((o) => fold(o) === fold(mapped));
        const opt = direct ?? matchOption(mapped, options);
        if (opt) picked.push(opt);
      }
      return picked.length > 0
        ? { ok: true, value: [...new Set(picked)] }
        : { ok: false, reason: `aucune option reconnue dans « ${text} »` };
    }

    default:
      return { ok: false, reason: `type inconnu ${String(type)}` };
  }
}
