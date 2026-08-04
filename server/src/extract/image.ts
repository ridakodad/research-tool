import exifr from 'exifr';
import type { ExtractionOutput } from './types.js';
import { runOcr } from './ocr.js';

/**
 * Traite une image (photo ou scan de compte rendu).
 *
 * Deux sources d'information : l'OCR pour le contenu rédigé, et les
 * métadonnées EXIF pour la date de prise de vue — souvent la seule trace
 * fiable de la date d'un cliché photographié au lit du patient.
 */
export async function extractImage(buffer: Buffer, filename: string): Promise<ExtractionOutput> {
  const exif = await readExif(buffer);
  const ocr = await runOcr(buffer);

  const header: string[] = [`Image: ${filename}`];
  if (exif.dateTaken) header.push(`Date du cliché: ${exif.dateTaken}`);
  if (exif.make || exif.model) {
    header.push(`Appareil: ${[exif.make, exif.model].filter(Boolean).join(' ')}`);
  }

  const parts = [header.join('\n')];
  if (ocr && ocr.text.length > 0) parts.push(ocr.text);

  return {
    text: parts.join('\n\n'),
    metadata: {
      ...exif,
      ocrApplied: ocr !== null,
      ocrConfidence: ocr?.confidence ?? null,
      // `false` déclenche l'avertissement « saisie manuelle nécessaire ».
      textLayer: Boolean(ocr && ocr.text.length > 0),
    },
  };
}

interface ImageExif {
  width: number | null;
  height: number | null;
  dateTaken: string | null;
  make: string | null;
  model: string | null;
}

async function readExif(buffer: Buffer): Promise<ImageExif> {
  const empty: ImageExif = { width: null, height: null, dateTaken: null, make: null, model: null };
  try {
    const data = await exifr.parse(buffer, {
      pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'ExifImageWidth', 'ExifImageHeight'],
    });
    if (!data) return empty;
    const date: unknown = data.DateTimeOriginal ?? data.CreateDate;
    return {
      width: numberOrNull(data.ExifImageWidth),
      height: numberOrNull(data.ExifImageHeight),
      dateTaken: date instanceof Date ? date.toISOString().slice(0, 10) : null,
      make: typeof data.Make === 'string' ? data.Make.trim() : null,
      model: typeof data.Model === 'string' ? data.Model.trim() : null,
    };
  } catch {
    // Une image sans bloc EXIF (PNG, capture d'écran) n'est pas une erreur.
    return empty;
  }
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
