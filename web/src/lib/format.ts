import type { DocKind, FieldValue, TemplateField } from './types';

/** Rend une valeur lisible dans un tableau ou une fiche. */
export function displayValue(value: FieldValue, field?: Pick<TemplateField, 'type'>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (field?.type === 'date') return formatDate(String(value));
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
}

/** `2024-03-15` -> `15/03/2024` */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  pdf: 'PDF',
  docx: 'Word',
  image: 'Image',
  dicom: 'DICOM',
  text: 'Texte',
  unknown: 'Inconnu',
};

/** Pluriel simple : « 1 dossier » / « 3 dossiers ». */
export function plural(count: number, singular: string, plural?: string): string {
  return `${count} ${count > 1 ? (plural ?? `${singular}s`) : singular}`;
}

/** Transforme un libellé en clé technique valide (`Âge du patient` -> `age_du_patient`). */
export function slugifyKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  // La clé doit commencer par une lettre.
  return /^[a-z]/.test(base) ? base : `var_${base}`;
}
