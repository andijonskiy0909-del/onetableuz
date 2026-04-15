class AppError extends Error {
  constructor(message, status = 500, data = null) {
    super(message)
    this.status = status
    this.data = data
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }

  static badRequest(msg, data) { return new AppError(msg || 'Bad request', 400, data) }
  static unauthorized(msg) { return new AppError(msg || 'Unauthorized', 401) }
  static forbidden(msg) { return new AppError(msg || 'Forbidden', 403) }
  static notFound(msg) { return new AppError(msg || 'Not found', 404) }
  static conflict(msg) { return new AppError(msg || 'Conflict', 409) }
  static tooMany(msg) { return new AppError(msg || 'Too many requests', 429) }
}

module.exports = AppError
