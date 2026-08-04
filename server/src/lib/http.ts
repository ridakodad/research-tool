import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

/** Erreur applicative portant un code HTTP. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (msg: string) => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);

/** Enveloppe un handler asynchrone pour router les rejets vers le middleware d'erreur. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Lit un paramètre d'URL entier, en refusant les valeurs non numériques. */
export function intParam(req: Request, name: string): number {
  const raw = req.params[name];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`Paramètre « ${name} » invalide : ${String(raw)}`);
  }
  return n;
}

export function intQuery(req: Request, name: string): number | null {
  const raw = req.query[name];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Paramètre « ${name} » invalide.`);
  return n;
}

/** Middleware d'erreur : réponses JSON homogènes, messages en français. */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Données invalides.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
    return;
  }
  // Contrainte d'unicité SQLite : message compréhensible plutôt qu'une 500.
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'Cet enregistrement existe déjà.', details: message });
    return;
  }
  console.error('[erreur non gérée]', err);
  res.status(500).json({ error: 'Erreur interne du serveur.', details: message });
}
