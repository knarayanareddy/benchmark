/** Errors carry the HTTP status the transport should use; the service never imports http. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    Object.assign(this, extra);
  }
}
export class ValidationError extends HttpError { constructor(m, x) { super(400, m, x); } }
export class AuthError extends HttpError { constructor(m = 'authentication required') { super(401, m); } }
export class ForbiddenError extends HttpError { constructor(m = 'not permitted') { super(403, m); } }
export class NotFoundError extends HttpError { constructor(m = 'not found') { super(404, m); } }
export class ConflictError extends HttpError { constructor(m) { super(409, m); } }
