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
import { LlmError, extractWithLlm, type LlmUsage } from './llm.js';

/**
 * Mode d'extraction.
 *
 * - `rules` : moteur de règles seul. Déterministe, gratuit, reproductible.
 * - `llm`   : Claude seul. Traite le texte rédigé, où aucun libellé n'annonce
 *             la valeur.
 * - `hybrid`: les règles d'abord, Claude uniquement sur ce qu'elles n'ont pas
 *             trouvé. Conserve le déterminisme là où il est possible et
 *             réduit le volume soumis au modèle.
 */
export type ExtractionMode = 'rules' | 'llm' | 'hybrid';

export interface FieldOutcome {
  fieldId: number;
  key: string;
  label: string;
  status: 'extracted' | 'not-found' | 'kept-manual' | 'disabled';
  /** Origine de la valeur retenue. */
  by: 'rules' | 'llm' | null;
  confidence: number | null;
}

export interface PatientExtractionReport {
  patientId: number;
  patientCode: string;
  documentCount: number;
  extracted: number;
  notFound: number;
  keptManual: number;
  /** Valeurs proposées par le modèle puis écartées faute de justification. */
  unverified: number;
  /** Valeurs proposées par le modèle puis écartées car incompatibles avec la fiche. */
  invalid: number;
  /** Message d'erreur si l'appel au modèle a échoué pour ce dossier. */
  llmError: string | null;
  usage: LlmUsage | null;
  fields: FieldOutcome[];
}

export interface RunOptions {
  mode?: ExtractionMode;
  overwriteManual?: boolean;
}

/**
 * Applique la fiche d'exploitation aux documents d'un patient.
 *
 * Les valeurs corrigées à la main sont préservées : relancer l'extraction
 * après une mise à jour de la fiche ne détruit jamais le travail de relecture.
 * `overwriteManual` permet de forcer la réécriture complète.
 */
export async function runExtractionForPatient(
  template: TemplateWithFields,
  patient: { id: number; code: string },
  options: RunOptions = {},
): Promise<PatientExtractionReport> {
  const mode = options.mode ?? 'rules';
  const record = ensureRecord(template.id, patient.id);
  const protectedFields = options.overwriteManual ? new Set<number>() : manualFieldIds(record.id);
  const docs = loadSourceDocs(patient.id);

  const values: ValueInput[] = [];
  const outcomes = new Map<number, FieldOutcome>();
  /** Variables encore à pourvoir après le passage des règles. */
  const remaining: typeof template.fields = [];

  for (const field of template.fields) {
    if (protectedFields.has(field.id)) {
      outcomes.set(field.id, outcome(field, 'kept-manual', null, null));
      continue;
    }

    const rulesApply = mode !== 'llm' && field.extraction.enabled && field.extraction.rules.length > 0;
    const hit = rulesApply ? extractField(field, docs) : null;

    if (hit) {
      values.push({
        fieldId: field.id,
        value: hit.value,
        source: 'auto',
        confidence: hit.confidence,
        evidence: hit.evidence,
      });
      outcomes.set(field.id, outcome(field, 'extracted', 'rules', hit.confidence));
      continue;
    }

    if (mode === 'rules') {
      const status = field.extraction.enabled && field.extraction.rules.length > 0 ? 'not-found' : 'disabled';
      outcomes.set(field.id, outcome(field, status, null, null));
    } else {
      // Soumise au modèle : le statut définitif dépend de sa réponse.
      remaining.push(field);
      outcomes.set(field.id, outcome(field, 'not-found', null, null));
    }
  }

  let unverified = 0;
  let invalid = 0;
  let llmError: string | null = null;
  let usage: LlmUsage | null = null;

  if (mode !== 'rules' && remaining.length > 0) {
    try {
      const result = await extractWithLlm(remaining, docs, patient.code, template.name);
      usage = result.usage;
      unverified = result.unverified.length;
      invalid = result.invalid.length;

      for (const found of result.values) {
        values.push({
          fieldId: found.fieldId,
          value: found.value,
          source: 'llm',
          confidence: found.confidence,
          evidence: found.evidence,
        });
        const field = remaining.find((f) => f.id === found.fieldId)!;
        outcomes.set(field.id, outcome(field, 'extracted', 'llm', found.confidence));
      }
    } catch (error) {
      // L'échec du modèle sur un dossier ne doit pas annuler ce que les
      // règles ont déjà trouvé, ni interrompre la passe sur les suivants.
      llmError = error instanceof LlmError ? error.message : String(error);
    }
  }

  // On repart d'une table propre côté automatique pour qu'une variable qui
  // n'est plus trouvée ne conserve pas silencieusement son ancienne valeur.
  clearAutoValues(record.id);
  setValues(record.id, values);
  markExtracted(record.id);

  const fields = template.fields.map((f) => outcomes.get(f.id)!);

  return {
    patientId: patient.id,
    patientCode: patient.code,
    documentCount: docs.length,
    extracted: fields.filter((o) => o.status === 'extracted').length,
    notFound: fields.filter((o) => o.status === 'not-found').length,
    keptManual: fields.filter((o) => o.status === 'kept-manual').length,
    unverified,
    invalid,
    llmError,
    usage,
    fields,
  };
}

function outcome(
  field: { id: number; key: string; label: string },
  status: FieldOutcome['status'],
  by: FieldOutcome['by'],
  confidence: number | null,
): FieldOutcome {
  return { fieldId: field.id, key: field.key, label: field.label, status, by, confidence };
}
