import type {
  DicomRule,
  DocKind,
  Evidence,
  ExtractionRule,
  FieldValue,
  KeywordRule,
  LabelRule,
  RegexRule,
  TemplateField,
} from '../domain/types.js';
import { coerce } from './coerce.js';
import { escapeRegex, fold, foldText, makeSnippet, toOriginalRange, type FoldedText } from './fold.js';

/** Document tel que le moteur le consomme. */
export interface SourceDoc {
  id: number;
  name: string;
  kind: DocKind;
  text: string;
  /** Tags DICOM aplatis : mot-clé et code hexa pointent vers la même valeur. */
  dicomTags: Record<string, string>;
  /** Cache du texte replié, calculé une fois par passe d'extraction. */
  folded?: FoldedText;
}

export interface RuleHit {
  value: FieldValue;
  confidence: number;
  evidence: Evidence;
}

const DEFAULT_CONFIDENCE: Record<ExtractionRule['kind'], number> = {
  dicom: 0.95,
  label: 0.85,
  regex: 0.8,
  keyword: 0.7,
};

/**
 * Correspondance trouvée par une règle.
 *
 * `start` et `end` désignent des positions dans le texte *replié* ; `haystack`
 * est le texte qui a été parcouru — pas nécessairement celui du document,
 * puisqu'une règle peut viser le nom de fichier ou les tags DICOM. Conserver
 * les deux permet de restituer la valeur et l'extrait avec leur casse et leurs
 * accents d'origine.
 */
interface RuleMatch {
  raw: FieldValue;
  start: number;
  end: number;
  haystack: FoldedText | null;
}

/** Restitue le fragment d'origine correspondant à un intervalle replié. */
function originalSlice(ft: FoldedText, start: number, end: number): string {
  const range = toOriginalRange(ft, start, end);
  return ft.original.slice(range.start, range.end).trim();
}

/** Retire les diacritiques sans toucher à la casse (préserve `\D`, `\S`… dans les motifs). */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function foldedOf(doc: SourceDoc): FoldedText {
  if (!doc.folded) doc.folded = foldText(doc.text);
  return doc.folded;
}

/** Compile un motif en tolérant les échappements invalides en mode Unicode. */
function compile(pattern: string, flags: string): RegExp | null {
  const base = flags.includes('i') ? flags : flags + 'i';
  try {
    return new RegExp(pattern, base.includes('u') ? base : base + 'u');
  } catch {
    try {
      return new RegExp(pattern, base.replace(/u/g, ''));
    } catch {
      return null;
    }
  }
}

function describeRule(rule: ExtractionRule): string {
  switch (rule.kind) {
    case 'label':
      return `libellé « ${rule.labels.join(' » ou « ')} »`;
    case 'regex':
      return `expression régulière /${rule.pattern}/`;
    case 'keyword':
      return `mot-clé « ${rule.any.join(' » / « ')} »`;
    case 'dicom':
      return `tag DICOM ${rule.tag}`;
  }
}

function makeEvidence(
  doc: SourceDoc,
  rule: ExtractionRule,
  ft: FoldedText,
  foldedStart: number,
  foldedEnd: number,
): Evidence {
  const { start, end } = toOriginalRange(ft, foldedStart, foldedEnd);
  return {
    documentId: doc.id,
    documentName: doc.name,
    snippet: makeSnippet(ft.original, start, end),
    start,
    end,
    rule: describeRule(rule),
  };
}

/** Texte dans lequel la règle doit chercher. */
function haystack(doc: SourceDoc, source: 'text' | 'dicom' | 'filename' | undefined): FoldedText | null {
  switch (source ?? 'text') {
    case 'text':
      return foldedOf(doc);
    case 'filename':
      return foldText(doc.name);
    case 'dicom':
      // Les tags sont aplatis en « clé: valeur » par ligne pour rester interrogeables.
      return foldText(
        Object.entries(doc.dicomTags)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n'),
      );
    default:
      return null;
  }
}

/** Caractères qui séparent les mots d'un libellé : espaces et apostrophes. */
const LABEL_SEPARATORS = /[\s'‘’ʼ´`]+/g;

/**
 * Construit le motif d'un libellé.
 *
 * Les apostrophes et les espaces sont rendus interchangeables et facultatifs :
 * selon la source, « Durée d'hospitalisation » ressort en « Duree
 * d'hospitalisation », « Durée d’hospitalisation » ou « Duree d hospitalisation »
 * — l'extraction de texte d'un PDF remplace fréquemment l'apostrophe par une
 * espace. Un libellé saisi une fois doit couvrir ces variantes.
 */
function buildLabelPattern(label: string): string {
  return escapeRegex(fold(label).trim()).replace(
    LABEL_SEPARATORS,
    "[\\s'\\u2018\\u2019\\u02bc\\u00b4`]{0,3}",
  );
}

function applyLabelRule(rule: LabelRule, doc: SourceDoc): RuleMatch | null {
  const ft = haystack(doc, rule.source);
  if (!ft) return null;
  const max = Math.min(Math.max(rule.maxLength ?? 120, 1), 500);

  // Deux passes : avec séparateur explicite (fiable), puis simple espace (fallback).
  const separators = ['\\s*[:=]\\s*', '[  \\t]+'];
  for (const sep of separators) {
    for (const label of rule.labels) {
      const lab = buildLabelPattern(label);
      const re = compile(`(?:^|[^\\p{L}\\p{N}])${lab}${sep}([^\\n\\r;]{1,${max}})`, 'gu');
      if (!re) continue;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ft.folded)) !== null) {
        const captured = m[1];
        if (captured === undefined || captured.trim().length === 0) continue;
        const start = m.index + m[0].length - captured.length;
        const end = start + captured.length;
        const raw = originalSlice(ft, start, end);
        if (raw.length === 0) continue;
        return { raw, start, end, haystack: ft };
      }
    }
  }
  return null;
}

function applyRegexRule(rule: RegexRule, doc: SourceDoc): RuleMatch | null {
  const ft = haystack(doc, rule.source);
  if (!ft) return null;
  const re = compile(stripDiacritics(rule.pattern), (rule.flags ?? '') + 'g');
  if (!re) return null;

  let m: RegExpExecArray | null;
  while ((m = re.exec(ft.folded)) !== null) {
    // Évite la boucle infinie sur un motif de largeur nulle.
    if (m[0].length === 0) re.lastIndex++;
    const wanted = rule.group ?? 1;
    const captured = m[wanted] ?? m[0];
    if (captured === undefined || captured.trim().length === 0) continue;
    const offsetInMatch = m[0].indexOf(captured);
    const start = m.index + (offsetInMatch >= 0 ? offsetInMatch : 0);
    const end = start + captured.length;
    const raw = originalSlice(ft, start, end);
    if (raw.length === 0) continue;
    return { raw, start, end, haystack: ft };
  }
  return null;
}

/** Élisions françaises courantes, ramenées à leur forme pleine. */
const ELISIONS: Record<string, string> = {
  d: 'de', l: 'le', n: 'ne', s: 'se', c: 'ce', j: 'je', m: 'me', t: 'te', qu: 'que',
};

/**
 * Normalise un fragment pour la détection de négation.
 *
 * « pas de », « pas d'HTA » et « pas d’HTA » expriment la même chose ; sans
 * cette normalisation, l'utilisateur devrait saisir chaque variante
 * d'apostrophe et d'élision comme terme d'exclusion distinct.
 *
 * Utilisée uniquement pour un test de présence : elle modifie les longueurs
 * et ne doit donc jamais servir à calculer une position.
 */
function normalizeElision(fragment: string): string {
  return fragment
    .replace(/['‘’ʼ´`]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(qu|[dlnscjmt])\b/g, (_, group: string) => ELISIONS[group] ?? group);
}

/** Ponctuation qui clôt une proposition dans un compte rendu. */
const CLAUSE_BOUNDARY = /[,;.!?\n\r•|]/;

/**
 * Restreint le contexte de négation à la proposition qui contient le terme.
 *
 * Dans « pas de diabète, HTA sous traitement », le « pas de » porte sur le
 * diabète seul : une simple fenêtre de caractères le rattacherait à tort à
 * l'HTA et inverserait la variable. On ne remonte donc que jusqu'à la
 * ponctuation précédente.
 *
 * Exception : une proposition introduite par « ni » prolonge la négation
 * précédente — « pas de diabète, ni d'HTA » nie bien les deux.
 */
function negationContext(window: string): string {
  const parts = window.split(CLAUSE_BOUNDARY);
  let index = parts.length - 1;
  let context = parts[index] ?? '';
  while (index > 0 && /^\s*ni\b/.test(parts[index] ?? '')) {
    index--;
    context = `${parts[index] ?? ''} ${context}`;
  }
  return context;
}

function applyKeywordRule(rule: KeywordRule, doc: SourceDoc): RuleMatch | null {
  const ft = haystack(doc, rule.source);
  if (!ft) return null;
  const window = rule.noneWindow ?? 40;
  const negations = (rule.none ?? []).map((n) => normalizeElision(fold(n))).filter(Boolean);

  /** Première occurrence niée, retenue au cas où aucune occurrence affirmée n'existe. */
  let negatedHit: { start: number; end: number } | null = null;

  for (const term of rule.any) {
    const needle = fold(term).trim();
    if (needle.length === 0) continue;
    let from = 0;
    for (;;) {
      const idx = ft.folded.indexOf(needle, from);
      if (idx === -1) break;
      // Contexte précédant l'occurrence, pour détecter « pas de », « absence de »…
      const before = normalizeElision(
        negationContext(ft.folded.slice(Math.max(0, idx - window), idx)),
      );
      const negated = negations.some((n) => before.includes(n));
      if (!negated) {
        return { raw: rule.emit, start: idx, end: idx + needle.length, haystack: ft };
      }
      negatedHit ??= { start: idx, end: idx + needle.length };
      from = idx + needle.length;
    }
  }

  // Aucune mention affirmée dans ce document : l'absence documentée est une
  // information à part entière si la règle prévoit une valeur pour ce cas.
  if (negatedHit && rule.emitIfNegated !== undefined) {
    return { raw: rule.emitIfNegated, start: negatedHit.start, end: negatedHit.end, haystack: ft };
  }
  return null;
}

function applyDicomRule(rule: DicomRule, doc: SourceDoc): RuleMatch | null {
  const wanted = rule.tag.trim();
  const direct = doc.dicomTags[wanted];
  const value =
    direct ??
    // Recherche insensible à la casse et au formatage du code (x0010,0010).
    Object.entries(doc.dicomTags).find(
      ([k]) => fold(k) === fold(wanted) || fold(k) === fold(wanted.replace(/[(),x]/gi, '')),
    )?.[1];
  if (value === undefined || String(value).trim().length === 0) return null;
  return { raw: String(value).trim(), start: 0, end: 0, haystack: null };
}

/** Le document est-il éligible à cette règle (filtre par nature de document) ? */
function docAllowed(rule: ExtractionRule, doc: SourceDoc): boolean {
  if (rule.kind === 'dicom') return doc.kind === 'dicom';
  const kinds = rule.docKinds;
  if (!kinds || kinds.length === 0) return true;
  return kinds.includes(doc.kind);
}

/**
 * Applique les règles d'une variable à l'ensemble des documents d'un patient.
 * Les règles sont évaluées dans l'ordre : la première qui produit une valeur
 * typable gagne. Les règles suivantes servent donc de repli.
 */
export function extractField(field: TemplateField, docs: SourceDoc[]): RuleHit | null {
  const { extraction } = field;
  if (!extraction.enabled) return null;

  for (let i = 0; i < extraction.rules.length; i++) {
    const rule = extraction.rules[i]!;
    for (const doc of docs) {
      if (!docAllowed(rule, doc)) continue;

      let match: RuleMatch | null = null;
      switch (rule.kind) {
        case 'label':
          match = applyLabelRule(rule, doc);
          break;
        case 'regex':
          match = applyRegexRule(rule, doc);
          break;
        case 'keyword':
          match = applyKeywordRule(rule, doc);
          break;
        case 'dicom':
          match = applyDicomRule(rule, doc);
          break;
      }
      if (!match) continue;

      const typed = coerce(match.raw, field.type, field.options, extraction.postProcess);
      // Une correspondance non typable (« Âge : NR ») laisse la main aux règles suivantes.
      if (!typed.ok) continue;

      const base = rule.confidence ?? DEFAULT_CONFIDENCE[rule.kind];
      // Léger décalage selon le rang : les règles de repli sont moins sûres.
      const confidence = Math.max(0.05, Math.min(1, base - i * 0.03));

      return {
        value: typed.value,
        confidence: Number(confidence.toFixed(2)),
        evidence: match.haystack
          ? makeEvidence(doc, rule, match.haystack, match.start, match.end)
          : {
              documentId: doc.id,
              documentName: doc.name,
              snippet: `${rule.kind === 'dicom' ? rule.tag : field.key} = ${String(match.raw)}`,
              start: 0,
              end: 0,
              rule: describeRule(rule),
            },
      };
    }
  }

  return null;
}
