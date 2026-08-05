/**
 * Types de l'API.
 * Miroir de `server/src/domain/types.ts` : toute évolution doit être reportée
 * des deux côtés.
 */

export type DocKind = 'pdf' | 'docx' | 'image' | 'dicom' | 'text' | 'unknown';

export type FieldType = 'text' | 'number' | 'integer' | 'date' | 'boolean' | 'enum' | 'multi';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texte libre',
  number: 'Nombre',
  integer: 'Nombre entier',
  date: 'Date',
  boolean: 'Oui / Non',
  enum: 'Choix unique',
  multi: 'Choix multiple',
};

export type RuleSource = 'text' | 'dicom' | 'filename';
export type FieldValue = string | number | boolean | string[] | null;

export interface LabelRule {
  kind: 'label';
  labels: string[];
  maxLength?: number;
  source?: RuleSource;
  docKinds?: DocKind[];
  confidence?: number;
}
export interface RegexRule {
  kind: 'regex';
  pattern: string;
  flags?: string;
  group?: number;
  source?: RuleSource;
  docKinds?: DocKind[];
  confidence?: number;
}
export interface KeywordRule {
  kind: 'keyword';
  any: string[];
  none?: string[];
  noneWindow?: number;
  emit: FieldValue;
  emitIfNegated?: FieldValue;
  source?: RuleSource;
  docKinds?: DocKind[];
  confidence?: number;
}
export interface DicomRule {
  kind: 'dicom';
  tag: string;
  confidence?: number;
}
export type ExtractionRule = LabelRule | RegexRule | KeywordRule | DicomRule;

export interface FieldPostProcess {
  valueMap?: Record<string, string>;
  scale?: number;
  min?: number;
  max?: number;
}

export interface FieldExtraction {
  enabled: boolean;
  rules: ExtractionRule[];
  postProcess?: FieldPostProcess;
}

export interface TemplateField {
  id: number;
  templateId: number;
  key: string;
  label: string;
  type: FieldType;
  section: string;
  unit: string | null;
  description: string | null;
  required: boolean;
  options: string[];
  position: number;
  extraction: FieldExtraction;
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateWithFields extends Template {
  fields: TemplateField[];
}

export interface Patient {
  id: number;
  code: string;
  label: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientSummary extends Patient {
  documentCount: number;
  unreadableCount: number;
}

export interface DocumentMeta {
  id: number;
  patientId: number;
  filename: string;
  kind: DocKind;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
  parseStatus: 'pending' | 'ok' | 'error' | 'empty';
  /** Le serveur accepte-t-il d'afficher ce document dans la page ? */
  previewable: boolean;
  parseError: string | null;
  textLength: number;
  metadata: Record<string, unknown>;
}

export interface Evidence {
  documentId: number;
  documentName: string;
  snippet: string;
  start: number;
  end: number;
  rule: string;
}

/** Origine d'une valeur : règle, modèle de langage, saisie manuelle, ou absente. */
export type ValueSource = 'auto' | 'llm' | 'manual' | 'empty';

export interface RecordValue {
  fieldId: number;
  value: FieldValue;
  source: ValueSource;
  confidence: number | null;
  evidence: Evidence | null;
  updatedAt: string;
}

export interface PatientRecord {
  id: number;
  templateId: number;
  patientId: number;
  createdAt: string;
  updatedAt: string;
  lastExtractionAt: string | null;
  values: RecordValue[];
}

export interface UploadOutcome {
  filename: string;
  status: 'imported' | 'duplicate' | 'error';
  documentId?: number;
  kind?: string;
  textLength?: number;
  message?: string;
}

export interface UploadResponse {
  results: UploadOutcome[];
  documents: DocumentMeta[];
  summary: { imported: number; duplicates: number; errors: number };
}

export interface DatasetRow {
  patientId: number;
  patientCode: string;
  patientLabel: string | null;
  documentCount: number;
  values: Record<string, FieldValue>;
  sources: Record<string, ValueSource>;
  confidences: Record<string, number | null>;
  filled: number;
}

export interface NumericSummary {
  n: number; mean: number; sd: number;
  min: number; q1: number; median: number; q3: number; max: number;
}
export interface HistogramBin { label: string; from: number; to: number; count: number }
export interface CategoryCount { label: string; count: number; percent: number }

interface FieldStatsBase {
  key: string;
  label: string;
  type: FieldType;
  unit: string | null;
  section: string;
  n: number;
  missing: number;
}
export type FieldStats =
  | (FieldStatsBase & { chart: 'histogram'; summary: NumericSummary | null; bins: HistogramBin[] })
  | (FieldStatsBase & { chart: 'categories'; categories: CategoryCount[] })
  | (FieldStatsBase & { chart: 'none'; topValues: CategoryCount[] });

export interface CompletenessField {
  key: string; label: string; section: string; required: boolean;
  auto: number; llm: number; manual: number; empty: number; rate: number;
}

/** Moteur employé pour une passe d'extraction. */
export type ExtractionMode = 'rules' | 'llm' | 'hybrid';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ExtractionReport {
  patientId: number;
  patientCode: string;
  documentCount: number;
  extracted: number;
  notFound: number;
  keptManual: number;
  unverified: number;
  invalid: number;
  llmError: string | null;
  usage: LlmUsage | null;
  fields: {
    fieldId: number;
    key: string;
    label: string;
    status: 'extracted' | 'not-found' | 'kept-manual' | 'disabled';
    by: 'rules' | 'llm' | null;
    confidence: number | null;
  }[];
}

export interface ExtractionRunResult {
  templateId: number;
  mode: ExtractionMode;
  patientsProcessed: number;
  totals: {
    extracted: number;
    notFound: number;
    keptManual: number;
    unverified: number;
    invalid: number;
  };
  usage: LlmUsage | null;
  errors: { patientCode: string; message: string }[];
  reports: ExtractionReport[];
}

export interface RuleTestResult {
  found: boolean;
  value: FieldValue;
  confidence: number | null;
  evidence: Evidence | null;
  documentsTested: number;
}

export interface Capabilities {
  ocr: { available: boolean; lang: string; reason: string | null };
  llm: { available: boolean; model: string; effort: string; reason: string | null };
  maxUploadBytes: number;
}

/* ----------------------------------------------- rendement de l'extraction */

/** Un fichier du dossier, et les variables qu'il a permis de renseigner. */
export interface ExtractionDocument {
  documentId: number;
  filename: string;
  kind: DocKind;
  parseStatus: 'pending' | 'ok' | 'error' | 'empty';
  textLength: number;
  /** Libellés des variables justifiées par ce document. Vide = n'a rien produit. */
  fields: string[];
}

export interface ExtractionRow {
  patientId: number;
  patientCode: string;
  patientLabel: string | null;
  lastExtractionAt: string | null;
  filled: number;
  total: number;
  bySource: { auto: number; llm: number; manual: number };
  /** Valeurs renseignées sans document justificatif : saisies à la main. */
  sansJustification: number;
  documents: ExtractionDocument[];
}

export interface ExtractionOverview {
  template: TemplateWithFields;
  rows: ExtractionRow[];
  summary: {
    patients: number;
    emptyPatients: number;
    barrenDocuments: number;
    documents: number;
  };
}
