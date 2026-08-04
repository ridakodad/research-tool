import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { maxUploadBytes, uploadsDir } from '../config.js';
import { parseDocument } from '../extract/index.js';
import { ocrStatus } from '../extract/ocr.js';
import { asyncHandler, badRequest, intParam, notFound } from '../lib/http.js';
import {
  deleteDocument,
  findDuplicate,
  getDocument,
  getDocumentFile,
  getDocumentText,
  insertDocument,
  listDocuments,
  storedPath,
} from '../repo/documents.js';
import { getPatient } from '../repo/patients.js';

export const documentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 200 },
});

/** Extension sûre, dérivée du nom d'origine (jamais de chemin). */
function safeExtension(filename: string): string {
  const ext = path.extname(path.basename(filename)).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/** Nom d'affichage : on retire toute composante de chemin envoyée par le client. */
function displayName(filename: string): string {
  return path.basename(filename.replace(/\\/g, '/')).slice(0, 255) || 'document';
}

interface UploadOutcome {
  filename: string;
  status: 'imported' | 'duplicate' | 'error';
  documentId?: number;
  kind?: string;
  textLength?: number;
  message?: string;
}

/** Import de fichiers dans un dossier patient. */
documentsRouter.post(
  '/patients/:patientId/documents',
  upload.array('files'),
  asyncHandler(async (req, res) => {
    const patientId = intParam(req, 'patientId');
    const patient = getPatient(patientId);
    if (!patient) throw notFound('Dossier patient introuvable.');

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('Aucun fichier reçu.');

    const patientDir = path.join(uploadsDir, String(patientId));
    await fs.mkdir(patientDir, { recursive: true });

    const results: UploadOutcome[] = [];

    for (const file of files) {
      const name = displayName(file.originalname);
      try {
        const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

        const existing = findDuplicate(patientId, sha256);
        if (existing) {
          results.push({
            filename: name,
            status: 'duplicate',
            documentId: existing.id,
            message: `Fichier identique déjà importé (${existing.filename}).`,
          });
          continue;
        }

        const parsed = await parseDocument(file.buffer, name, file.mimetype);

        // Nom de stockage aléatoire : aucune donnée du client ne construit le chemin.
        const storedName = `${crypto.randomUUID()}${safeExtension(name)}`;
        await fs.writeFile(storedPath(patientId, storedName), file.buffer);

        const doc = insertDocument({
          patientId,
          filename: name,
          storedName,
          kind: parsed.kind,
          mime: file.mimetype || 'application/octet-stream',
          size: file.size,
          sha256,
          parseStatus: parsed.status,
          parseError: parsed.error,
          text: parsed.text,
          metadata: parsed.metadata,
          dicomTags: parsed.dicomTags,
        });

        results.push({
          filename: name,
          status: 'imported',
          documentId: doc.id,
          kind: doc.kind,
          textLength: doc.textLength,
          message: parsed.error ?? undefined,
        });
      } catch (err) {
        results.push({
          filename: name,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.status(201).json({
      results,
      documents: listDocuments(patientId),
      summary: {
        imported: results.filter((r) => r.status === 'imported').length,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        errors: results.filter((r) => r.status === 'error').length,
      },
    });
  }),
);

documentsRouter.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const doc = getDocument(intParam(req, 'id'));
    if (!doc) throw notFound('Document introuvable.');
    res.json({ document: doc });
  }),
);

/** Texte extrait intégral, affiché dans l'écran de vérification. */
documentsRouter.get(
  '/documents/:id/text',
  asyncHandler(async (req, res) => {
    const id = intParam(req, 'id');
    const text = getDocumentText(id);
    if (text === null) throw notFound('Document introuvable.');
    res.json({ text });
  }),
);

/** Fichier d'origine, pour relire le document source. */
documentsRouter.get(
  '/documents/:id/file',
  asyncHandler(async (req, res) => {
    const file = getDocumentFile(intParam(req, 'id'));
    if (!file) throw notFound('Document introuvable.');
    res.type(file.mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.sendFile(file.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Fichier absent du disque.' });
    });
  }),
);

/**
 * Relance l'analyse d'un document déjà importé.
 * Utile après l'activation de l'OCR ou une mise à jour des extracteurs.
 */
documentsRouter.post(
  '/documents/:id/reparse',
  asyncHandler(async (req, res) => {
    const id = intParam(req, 'id');
    const doc = getDocument(id);
    const file = getDocumentFile(id);
    if (!doc || !file) throw notFound('Document introuvable.');

    const buffer = await fs.readFile(file.path).catch(() => null);
    if (!buffer) throw notFound('Fichier absent du disque : réimportez-le.');

    const parsed = await parseDocument(buffer, doc.filename, doc.mime);
    const { db } = await import('../db/index.js');
    db.prepare(
      `UPDATE documents
          SET kind = ?, parse_status = ?, parse_error = ?, text_content = ?, metadata = ?
        WHERE id = ?`,
    ).run(
      parsed.kind,
      parsed.status,
      parsed.error,
      parsed.text,
      JSON.stringify({ ...parsed.metadata, dicomTags: parsed.dicomTags ?? undefined }),
      id,
    );

    res.json({ document: getDocument(id) });
  }),
);

documentsRouter.delete(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    if (!deleteDocument(intParam(req, 'id'))) throw notFound('Document introuvable.');
    res.status(204).end();
  }),
);

/** État de l'OCR, affiché dans l'interface pour expliquer un texte vide. */
documentsRouter.get(
  '/documents-capabilities',
  asyncHandler(async (_req, res) => {
    res.json({ ocr: await ocrStatus(), maxUploadBytes });
  }),
);
