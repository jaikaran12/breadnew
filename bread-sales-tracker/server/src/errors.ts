import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** An error with an HTTP status and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'bad_request', details);
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, 'conflict', details);
export const forbidden = (message: string, code = 'forbidden') => new HttpError(403, message, code);
export const unauthorized = (message = 'Please log in again', code = 'unauthorized') =>
  new HttpError(401, message, code);

function describeZodError(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Invalid request';
  const field = first.path.join('.');
  return field ? `${field}: ${first.message}` : first.message;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: describeZodError(err), code: 'validation', issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  // Malformed JSON body from express.json()
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON', code: 'bad_json' });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large', code: 'too_large' });
    return;
  }
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.', code: 'server_error' });
};
