import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Known domain errors
  if (error instanceof AppError) {
    request.log.warn({ err: error }, error.message);
    reply.status(error.statusCode).send({
      data: null,
      error: { code: error.code, message: error.message },
      meta: null,
    });
    return;
  }

  // Fastify validation errors (JSON Schema)
  if (error.validation) {
    request.log.warn({ err: error }, 'validation error');
    reply.status(400).send({
      data: null,
      error: {
        code: 'validation_error',
        message: error.message,
        details: error.validation,
      },
      meta: null,
    });
    return;
  }

  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    request.log.warn({ err: error }, error.message);
    reply.status(error.statusCode).send({
      data: null,
      error: {
        code: 'request_error',
        message: error.message,
      },
      meta: null,
    });
    return;
  }

  // Unknown errors — log full, return generic
  request.log.error({ err: error }, 'unhandled error');
  reply.status(500).send({
    data: null,
    error: { code: 'internal_error', message: 'Internal server error' },
    meta: null,
  });
}
