import type { DocKind } from '../domain/types.js';
import { extractDicom } from './dicom.js';
import { extractDocx } from './docx.js';
import { extractImage } from './image.js';
import { extractPdf } from './pdf.js';
import { detectKind, looksLikeDicom, type ExtractionOutput } from './types.js';

export { detectKind, looksLikeDicom };
export type { ExtractionOutput };

export interface ParseResult extends ExtractionOutput {
  kind: DocKind;
  status: 'ok' | 'empty' | 'error';
  error: string | null;
}

/**
 * Analyse un fichier uploadé : détermine sa nature puis délègue à l'extracteur
 * correspondant. Une erreur d'analyse n'interrompt pas l'import — le document
 * est conservé avec son statut d'erreur, l'utilisateur pouvant saisir les
 * variables manuellement.
 */
export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<ParseResult> {
  let kind = detectKind(filename, mime);

  // Les exports PACS arrivent souvent sans extension : on confirme par le
  // préambule du fichier plutôt que par son nom.
  if ((kind === 'unknown' || kind === 'text') && looksLikeDicom(buffer)) {
    kind = 'dicom';
  }

  try {
    const output = await runExtractor(kind, buffer, filename);
    const status = output.text.trim().length > 0 ? 'ok' : 'empty';
    return { ...output, kind, status, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind,
      text: '',
      metadata: { textLayer: false },
      status: 'error',
      error: message.slice(0, 500),
    };
  }
}

async function runExtractor(
  kind: DocKind,
  buffer: Buffer,
  filename: string,
): Promise<ExtractionOutput> {
  switch (kind) {
    case 'pdf':
      return extractPdf(buffer, filename);
    case 'docx':
      return extractDocx(buffer, filename);
    case 'dicom':
      return extractDicom(buffer, filename);
    case 'image':
      return extractImage(buffer, filename);
    case 'text':
      return {
        text: buffer.toString('utf8'),
        metadata: { textLayer: true },
      };
    default:
      throw new Error(
        `Format non pris en charge (${filename}). Formats acceptés : PDF, Word (.docx), images, DICOM, texte.`,
      );
  }
}
