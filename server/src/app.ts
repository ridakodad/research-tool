import express, { type Express } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { corsOrigins, webDistDir } from './config.js';
import { errorMiddleware } from './lib/http.js';
import { patientsRouter } from './routes/patients.js';
import { documentsRouter } from './routes/documents.js';
import { templatesRouter } from './routes/templates.js';
import { recordsRouter } from './routes/records.js';
import { analyticsRouter } from './routes/analytics.js';
import { exportRouter } from './routes/export.js';

/** Construit l'application Express. Séparé du démarrage pour les tests. */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: corsOrigins, credentials: true }));
  // Les fiches et leurs règles peuvent être volumineuses ; les fichiers passent
  // par multer et ne sont pas concernés par cette limite.
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/patients', patientsRouter);
  app.use('/api', documentsRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/export', exportRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route inconnue.' });
  });

  // En production, le serveur sert aussi le front compilé : un seul processus,
  // une seule origine, pas de configuration CORS à gérer au déploiement.
  if (fs.existsSync(webDistDir)) {
    app.use(express.static(webDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDistDir, 'index.html'));
    });
  }

  app.use(errorMiddleware);
  return app;
}
