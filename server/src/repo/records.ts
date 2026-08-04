import { db, nowIso, parseJson } from '../db/index.js';
import type { Evidence, FieldValue, PatientRecord, RecordValue, ValueSource } from '../domain/types.js';

interface RecordRow {
  id: number;
  template_id: number;
  patient_id: number;
  last_extraction_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ValueRow {
  record_id: number;
  field_id: number;
  value: string | null;
  source: string;
  confidence: number | null;
  evidence: string | null;
  updated_at: string;
}

function toValue(row: ValueRow): RecordValue {
  return {
    fieldId: row.field_id,
    value: parseJson<FieldValue>(row.value, null),
    source: row.source as ValueSource,
    confidence: row.confidence,
    evidence: row.evidence ? parseJson<Evidence | null>(row.evidence, null) : null,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: RecordRow, values: RecordValue[]): PatientRecord {
  return {
    id: row.id,
    templateId: row.template_id,
    patientId: row.patient_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastExtractionAt: row.last_extraction_at,
    values,
  };
}

/** Récupère la fiche remplie d'un patient, en la créant au besoin. */
export function ensureRecord(templateId: number, patientId: number): PatientRecord {
  const existing = db
    .prepare('SELECT * FROM records WHERE template_id = ? AND patient_id = ?')
    .get(templateId, patientId) as RecordRow | undefined;

  if (existing) return toRecord(existing, listValues(existing.id));

  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO records (template_id, patient_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(templateId, patientId, ts, ts);
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(info.lastInsertRowid)) as RecordRow;
  return toRecord(row, []);
}

export function getRecord(templateId: number, patientId: number): PatientRecord | null {
  const row = db
    .prepare('SELECT * FROM records WHERE template_id = ? AND patient_id = ?')
    .get(templateId, patientId) as RecordRow | undefined;
  return row ? toRecord(row, listValues(row.id)) : null;
}

export function listValues(recordId: number): RecordValue[] {
  const rows = db.prepare('SELECT * FROM record_values WHERE record_id = ?').all(recordId) as ValueRow[];
  return rows.map(toValue);
}

export interface ValueInput {
  fieldId: number;
  value: FieldValue;
  source: ValueSource;
  confidence?: number | null;
  evidence?: Evidence | null;
}

const upsertValueStmt = db.prepare(
  `INSERT INTO record_values (record_id, field_id, value, source, confidence, evidence, updated_at)
   VALUES (@recordId, @fieldId, @value, @source, @confidence, @evidence, @updatedAt)
   ON CONFLICT(record_id, field_id) DO UPDATE SET
     value = excluded.value,
     source = excluded.source,
     confidence = excluded.confidence,
     evidence = excluded.evidence,
     updated_at = excluded.updated_at`,
);

export const setValues = db.transaction((recordId: number, values: ValueInput[]): void => {
  const ts = nowIso();
  for (const v of values) {
    upsertValueStmt.run({
      recordId,
      fieldId: v.fieldId,
      value: v.value === null ? null : JSON.stringify(v.value),
      source: v.source,
      confidence: v.confidence ?? null,
      evidence: v.evidence ? JSON.stringify(v.evidence) : null,
      updatedAt: ts,
    });
  }
  db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(ts, recordId);
});

export function markExtracted(recordId: number): void {
  const ts = nowIso();
  db.prepare('UPDATE records SET last_extraction_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, recordId);
}

/** Identifiants des variables dont la valeur a été saisie ou corrigée à la main. */
export function manualFieldIds(recordId: number): Set<number> {
  const rows = db
    .prepare(`SELECT field_id FROM record_values WHERE record_id = ? AND source = 'manual'`)
    .all(recordId) as { field_id: number }[];
  return new Set(rows.map((r) => r.field_id));
}

/** Efface les valeurs issues de l'extraction automatique, en gardant les saisies manuelles. */
export function clearAutoValues(recordId: number): void {
  db.prepare(`DELETE FROM record_values WHERE record_id = ? AND source <> 'manual'`).run(recordId);
}

/** Toutes les fiches remplies d'un modèle, pour les résultats et l'export. */
export function listRecordsForTemplate(templateId: number): PatientRecord[] {
  const rows = db
    .prepare('SELECT * FROM records WHERE template_id = ? ORDER BY patient_id')
    .all(templateId) as RecordRow[];
  return rows.map((row) => toRecord(row, listValues(row.id)));
}
