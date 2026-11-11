/** Erros HTTP e middleware central de tratamento. */
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { ConnectorError } from '../connectors/types';
import { createLogger } from '../lib/logger';

const log = createLogger('http');

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Valida o corpo da requisição e lança 400 com detalhes legíveis. */
export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): TypeOf<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'Dados inválidos.', 'validation', result.error.issues);
  }
  return result.data;
}

function statusForConnector(error: ConnectorError): number {
  switch (error.code) {
    case 'config':
    case 'not_found':
      return 422;
    case 'rate_limited':
      return 429;
    case 'blocked':
      return 502;
    default:
      return 502;
  }
}

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos.', code: 'validation', details: error.issues });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }

  // JSON malformado no corpo da requisição.
  if (error instanceof SyntaxError && typeof (error as { status?: unknown }).status === 'number') {
    res.status(400).json({ error: 'JSON inválido no corpo da requisição.', code: 'validation' });
    return;
  }

  if (error instanceof ConnectorError) {
    res.status(statusForConnector(error)).json({ error: error.message, code: error.code });
    return;
  }

  log.error('erro não tratado', error);
  const message = error instanceof Error ? error.message : 'Erro interno.';
  res.status(500).json({ error: message, code: 'internal' });
}
