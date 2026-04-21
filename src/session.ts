/**
 * Session bootstrap flows, wait helpers, and connect-with-retries.
 */

import type { Client } from './client.js';
import type { Config } from './config.js';
import { defaultConfig } from './config.js';
import {
  newNewThreadMessage,
  newResumeThreadMessage,
  newSubscribeThreadMessage,
  type DecodedMessage,
  type StatusResponse,
  type ErrorResponse,
} from './protocol.js';

// ---------------------------------------------------------------------------
// Bootstrap flows
// ---------------------------------------------------------------------------

/** Runs the daemon ready → new_thread → subscribe_thread flow, returning the thread ID. */
export async function bootstrapNewThreadSession(
  client: Client,
  _eventStream: AsyncIterable<DecodedMessage>,
  workspace: string,
  config?: Config,
): Promise<string> {
  const cfg = config ?? defaultConfig();

  // Step 1: daemon_ready handshake
  await client.sendMessage({ type: 'daemon_ready' });
  await waitDaemonReady(client, cfg.daemonReadyTimeout);

  // Step 2: new_thread
  await client.sendMessage(newNewThreadMessage(workspace));
  const status = await waitThreadStatusWithID(client, cfg.threadStatusTimeout);
  const tid = status.thread_id;
  if (!tid) {
    throw new Error('empty thread_id in status response');
  }

  // Step 3: subscribe_thread
  await client.sendMessage(newSubscribeThreadMessage(tid, cfg.verbosityLevel));
  await waitSubscriptionConfirmed(client, tid, cfg.verbosityLevel, cfg.subscriptionTimeout);

  return tid;
}

/** Runs the daemon ready → resume_thread → subscribe_thread flow, returning the thread ID. */
export async function bootstrapResumeThreadSession(
  client: Client,
  _eventStream: AsyncIterable<DecodedMessage>,
  threadID: string,
  workspace: string,
  config?: Config,
): Promise<string> {
  const cfg = config ?? defaultConfig();

  // Step 1: daemon_ready handshake
  await client.sendMessage({ type: 'daemon_ready' });
  await waitDaemonReady(client, cfg.daemonReadyTimeout);

  // Step 2: resume_thread
  await client.sendMessage(newResumeThreadMessage(threadID, workspace));
  const status = await waitThreadStatusWithID(client, cfg.threadStatusTimeout);
  const tid = status.thread_id;
  if (!tid) {
    throw new Error('empty thread_id in status response');
  }

  // Step 3: subscribe_thread
  await client.sendMessage(newSubscribeThreadMessage(tid, cfg.verbosityLevel));
  await waitSubscriptionConfirmed(client, tid, cfg.verbosityLevel, cfg.subscriptionTimeout);

  return tid;
}

// ---------------------------------------------------------------------------
// Wait helpers (use client's readEventWithTimeout internally)
// ---------------------------------------------------------------------------

/** Blocks until a daemon_ready message with state == "ready". */
export async function waitDaemonReady(
  client: Client,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = await client.readEventWithTimeout(remaining) as Record<string, unknown> | null;
    if (ev === null) break;
    if (ev.type === 'daemon_ready') {
      if (ev.state === 'ready') return;
      throw new Error(`daemon not ready: state=${JSON.stringify(ev.state)} message=${JSON.stringify(ev.message ?? '')}`);
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for daemon_ready (state=ready)`);
}

/** Also supports consuming from an AsyncIterable<DecodedMessage> for backward compatibility. */
export async function waitDaemonReadyFromStream(
  eventStream: AsyncIterable<DecodedMessage>,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for await (const msg of eventStream) {
    if (msg && typeof msg === 'object') {
      const m = msg as Record<string, unknown>;
      if (m.type === 'daemon_ready') {
        if (m.state === 'ready') return;
        throw new Error(`daemon not ready: state=${JSON.stringify(m.state)} message=${JSON.stringify(m.message ?? '')}`);
      }
    }
    if (Date.now() >= deadline) break;
  }
  throw new Error(`timeout after ${timeout}ms waiting for daemon_ready (state=ready)`);
}

/** Waits for type status with non-empty thread_id. */
export async function waitThreadStatusWithID(
  client: Client,
  timeout: number,
): Promise<StatusResponse> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = await client.readEventWithTimeout(remaining) as Record<string, unknown> | null;
    if (ev === null) break;

    // Check for error response
    if (ev.type === 'error') {
      const errResp = ev as unknown as ErrorResponse;
      throw new Error(`daemon error: ${errResp.code}: ${errResp.message}`);
    }

    // Check for status response
    if (ev.type === 'status') {
      const status = ev as unknown as StatusResponse;
      if (status.thread_id && status.thread_id !== '') {
        return status;
      }
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for status with thread_id`);
}

/** Waits for subscription_confirmed matching thread_id. */
export async function waitSubscriptionConfirmed(
  client: Client,
  wantThreadID: string,
  _wantVerbosity: string,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = await client.readEventWithTimeout(remaining) as Record<string, unknown> | null;
    if (ev === null) break;
    if (ev.type === 'subscription_confirmed' && ev.thread_id === wantThreadID) {
      return;
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for subscription_confirmed`);
}

// ---------------------------------------------------------------------------
// Connect with retries
// ---------------------------------------------------------------------------

/** Attempts to connect to the Soothe daemon with bounded retries. */
export async function connectWithRetries(
  client: Client,
  maxRetries?: number,
  retryDelay?: number,
): Promise<void> {
  const retries = maxRetries && maxRetries > 0 ? maxRetries : 40;
  const delay = retryDelay && retryDelay > 0 ? retryDelay : 250;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(`failed to connect after ${retries} attempts: ${lastErr?.message ?? 'unknown error'}`);
}
