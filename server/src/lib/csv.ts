import type { FieldValue } from '../domain/types.js';

/**
 * Échappe une cellule CSV (RFC 4180).
 *
 * Une valeur commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe :
 * sans cela, Excel l'interprète comme une formule à l'ouverture du fichier.
 */
function escapeCell(value: string, delimiter: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (v.includes(delimiter) || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export interface CsvOptions {
  /** `;` pour Excel en configuration française, `,` pour R / Python. */
  delimiter?: string;
  /** `true` pour Oui/Non, `false` pour 1/0 (préférable pour l'analyse statistique). */
  booleanAsText?: boolean;
  /** Séparateur interne des variables à choix multiples. */
  multiSeparator?: string;
}

export function formatValue(value: FieldValue, options: CsvOptions = {}): string {
  const { booleanAsText = false, multiSeparator = '|' } = options;
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') {
    if (booleanAsText) return value ? 'Oui' : 'Non';
    return value ? '1' : '0';
  }
  if (Array.isArray(value)) return value.join(multiSeparator);
  return String(value);
}

export function toCsv(
  headers: string[],
  rows: FieldValue[][],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ';';
  const lines: string[] = [
    headers.map((h) => escapeCell(h, delimiter)).join(delimiter),
  ];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCell(formatValue(cell, options), delimiter)).join(delimiter));
  }
  // CRLF + BOM UTF-8 : sans le BOM, Excel affiche « Ã¢ge » au lieu de « âge ».
  return '﻿' + lines.join('\r\n') + '\r\n';
}
