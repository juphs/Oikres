class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; }
}
class ValidationError extends Error {
  constructor(errors, message) { super(message || 'Please check the form.'); this.errors = errors; }
}
module.exports = { HttpError, ValidationError };
