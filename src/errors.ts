/**
 * Custom error types for the Soothe client.
 */

/** Represents a WebSocket connection failure. */
export class ConnectionError extends Error {
  readonly url: string;
  readonly attempt: number;
  readonly cause: Error;

  constructor(url: string, attempt: number, cause: Error) {
    super(`connection error to ${url} (attempt ${attempt}): ${cause.message}`);
    this.name = 'ConnectionError';
    this.url = url;
    this.attempt = attempt;
    this.cause = cause;
  }
}

/** Represents an error reported by the Soothe daemon. */
export class DaemonError extends Error {
  readonly code: string;
  /** The daemon's error message text. */
  readonly daemonMessage: string;

  constructor(code: string, message: string) {
    super(`daemon error [${code}]: ${message}`);
    this.name = 'DaemonError';
    this.code = code;
    this.daemonMessage = message;
  }
}

/** Represents a timeout waiting for a daemon response. */
export class TimeoutError extends Error {
  readonly operation: string;
  readonly duration: string;

  constructor(operation: string, duration: string) {
    super(`timeout after ${duration} waiting for ${operation}`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.duration = duration;
  }
}
