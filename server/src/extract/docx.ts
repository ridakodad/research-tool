import mammoth from 'mammoth';
import type { ExtractionOutput } from './types.js';

/**
 * Extrait le texte d'un document Word.
 *
 * Les fiches sont très souvent structurées en tableaux Word. `extractRawText`
 * colle les cellules sans séparateur exploitable ; on passe donc par la
 * conversion HTML pour réinjecter des délimiteurs entre cellules et lignes,
 * ce qui permet aux règles « libellé : valeur » de fonctionner sur les tableaux.
 */
export async function extractDocx(buffer: Buffer, _filename: string): Promise<ExtractionOutput> {
  const html = await mammoth.convertToHtml({ buffer });
  const text = htmlToText(html.value);

  const messages = html.messages
    .filter((m) => m.type === 'warning' || m.type === 'error')
    .map((m) => m.message)
    .slice(0, 20);

  return {
    text,
    metadata: {
      converterMessages: messages,
      textLayer: text.trim().length > 0,
    },
  };
}

function htmlToText(html: string): string {
  return (
    html
      // Une cellule de tableau devient « libellé : valeur » via le séparateur.
      .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' : ')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|table)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
