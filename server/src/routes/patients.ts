import { Router } from 'express';
import { asyncHandler, intParam, notFound } from '../lib/http.js';
import { patientInputSchema, patientUpdateSchema } from '../lib/schemas.js';
import {
  createPatient,
  deletePatient,
  ensurePatient,
  getPatient,
  listPatients,
  updatePatient,
} from '../repo/patients.js';
import { listDocuments } from '../repo/documents.js';

export const patientsRouter = Router();

patientsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ patients: listPatients() });
  }),
);

patientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = patientInputSchema.parse(req.body);
    res.status(201).json({ patient: createPatient(input) });
  }),
);

/**
 * Renvoie le dossier correspondant au code, en le créant s'il n'existe pas.
 * Utilisé par l'import de dossiers : un sous-dossier importé = un patient.
 */
patientsRouter.post(
  '/ensure',
  asyncHandler(async (req, res) => {
    const { code } = patientInputSchema.pick({ code: true }).parse(req.body);
    res.json({ patient: ensurePatient(code) });
  }),
);

patientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req, 'id');
    const patient = getPatient(id);
    if (!patient) throw notFound('Dossier patient introuvable.');
    res.json({ patient, documents: listDocuments(id) });
  }),
);

patientsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req, 'id');
    const input = patientUpdateSchema.parse(req.body);
    const patient = updatePatient(id, input);
    if (!patient) throw notFound('Dossier patient introuvable.');
    res.json({ patient });
  }),
);

patientsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req, 'id');
    if (!deletePatient(id)) throw notFound('Dossier patient introuvable.');
    res.status(204).end();
  }),
);
