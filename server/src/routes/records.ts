import { Router } from 'express';
import { asyncHandler, badRequest, intQuery, notFound } from '../lib/http.js';
import { extractionRunSchema, valueUpdateSchema } from '../lib/schemas.js';
import { getActiveTemplate, getTemplate } from '../repo/templates.js';
import { getPatient, listPatients } from '../repo/patients.js';
import { ensureRecord, setValues, type ValueInput } from '../repo/records.js';
import { runExtractionForPatient, type PatientExtractionReport } from '../engine/run.js';
import type { FieldValue, TemplateField, TemplateWithFields } from '../domain/types.js';

export const recordsRouter = Router();

function resolveTemplate(id: number | null): TemplateWithFields {
  const template = id ? getTemplate(id) : getActiveTemplate();
  if (!template) throw notFound("Aucune fiche d'exploitation disponible.");
  return template;
}

/** Fiche remplie d'un patient, avec le modèle et les documents disponibles. */
recordsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const patientId = intQuery(req, 'patientId');
    if (!patientId) throw badRequest('Paramètre « patientId » requis.');
    const patient = getPatient(patientId);
    if (!patient) throw notFound('Dossier patient introuvable.');

    const template = resolveTemplate(intQuery(req, 'templateId'));
    res.json({ template, patient, record: ensureRecord(template.id, patientId) });
  }),
);

/**
 * Enregistre des valeurs saisies ou corrigées à la main.
 * Ces valeurs sont marquées `manual` et survivent aux extractions suivantes.
 */
recordsRouter.put(
  '/:templateId/:patientId/values',
  asyncHandler(async (req, res) => {
    const templateId = Number(req.params.templateId);
    const patientId = Number(req.params.patientId);
    if (!Number.isInteger(templateId) || !Number.isInteger(patientId)) {
      throw badRequest('Identifiants invalides.');
    }

    const template = getTemplate(templateId);
    if (!template) throw notFound("Fiche d'exploitation introuvable.");
    if (!getPatient(patientId)) throw notFound('Dossier patient introuvable.');

    const { values } = valueUpdateSchema.parse(req.body);
    const byId = new Map(template.fields.map((f) => [f.id, f]));

    const inputs: ValueInput[] = values.map(({ fieldId, value }) => {
      const field = byId.get(fieldId);
      if (!field) throw badRequest(`Variable ${fieldId} absente de cette fiche.`);
      return {
        fieldId,
        value: validateManualValue(field, value),
        // Une valeur effacée redevient « vide » et pourra être re-extraite.
        source: value === null || value === '' ? 'empty' : 'manual',
        confidence: null,
        evidence: null,
      };
    });

    const record = ensureRecord(templateId, patientId);
    setValues(record.id, inputs);
    res.json({ record: ensureRecord(templateId, patientId) });
  }),
);

/**
 * Lance l'extraction automatique.
 * Sans `patientIds`, la passe couvre l'ensemble des dossiers.
 */
recordsRouter.post(
  '/extraction/run',
  asyncHandler(async (req, res) => {
    const input = extractionRunSchema.parse(req.body ?? {});
    const template = resolveTemplate(input.templateId ?? null);

    const targets = input.patientIds
      ? input.patientIds.map((id) => {
          const p = getPatient(id);
          if (!p) throw notFound(`Dossier patient ${id} introuvable.`);
          return p;
        })
      : listPatients();

    if (targets.length === 0) throw badRequest('Aucun dossier patient à traiter.');

    const reports: PatientExtractionReport[] = targets.map((patient) =>
      runExtractionForPatient(template, patient, { overwriteManual: input.overwriteManual }),
    );

    res.json({
      templateId: template.id,
      patientsProcessed: reports.length,
      totals: {
        extracted: reports.reduce((s, r) => s + r.extracted, 0),
        notFound: reports.reduce((s, r) => s + r.notFound, 0),
        keptManual: reports.reduce((s, r) => s + r.keptManual, 0),
      },
      reports,
    });
  }),
);

/**
 * Contrôle qu'une valeur saisie manuellement respecte le type déclaré.
 * La saisie manuelle fait autorité : on n'essaie pas de la « corriger »,
 * on refuse ce qui est incohérent.
 */
function validateManualValue(field: TemplateField, value: FieldValue): FieldValue {
  if (value === null || value === '') return null;

  switch (field.type) {
    case 'text':
      return String(value);

    case 'number':
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) {
        throw badRequest(`« ${field.label} » attend un nombre.`);
      }
      return field.type === 'integer' ? Math.round(n) : n;
    }

    case 'date': {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw badRequest(`« ${field.label} » attend une date au format AAAA-MM-JJ.`);
      }
      return s;
    }

    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).toLowerCase();
      if (['true', 'oui', '1'].includes(s)) return true;
      if (['false', 'non', '0'].includes(s)) return false;
      throw badRequest(`« ${field.label} » attend Oui ou Non.`);
    }

    case 'enum': {
      const s = String(value);
      if (!field.options.includes(s)) {
        throw badRequest(`« ${s} » n'est pas une option de « ${field.label} ».`);
      }
      return s;
    }

    case 'multi': {
      const list = Array.isArray(value) ? value.map(String) : [String(value)];
      const invalid = list.filter((v) => !field.options.includes(v));
      if (invalid.length > 0) {
        throw badRequest(
          `Options inconnues pour « ${field.label} » : ${invalid.join(', ')}.`,
        );
      }
      return list;
    }

    default:
      return value;
  }
}
