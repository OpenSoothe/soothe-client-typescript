/**
 * Persistence seam for appkit.
 *
 * LoopSessionStore abstracts per-application storage: the session↔loop-id
 * mapping ConnectionPool consults to decide bootstrap vs reattach, and the
 * message rows TurnRunner writes back when a turn completes. Implementations
 * must be safe for concurrent use.
 */

/** Persisted mapping between an application session id and the daemon loop id. */
export interface LoopSessionEntry {
  workspaceID: string;
  sessionID: string;
  loopID: string;
  /** App-defined session type (e.g. "primary" | "ephemeral"). */
  sessionType: string;
  /** Optional app key for ephemeral internal features. */
  purpose?: string;
  isActive: boolean;
  resetCount: number;
  lastUsedAt: number; // epoch ms
}

/** A persisted message row (assistant reply or error). */
export interface SessionMessage {
  id?: string;
  /** "assistant" | "user" | "error". */
  role: string;
  content: string;
  context?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Persistence seam between appkit and the application's storage backend.
 */
export interface LoopSessionStore {
  /** Persisted entry for sessionID, or null if no record exists. */
  getSession(sessionID: string): Promise<LoopSessionEntry | null>;

  /** Persists a new session↔loop mapping. */
  createSession(
    workspaceID: string,
    sessionID: string,
    loopID: string,
    sessionType: string,
  ): Promise<void>;

  /** Stamps the session's last-used timestamp. */
  updateLastUsed(sessionID: string): Promise<void>;

  /** Bumps the reset counter (used to decide fresh bootstrap vs reattach). */
  incrementResetCount(sessionID: string): Promise<void>;

  /**
   * Returns the daemon loop id for sessionID and whether one is on file.
   * ok===false triggers a fresh loop_new bootstrap.
   */
  getLoopIDForSession(sessionID: string): Promise<{ loopID: string; ok: boolean }>;

  /** Writes a message row (assistant reply, error, etc.) for the session. */
  appendMessage(sessionID: string, message: SessionMessage): Promise<void>;
}
