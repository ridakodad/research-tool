/**
 * Schéma SQLite. Exécuté à chaque démarrage : toutes les instructions sont
 * idempotentes (`IF NOT EXISTS`).
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  parse_status  TEXT NOT NULL DEFAULT 'pending',
  parse_error   TEXT,
  text_content  TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents(patient_id);
-- Un même fichier ne peut être importé deux fois pour un même patient.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_dedup ON documents(patient_id, sha256);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  section     TEXT NOT NULL DEFAULT 'Général',
  unit        TEXT,
  description TEXT,
  required    INTEGER NOT NULL DEFAULT 0,
  options     TEXT NOT NULL DEFAULT '[]',
  position    INTEGER NOT NULL DEFAULT 0,
  extraction  TEXT NOT NULL DEFAULT '{"enabled":true,"rules":[]}'
);
CREATE INDEX IF NOT EXISTS idx_fields_template ON fields(template_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fields_key ON fields(template_id, key);

CREATE TABLE IF NOT EXISTS records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id       INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  last_extraction_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique ON records(template_id, patient_id);

CREATE TABLE IF NOT EXISTS record_values (
  record_id  INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_id   INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value      TEXT,
  source     TEXT NOT NULL DEFAULT 'empty',
  confidence REAL,
  evidence   TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (record_id, field_id)
);
`;
