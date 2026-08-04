import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { dbPath, ensureDataDirs } from '../config.js';
import { SCHEMA } from './schema.js';

/**
 * Couche base de données, adossée au module SQLite intégré à Node.
 *
 * Aucune dépendance native n'est utilisée : les modules compilés
 * (`better-sqlite3` et consorts) exigent une chaîne de compilation C++ dès
 * qu'aucun binaire précompilé ne correspond à la version de Node installée —
 * ce qui bloque l'installation sous Windows en réclamant Visual Studio.
 * `node:sqlite` supprime ce problème sur toutes les plateformes.
 *
 * L'adaptateur ci-dessous expose la surface minimale utilisée par les dépôts
 * (`prepare`, `exec`, `transaction`, `close`), y compris les transactions que
 * `node:sqlite` ne fournit pas.
 */

ensureDataDirs();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const connection = new DatabaseSync(dbPath);

// WAL : les lectures ne bloquent pas l'écriture pendant l'import de documents.
connection.exec('PRAGMA journal_mode = WAL');
connection.exec('PRAGMA foreign_keys = ON');

connection.exec(SCHEMA);

/** Résultat d'une écriture. */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** Requête préparée. Les valeurs sortent en `unknown` : les dépôts les typent. */
export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Profondeur de transaction, pour imbriquer via SAVEPOINT sans conflit. */
let depth = 0;

export const db = {
  prepare(sql: string): Statement {
    return connection.prepare(sql) as unknown as Statement;
  },

  exec(sql: string): void {
    connection.exec(sql);
  },

  /**
   * Enveloppe une fonction dans une transaction et renvoie une fonction de
   * même signature — reprend le comportement attendu par les dépôts.
   *
   * Les appels imbriqués utilisent un point de sauvegarde : une transaction
   * interne qui échoue n'annule que sa propre portion.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const level = depth++;
      const savepoint = `sp_${level}`;
      connection.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      try {
        const result = fn(...args);
        connection.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        // Une annulation qui échoue ne doit pas masquer l'erreur d'origine.
        try {
          connection.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
        } catch {
          /* connexion déjà interrompue */
        }
        throw error;
      } finally {
        depth = level;
      }
    };
  },

  close(): void {
    connection.close();
  },
};

export function nowIso(): string {
  return new Date().toISOString();
}

/** Parse une colonne JSON en tolérant les valeurs nulles ou corrompues. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
