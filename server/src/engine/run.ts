import type { TemplateWithFields } from '../domain/types.js';
import { loadSourceDocs } from '../repo/documents.js';
import {
  clearAutoValues,
  ensureRecord,
  manualFieldIds,
  markExtracted,
  setValues,
  type ValueInput,
} from '../repo/records.js';
import { extractField } from './rules.js';

export interface FieldOutcome {
  fieldId: number;
  key: string;
  label: string;
  status: 'extracted' | 'not-found' | 'kept-manual' | 'disabled';
  confidence: number | null;
}

export interface PatientExtractionReport {
  patientId: number;
  patientCode: string;
  documentCount: number;
  extracted: number;
  notFound: number;
  keptManual: number;
  fields: FieldOutcome[];
}

/**
 * Applique la fiche d'exploitation aux documents d'un patient.
 *
 * Les valeurs corrigées à la main sont préservées : relancer l'extraction après
 * une mise à jour de la fiche ne détruit jamais le travail de relecture.
 * `overwriteManual` permet de forcer la réécriture complète.
 */
export function runExtractionForPatient(
  template: TemplateWithFields,
  patient: { id: number; code: string },
  options: { overwriteManual?: boolean } = {},
): PatientExtractionReport {
  const record = ensureRecord(template.id, patient.id);
  const protectedFields = options.overwriteManual ? new Set<number>() : manualFieldIds(record.id);
  const docs = loadSourceDocs(patient.id);

  const values: ValueInput[] = [];
  const outcomes: FieldOutcome[] = [];

  for (const field of template.fields) {
    if (protectedFields.has(field.id)) {
      outcomes.push({
        fieldId: field.id,
        key: field.key,
        label: field.label,
        status: 'kept-manual',
        confidence: null,
      });
      continue;
    }

    if (!field.extraction.enabled || field.extraction.rules.length === 0) {
      outcomes.push({
        fieldId: field.id,
        key: field.key,
        label: field.label,
        status: 'disabled',
        confidence: null,
      });
      continue;
    }

    const hit = extractField(field, docs);
    if (hit) {
      values.push({
        fieldId: field.id,
        value: hit.value,
        source: 'auto',
        confidence: hit.confidence,
        evidence: hit.evidence,
      });
      outcomes.push({
        fieldId: field.id,
        key: field.key,
        label: field.label,
        status: 'extracted',
        confidence: hit.confidence,
      });
    } else {
      outcomes.push({
        fieldId: field.id,
        key: field.key,
        label: field.label,
        status: 'not-found',
        confidence: null,
      });
    }
  }

  // On repart d'une table propre côté automatique pour qu'une variable qui
  // n'est plus trouvée ne conserve pas silencieusement son ancienne valeur.
  clearAutoValues(record.id);
  setValues(record.id, values);
  markExtracted(record.id);

  return {
    patientId: patient.id,
    patientCode: patient.code,
    documentCount: docs.length,
    extracted: outcomes.filter((o) => o.status === 'extracted').length,
    notFound: outcomes.filter((o) => o.status === 'not-found').length,
    keptManual: outcomes.filter((o) => o.status === 'kept-manual').length,
    fields: outcomes,
  };
}
