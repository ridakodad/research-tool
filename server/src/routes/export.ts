import { Router } from 'express';
import { asyncHandler, intQuery, notFound } from '../lib/http.js';
import { getActiveTemplate, getTemplate } from '../repo/templates.js';
import { toCsv } from '../lib/csv.js';
import { makeXlsx, type CellValue, type Sheet } from '../lib/xlsx.js';
import { summarize } from '../lib/stats.js';
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

/**
 * Export du jeu de données au format classeur.
 *
 * Le CSV reste utile pour R ou SPSS, mais il perd le typage : les dates y
 * deviennent du texte, les décimaux dépendent de la locale, et Excel
 * réinterprète volontiers « 5-10 » en date. Le classeur porte le type de
 * chaque colonne et s'ouvre sans assistant d'importation.
 *
 * Trois feuilles, parce qu'un jeu de données livré seul n'est pas
 * interprétable : les données, le dictionnaire des variables sans lequel les
 * clés ne veulent rien dire, et une synthèse de cohorte qui donne les effectifs
 * et la complétude atteinte.
 */
exportRouter.get(
  '/xlsx',
  asyncHandler(async (req, res) => {
    const template = resolveTemplate(intQuery(req, 'templateId'));
    const rows = buildDataset(template);
    const useLabels = req.query.labels === '1';

    const donnees: Sheet = {
      name: 'Données',
      columns: [
        { header: 'Dossier', width: 16 },
        ...template.fields.map((field) => ({
          header: useLabels
            ? field.label + (field.unit ? ` (${field.unit})` : '')
            : field.key,
          width: 18,
          type:
            field.type === 'date'
              ? ('date' as const)
              : field.type === 'number' || field.type === 'integer'
                ? ('number' as const)
                : ('text' as const),
        })),
      ],
      rows: rows.map((row) => [
        row.patientCode,
        ...template.fields.map((field): CellValue => {
          const value = row.values[field.key] ?? null;
          if (value === null) return null;
          // Un choix multiple tient dans une colonne, options séparées : la
          // dépliure en colonnes indicatrices relève de l'analyse, pas de
          // l'export.
          if (Array.isArray(value)) return value.join(' | ');
          // Vrai booléen : le tableur affichera VRAI/FAUX et saura le filtrer.
          if (typeof value === 'boolean') return value;
          return value;
        }),
      ]),
    };

    const dictionnaire: Sheet = {
      name: 'Dictionnaire',
      columns: [
        { header: 'Clé', width: 22 },
        { header: 'Libellé', width: 34 },
        { header: 'Section', width: 20 },
        { header: 'Type', width: 14 },
        { header: 'Unité', width: 12 },
        { header: 'Obligatoire', width: 12 },
        { header: 'Options', width: 40 },
        { header: 'Définition', width: 60 },
      ],
      rows: template.fields.map((field) => [
        field.key,
        field.label,
        field.section,
        field.type,
        field.unit,
        field.required,
        field.options.join(' | '),
        field.description,
      ]),
    };

    const renseignees = (key: string): number =>
      rows.filter((row) => {
        const v = row.values[key] ?? null;
        return v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
      }).length;

    const synthese: Sheet = {
      name: 'Synthèse',
      columns: [
        { header: 'Variable', width: 34 },
        { header: 'Type', width: 14 },
        { header: 'Renseignées', width: 13, type: 'number' },
        { header: 'Manquantes', width: 13, type: 'number' },
        { header: 'Complétude %', width: 14, type: 'number' },
        { header: 'Moyenne', width: 12, type: 'number' },
        { header: 'Écart-type', width: 12, type: 'number' },
        { header: 'Médiane', width: 12, type: 'number' },
        { header: 'Minimum', width: 12, type: 'number' },
        { header: 'Maximum', width: 12, type: 'number' },
      ],
      rows: template.fields.map((field): CellValue[] => {
        const n = renseignees(field.key);
        const total = rows.length;
        const base: CellValue[] = [
          field.label + (field.unit ? ` (${field.unit})` : ''),
          field.type,
          n,
          total - n,
          total > 0 ? Math.round((n / total) * 100) : 0,
        ];

        // Les indicateurs de position n'ont de sens que sur du quantitatif.
        if (field.type !== 'number' && field.type !== 'integer') {
          return [...base, null, null, null, null, null];
        }
        const numbers = rows
          .map((row) => row.values[field.key] ?? null)
          .map((v) => (typeof v === 'number' ? v : Number(v)))
          .filter((v) => Number.isFinite(v));
        const stats = summarize(numbers);
        return [
          ...base,
          stats?.mean ?? null,
          stats?.sd ?? null,
          stats?.median ?? null,
          stats?.min ?? null,
          stats?.max ?? null,
        ];
      }),
    };

    const file = makeXlsx([donnees, dictionnaire, synthese]);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slugify(template.name)}.xlsx"`,
    );
    res.send(file);
  }),
);
