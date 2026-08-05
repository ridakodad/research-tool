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

/*
 * Échecs de démarrage.
 *
 * Sans cette écoute, Node affiche une trace de pile de vingt lignes pour un
 * problème que l'utilisateur peut régler en dix secondes. Cette application
 * s'adresse à des chercheurs, pas à des développeurs : elle doit dire ce qui
 * bloque et quoi faire.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\nLe port ${port} est déjà occupé.\n\n` +
        `C'est presque toujours une instance de cette application restée ouverte\n` +
        `dans une autre fenêtre. Deux options :\n\n` +
        `  • Fermez l'autre fenêtre (Ctrl+C y suffit), puis relancez « npm start ».\n` +
        `  • Ou démarrez sur un autre port, sans rien fermer :\n` +
        `        Windows  :  $env:PORT=4100; npm start\n` +
        `        macOS/Linux :  PORT=4100 npm start\n`,
    );
  } else if (error.code === 'EACCES') {
    console.error(
      `\nLe port ${port} est réservé par le système.\n` +
        `Choisissez un port au-dessus de 1024, par exemple PORT=4100.\n`,
    );
  } else {
    console.error(`\nDémarrage impossible : ${error.message}\n`);
  }
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} reçu, arrêt en cours…`);
  server.close();
  await shutdownOcr();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
