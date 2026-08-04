import { createRequire } from 'node:module';
import path from 'node:path';
import type { ExtractionOutput } from './types.js';

const require = createRequire(import.meta.url);

/** Dossier des polices standard livrées par pdfjs-dist (évite un avertissement au parsing). */
function standardFontDataUrl(): string {
  const pkg = require.resolve('pdfjs-dist/package.json');
  return path.join(path.dirname(pkg), 'standard_fonts') + path.sep;
}

/**
 * Extrait le texte d'un PDF page par page.
 *
 * Les PDF issus d'un scanner ne contiennent aucune couche texte : l'extraction
 * renvoie alors une chaîne vide et `metadata.textLayer` vaut `false`, ce qui
 * permet à l'interface de signaler qu'une saisie manuelle sera nécessaire.
 */
export async function extractPdf(buffer: Buffer, _filename: string): Promise<ExtractionOutput> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: standardFontDataUrl(),
    isEvalSupported: false,
    useSystemFonts: false,
    // Les PDF de dossiers patients ne sont pas des applications : on ignore le JS embarqué.
    disableAutoFetch: true,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      let line = '';
      const lines: string[] = [];

      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] as number;
        // pdf.js restitue des fragments : on reconstitue les lignes par position
        // verticale, sans quoi les libellés « Âge : 54 » sont coupés en morceaux.
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.trim());
          line = '';
        }
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = '';
        }
        lastY = y;
      }
      if (line.trim().length > 0) lines.push(line.trim());
      pages.push(lines.filter((l) => l.length > 0).join('\n'));
      page.cleanup();
    }

    const text = pages.join('\n\n');
    const info = await doc.getMetadata().catch(() => null);

    return {
      text,
      metadata: {
        pageCount: doc.numPages,
        textLayer: text.trim().length > 0,
        pdfInfo: info?.info ?? null,
      },
    };
  } finally {
    await doc.destroy();
  }
}
