import { Router } from 'express';
import { asyncHandler, intQuery, notFound } from '../lib/http.js';
import { getActiveTemplate, getTemplate } from '../repo/templates.js';
import { toCsv } from '../lib/csv.js';
import { buildDataset } from './analytics.js';
import type { FieldValue, TemplateWithFields } from '../domain/types.js';

export const exportRouter = Router();

function resolveTemplate(id: number | null): TemplateWithFields {
  const template = id ? getTemplate(id) : getActiveTemplate();
  if (!template) throw notFound("Aucune fiche d'exploitation disponible.");
  return template;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'export';
}

/**
 * Export CSV du jeu de données.
 *
 * Options adaptées à l'aval : `delimiter=;` et `booleans=text` pour une
 * relecture dans Excel, `delimiter=,` et `booleans=numeric` pour un import
 * direct dans R, SPSS ou pandas.
 */
exportRouter.get(
  '/csv',
  asyncHandler(async (req, res) => {
    const template = resolveTemplate(intQuery(req, 'templateId'));
    const rows = buildDataset(template);

    const delimiter = req.query.delimiter === ',' ? ',' : ';';
    const booleanAsText = req.query.booleans === 'text';
    // `labels=1` : en-têtes en clair plutôt que les clés techniques.
    const useLabels = req.query.labels === '1';

    const headers = [
      'patient_code',
      'patient_label',
      'nb_documents',
      ...template.fields.map((f) => {
        const base = useLabels ? f.label : f.key;
        return f.unit ? `${base} (${f.unit})` : base;
      }),
    ];

    const data: FieldValue[][] = rows.map((row) => [
      row.patientCode,
      row.patientLabel,
      row.documentCount,
      ...template.fields.map((f) => row.values[f.key] ?? null),
    ]);

    const csv = toCsv(headers, data, { delimiter, booleanAsText });
    const filename = `${slugify(template.name)}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(csv);
  }),
);

/**
 * Export du dictionnaire des variables : indispensable pour documenter
 * la méthodologie et pour que le CSV reste interprétable par un tiers.
 */
exportRouter.get(
  '/dictionary.csv',
  asyncHandler(async (req, res) => {
    const template = resolveTemplate(intQuery(req, 'templateId'));
    const delimiter = req.query.delimiter === ',' ? ',' : ';';

    const headers = ['cle', 'libelle', 'section', 'type', 'unite', 'obligatoire', 'options', 'description'];
    const rows: FieldValue[][] = template.fields.map((f) => [
      f.key,
      f.label,
      f.section,
      f.type,
      f.unit ?? '',
      f.required ? 'oui' : 'non',
      f.options.join(' | '),
      f.description ?? '',
    ]);

    const filename = `dictionnaire-${slugify(template.name)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(headers, rows, { delimiter }));
  }),
);

/** Export JSON de la fiche : sauvegarde et partage du paramétrage entre postes. */
exportRouter.get(
  '/template.json',
  asyncHandler(async (req, res) => {
    const template = resolveTemplate(intQuery(req, 'templateId'));
    const payload = {
      name: template.name,
      description: template.description,
      fields: template.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        section: f.section,
        unit: f.unit,
        description: f.description,
        required: f.required,
        options: f.options,
        extraction: f.extraction,
      })),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fiche-${slugify(template.name)}.json"`,
    );
    res.send(JSON.stringify(payload, null, 2));
  }),
);
