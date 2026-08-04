import { z } from 'zod';
import { FIELD_TYPES } from '../domain/types.js';

const docKind = z.enum(['pdf', 'docx', 'image', 'dicom', 'text', 'unknown']);
const ruleSource = z.enum(['text', 'dicom', 'filename']);
const confidence = z.number().min(0).max(1).optional();

const labelRule = z.object({
  kind: z.literal('label'),
  labels: z.array(z.string().trim().min(1)).min(1, 'Au moins un libellé est requis.'),
  maxLength: z.number().int().min(1).max(500).optional(),
  source: ruleSource.optional(),
  docKinds: z.array(docKind).optional(),
  confidence,
});

const regexRule = z.object({
  kind: z.literal('regex'),
  pattern: z
    .string()
    .min(1)
    .max(500)
    .refine((p) => {
      try {
        new RegExp(p, 'iu');
        return true;
      } catch {
        try {
          new RegExp(p, 'i');
          return true;
        } catch {
          return false;
        }
      }
    }, 'Expression régulière invalide.'),
  flags: z.string().regex(/^[gimsuy]*$/, 'Drapeaux invalides.').optional(),
  group: z.number().int().min(0).max(20).optional(),
  source: ruleSource.optional(),
  docKinds: z.array(docKind).optional(),
  confidence,
});

const fieldValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const keywordRule = z.object({
  kind: z.literal('keyword'),
  any: z.array(z.string().trim().min(1)).min(1, 'Au moins un mot-clé est requis.'),
  none: z.array(z.string().trim().min(1)).optional(),
  noneWindow: z.number().int().min(0).max(500).optional(),
  emit: fieldValue,
  source: ruleSource.optional(),
  docKinds: z.array(docKind).optional(),
  confidence,
});

const dicomRule = z.object({
  kind: z.literal('dicom'),
  tag: z.string().trim().min(1).max(60),
  confidence,
});

export const extractionRuleSchema = z.discriminatedUnion('kind', [
  labelRule,
  regexRule,
  keywordRule,
  dicomRule,
]);

export const fieldExtractionSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(extractionRuleSchema).max(30, 'Trente règles au maximum par variable.'),
  postProcess: z
    .object({
      valueMap: z.record(z.string()).optional(),
      scale: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

/** La clé sert d'en-tête de colonne CSV : on impose un identifiant simple. */
const fieldKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'La clé doit commencer par une lettre minuscule et ne contenir que des lettres, chiffres et « _ ».',
  );

export const fieldInputSchema = z.object({
  key: fieldKey,
  label: z.string().trim().min(1).max(200),
  type: z.enum(FIELD_TYPES as [string, ...string[]]),
  section: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  position: z.number().int().min(0).optional(),
  extraction: fieldExtractionSchema.optional(),
});

export const fieldUpdateSchema = fieldInputSchema.partial();

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const templateUpdateSchema = templateInputSchema.partial();

/** Fiche complète telle que produite par `GET /api/export/template.json`. */
export const templateImportSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  fields: z.array(fieldInputSchema).max(500, 'Cinq cents variables au maximum.'),
});

export const patientInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  label: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const patientUpdateSchema = patientInputSchema.partial();

export const valueUpdateSchema = z.object({
  values: z
    .array(
      z.object({
        fieldId: z.number().int().positive(),
        value: fieldValue,
      }),
    )
    .min(1),
});

export const extractionRunSchema = z.object({
  templateId: z.number().int().positive().optional(),
  /** Restreint la passe à certains dossiers ; sinon tous les patients. */
  patientIds: z.array(z.number().int().positive()).optional(),
  /** Écrase aussi les valeurs corrigées manuellement. */
  overwriteManual: z.boolean().optional(),
});

export const reorderSchema = z.object({
  fieldIds: z.array(z.number().int().positive()),
});

export const testRuleSchema = z.object({
  field: fieldInputSchema,
  patientId: z.number().int().positive().optional(),
  /** Texte libre pour tester une règle sans dossier réel. */
  sampleText: z.string().max(200_000).optional(),
});
