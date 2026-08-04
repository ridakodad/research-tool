import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { dbPath, ensureDataDirs } from '../config.js';
import { SCHEMA } from './schema.js';

ensureDataDirs();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(SCHEMA);

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
