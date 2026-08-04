import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt (server/src -> server -> racine, ou server/dist -> server -> racine). */
export const repoRoot = path.resolve(here, '..', '..');

/** Répertoire de données : base SQLite + fichiers uploadés. */
export const dataDir = path.resolve(
  process.env.DATA_DIR ?? path.join(repoRoot, 'data'),
);

export const uploadsDir = path.join(dataDir, 'uploads');
export const dbPath = process.env.DB_PATH ?? path.join(dataDir, 'research-tool.db');

export const port = Number(process.env.PORT ?? 4000);

/** Origines autorisées pour le CORS en développement (le front Vite tourne sur 5173). */
export const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Taille maximale d'un fichier uploadé (les séries DICOM et les PDF scannés sont volumineux). */
export const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);

/** Dossier des assets du front compilé, servis en production. */
export const webDistDir = path.join(repoRoot, 'web', 'dist');

export function ensureDataDirs(): void {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
