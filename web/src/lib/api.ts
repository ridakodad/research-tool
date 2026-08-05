import type {
  Capabilities,
  ExtractionMode,
  CompletenessField,
  DatasetRow,
  DocumentMeta,
  ExtractionOverview,
  ExtractionRunResult,
  FieldStats,
  Patient,
  PatientRecord,
  PatientSummary,
  RuleTestResult,
  Template,
  TemplateField,
  TemplateWithFields,
  UploadResponse,
  FieldValue,
} from './types';

/** Erreur d'API portant le message renvoyé par le serveur. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? init.headers
          : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez que l'API est démarrée.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non JSON : on remonte le texte brut comme message d'erreur.
  }

  if (!res.ok) {
    const payload = data as { error?: string; details?: unknown } | null;
    const detailText = formatDetails(payload?.details);
    throw new ApiError(
      res.status,
      (payload?.error ?? `Erreur ${res.status}`) + (detailText ? ` ${detailText}` : ''),
      payload?.details,
    );
  }
  return data as T;
}

/** Met en forme les erreurs de validation renvoyées par le serveur. */
function formatDetails(details: unknown): string {
  if (!Array.isArray(details)) return '';
  const parts = details
    .filter((d): d is { path?: string; message?: string } => typeof d === 'object' && d !== null)
    .map((d) => (d.path ? `${d.path} : ${d.message}` : d.message))
    .filter(Boolean);
  return parts.length > 0 ? `(${parts.join(' ; ')})` : '';
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = (path: string) => request<void>(path, { method: 'DELETE' });

export const api = {
  // ---------------------------------------------------------------- dossiers
  listPatients: () => get<{ patients: PatientSummary[] }>('/patients'),
  getPatient: (id: number) =>
    get<{ patient: Patient; documents: DocumentMeta[] }>(`/patients/${id}`),
  createPatient: (body: { code: string; label?: string | null; notes?: string | null }) =>
    post<{ patient: Patient }>('/patients', body),
  ensurePatient: (code: string) => post<{ patient: Patient }>('/patients/ensure', { code }),
  updatePatient: (id: number, body: { code?: string; label?: string | null; notes?: string | null }) =>
    patch<{ patient: Patient }>(`/patients/${id}`, body),
  deletePatient: (id: number) => del(`/patients/${id}`),

  // --------------------------------------------------------------- documents
  uploadDocuments: async (patientId: number, files: File[]): Promise<UploadResponse> => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    return request<UploadResponse>(`/patients/${patientId}/documents`, {
      method: 'POST',
      body: form,
    });
  },
  getDocumentText: (id: number) => get<{ text: string }>(`/documents/${id}/text`),
  documentFileUrl: (id: number) => `/api/documents/${id}/file`,
  reparseDocument: (id: number) => post<{ document: DocumentMeta }>(`/documents/${id}/reparse`),
  renameDocument: (id: number, filename: string) =>
    patch<{ document: DocumentMeta }>(`/documents/${id}`, { filename }),
  deleteDocument: (id: number) => del(`/documents/${id}`),
  capabilities: () => get<Capabilities>('/documents-capabilities'),

  // ------------------------------------------------------------------ fiches
  listTemplates: () =>
    get<{ templates: Template[]; active: TemplateWithFields | null }>('/templates'),
  getTemplate: (id: number) => get<{ template: TemplateWithFields }>(`/templates/${id}`),
  createTemplate: (body: { name: string; description?: string | null }) =>
    post<{ template: TemplateWithFields }>('/templates', body),
  updateTemplate: (id: number, body: { name?: string; description?: string | null }) =>
    patch<{ template: TemplateWithFields }>(`/templates/${id}`, body),
  activateTemplate: (id: number) => post<{ template: TemplateWithFields }>(`/templates/${id}/activate`),
  duplicateTemplate: (id: number, name?: string) =>
    post<{ template: TemplateWithFields }>(`/templates/${id}/duplicate`, { name }),
  deleteTemplate: (id: number) => del(`/templates/${id}`),
  importTemplate: (payload: unknown) =>
    post<{ template: TemplateWithFields }>('/templates/import', payload),

  createField: (templateId: number, body: Partial<TemplateField>) =>
    post<{ field: TemplateField }>(`/templates/${templateId}/fields`, body),
  updateField: (fieldId: number, body: Partial<TemplateField>) =>
    patch<{ field: TemplateField }>(`/templates/fields/${fieldId}`, body),
  deleteField: (fieldId: number) => del(`/templates/fields/${fieldId}`),
  reorderFields: (templateId: number, fieldIds: number[]) =>
    post<{ template: TemplateWithFields }>(`/templates/${templateId}/fields/reorder`, { fieldIds }),
  testRule: (body: { field: Partial<TemplateField>; patientId?: number; sampleText?: string }) =>
    post<RuleTestResult>('/templates/fields/test', body),

  // ------------------------------------------------------------- extractions
  getRecord: (patientId: number, templateId?: number) =>
    get<{ template: TemplateWithFields; patient: Patient; record: PatientRecord }>(
      `/records?patientId=${patientId}${templateId ? `&templateId=${templateId}` : ''}`,
    ),
  saveValues: (
    templateId: number,
    patientId: number,
    values: { fieldId: number; value: FieldValue }[],
  ) => put<{ record: PatientRecord }>(`/records/${templateId}/${patientId}/values`, { values }),
  runExtraction: (body: {
    templateId?: number;
    patientIds?: number[];
    overwriteManual?: boolean;
    mode?: ExtractionMode;
  }) =>
    post<ExtractionRunResult>('/records/extraction/run', body),

  // --------------------------------------------------------------- résultats
  dataset: (templateId?: number) =>
    get<{
      template: TemplateWithFields;
      rows: DatasetRow[];
      summary: { patients: number; fields: number; completeness: number };
    }>(`/analytics/dataset${templateId ? `?templateId=${templateId}` : ''}`),
  stats: (templateId?: number) =>
    get<{ template: TemplateWithFields; patientCount: number; stats: FieldStats[] }>(
      `/analytics/stats${templateId ? `?templateId=${templateId}` : ''}`,
    ),
  extractionOverview: (templateId?: number) =>
    get<ExtractionOverview>(
      `/analytics/extraction${templateId ? `?templateId=${templateId}` : ''}`,
    ),
  completeness: (templateId?: number) =>
    get<{ patientCount: number; fields: CompletenessField[] }>(
      `/analytics/completeness${templateId ? `?templateId=${templateId}` : ''}`,
    ),

  // ------------------------------------------------------------------ export
  csvUrl: (templateId: number, opts: { delimiter: string; booleans: string; labels: boolean }) =>
    `/api/export/csv?templateId=${templateId}&delimiter=${encodeURIComponent(opts.delimiter)}` +
    `&booleans=${opts.booleans}&labels=${opts.labels ? '1' : '0'}`,
  xlsxUrl: (templateId: number, labels: boolean) =>
    `/api/export/xlsx?templateId=${templateId}&labels=${labels ? '1' : '0'}`,
  pptxUrl: (templateId: number) => `/api/export/pptx?templateId=${templateId}`,
  dictionaryUrl: (templateId: number, delimiter: string) =>
    `/api/export/dictionary.csv?templateId=${templateId}&delimiter=${encodeURIComponent(delimiter)}`,
  templateJsonUrl: (templateId: number) => `/api/export/template.json?templateId=${templateId}`,
};
