import fs from 'node:fs';
import { ensureDataDirs, port, webDistDir } from './config.js';
import { seedIfEmpty } from './db/seed.js';
import { createApp } from './app.js';
import { shutdownOcr } from './extract/ocr.js';

ensureDataDirs();
seedIfEmpty();

const server = createApp().listen(port, () => {
  console.log(`API prête sur http://localhost:${port}`);
  if (!fs.existsSync(webDistDir)) {
    console.log("Front non compilé : lancez « npm run dev » à la racine pour le mode développement.");
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} reçu, arrêt en cours…`);
  server.close();
  await shutdownOcr();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
