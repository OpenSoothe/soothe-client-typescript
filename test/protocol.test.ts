import { describe, it, expect } from 'vitest';
import {
  encodeMessage, decodeMessage, splitWirePayload, extractSootheThreadID,
  newInputMessage, newSubscribeThreadMessage, newNewThreadMessage, newResumeThreadMessage,
  newRequestID,
  type InputMessage, type CommandMessage, type SubscribeThreadMessage,
  type NewThreadMessage, type ResumeThreadMessage, type EventMessage,
  type StatusResponse, type DaemonReadyResponse, type ErrorResponse,
  type DaemonStatusResponse, type ShutdownAckResponse, type ThreadListResponse,
  type SkillsListResponse, type ModelsListResponse,
} from '../src/protocol.js';

// ---------------------------------------------------------------------------
// Encode / Decode round-trip tests
// ---------------------------------------------------------------------------

describe('encodeMessage', () => {
  it('appends newline', () => {
    const encoded = encodeMessage({ type: 'input', text: 'hello' });
    expect(encoded.endsWith('\n')).toBe(true);
  });
});

describe('decodeMessage', () => {
  it('returns null for empty input', () => {
    expect(decodeMessage('')).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => decodeMessage('not json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('InputMessage', () => {
    const msg: InputMessage = { request_id: 'r1', type: 'input', text: 'hello world', thread_id: 'thread-abc', autonomous: true };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'input', text: 'hello world', thread_id: 'thread-abc', autonomous: true });
  });

  it('CommandMessage', () => {
    const msg: CommandMessage = { type: 'command', cmd: '/help' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'command', cmd: '/help' });
  });

  it('SubscribeThreadMessage', () => {
    const msg: SubscribeThreadMessage = { request_id: 's1', type: 'subscribe_thread', thread_id: 'tid-1', verbosity: 'detailed' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'subscribe_thread', thread_id: 'tid-1', verbosity: 'detailed' });
  });

  it('NewThreadMessage (factory)', () => {
    const msg = newNewThreadMessage('/tmp/workspace');
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'new_thread', workspace: '/tmp/workspace' });
  });

  it('ResumeThreadMessage (factory)', () => {
    const msg = newResumeThreadMessage('tid-2', '/tmp/ws2');
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'resume_thread', thread_id: 'tid-2', workspace: '/tmp/ws2' });
  });

  it('EventMessage', () => {
    const msg: EventMessage = { type: 'event', namespace: 'soothe.output.chitchat.responded', data: { text: 'Hello' } };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'event', namespace: 'soothe.output.chitchat.responded' });
  });

  it('StatusResponse', () => {
    const msg: StatusResponse = { type: 'status', state: 'idle', thread_id: 'thread-xyz', workspace: '/tmp/ws' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'status', thread_id: 'thread-xyz' });
  });

  it('StatusResponse with camelCase threadId fallback', () => {
    const raw = `{"type":"status","state":"idle","threadId":"camel-case-id"}`;
    const decoded = decodeMessage(raw) as StatusResponse;
    expect(decoded.thread_id).toBe('camel-case-id');
  });

  it('DaemonReadyResponse', () => {
    const msg: DaemonReadyResponse = { type: 'daemon_ready', state: 'ready', message: 'daemon is ready' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'daemon_ready', state: 'ready' });
  });

  it('ErrorResponse', () => {
    const msg: ErrorResponse = { type: 'error', code: 'internal_error', message: 'something went wrong' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'error', code: 'internal_error' });
  });

  it('DaemonStatusResponse', () => {
    const raw = `{"type":"daemon_status_response","running":true,"port_live":true,"active_threads":3}`;
    const decoded = decodeMessage(raw) as DaemonStatusResponse;
    expect(decoded.running).toBe(true);
    expect(decoded.port_live).toBe(true);
    expect(decoded.active_threads).toBe(3);
  });

  it('ShutdownAckResponse', () => {
    const raw = `{"type":"shutdown_ack","status":"acknowledged"}`;
    const decoded = decodeMessage(raw) as ShutdownAckResponse;
    expect(decoded.status).toBe('acknowledged');
  });

  it('ThreadListResponse', () => {
    const raw = `{"type":"thread_list_response","threads":[{"thread_id":"t1"},{"thread_id":"t2"}]}`;
    const decoded = decodeMessage(raw) as ThreadListResponse;
    expect(decoded.threads).toHaveLength(2);
  });

  it('SkillsListResponse', () => {
    const raw = `{"type":"skills_list_response","skills":[{"name":"skill1"},{"name":"skill2"}]}`;
    const decoded = decodeMessage(raw) as SkillsListResponse;
    expect(decoded.skills).toHaveLength(2);
  });

  it('ModelsListResponse', () => {
    const raw = `{"type":"models_list_response","models":[{"id":"gpt-4"}]}`;
    const decoded = decodeMessage(raw) as ModelsListResponse;
    expect(decoded.models).toHaveLength(1);
  });

  it('config_get_response as raw map', () => {
    const raw = `{"type":"config_get_response","providers":{"openai":{"api_key":"***"}}}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('config_get_response');
  });

  it('invoke_skill_response as raw map', () => {
    const raw = `{"type":"invoke_skill_response","skill":"test","status":"ok"}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('invoke_skill_response');
  });

  it('unknown type returns raw map', () => {
    const raw = `{"type":"future_type","data":"hello"}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('future_type');
  });
});

// ---------------------------------------------------------------------------
// All client→daemon message type decode tests
// ---------------------------------------------------------------------------

describe('decode all client message types', () => {
  const tests = [
    { name: 'input', json: `{"type":"input","text":"hi","thread_id":"t1"}`, wantType: 'input' },
    { name: 'command', json: `{"type":"command","cmd":"/help"}`, wantType: 'command' },
    { name: 'subscribe_thread', json: `{"type":"subscribe_thread","thread_id":"t1","verbosity":"normal"}`, wantType: 'subscribe_thread' },
    { name: 'new_thread', json: `{"type":"new_thread","workspace":"/tmp"}`, wantType: 'new_thread' },
    { name: 'resume_thread', json: `{"type":"resume_thread","thread_id":"t1","workspace":"/tmp"}`, wantType: 'resume_thread' },
    { name: 'daemon_status', json: `{"type":"daemon_status"}`, wantType: 'daemon_status' },
    { name: 'daemon_shutdown', json: `{"type":"daemon_shutdown"}`, wantType: 'daemon_shutdown' },
    { name: 'config_get', json: `{"type":"config_get","section":"providers"}`, wantType: 'config_get' },
    { name: 'thread_list', json: `{"type":"thread_list"}`, wantType: 'thread_list' },
    { name: 'thread_get', json: `{"type":"thread_get","thread_id":"t1"}`, wantType: 'thread_get' },
    { name: 'thread_messages', json: `{"type":"thread_messages","thread_id":"t1","limit":50,"offset":0}`, wantType: 'thread_messages' },
    { name: 'thread_state', json: `{"type":"thread_state","thread_id":"t1"}`, wantType: 'thread_state' },
    { name: 'thread_update_state', json: `{"type":"thread_update_state","thread_id":"t1","values":{}}`, wantType: 'thread_update_state' },
    { name: 'thread_archive', json: `{"type":"thread_archive","thread_id":"t1"}`, wantType: 'thread_archive' },
    { name: 'thread_delete', json: `{"type":"thread_delete","thread_id":"t1"}`, wantType: 'thread_delete' },
    { name: 'thread_create', json: `{"type":"thread_create"}`, wantType: 'thread_create' },
    { name: 'thread_artifacts', json: `{"type":"thread_artifacts","thread_id":"t1"}`, wantType: 'thread_artifacts' },
    { name: 'resume_interrupts', json: `{"type":"resume_interrupts","thread_id":"t1","resume_payload":{}}`, wantType: 'resume_interrupts' },
    { name: 'skills_list', json: `{"type":"skills_list"}`, wantType: 'skills_list' },
    { name: 'models_list', json: `{"type":"models_list"}`, wantType: 'models_list' },
    { name: 'invoke_skill', json: `{"type":"invoke_skill","skill":"test","args":""}`, wantType: 'invoke_skill' },
    { name: 'detach', json: `{"type":"detach"}`, wantType: 'detach' },
  ];

  for (const tt of tests) {
    it(tt.name, () => {
      const decoded = decodeMessage(tt.json) as Record<string, unknown>;
      expect(decoded.type).toBe(tt.wantType);
    });
  }
});

// ---------------------------------------------------------------------------
// splitWirePayload tests
// ---------------------------------------------------------------------------

describe('splitWirePayload', () => {
  it('single JSON', () => {
    const lines = splitWirePayload(`{"type":"status","state":"idle"}`);
    expect(lines).toHaveLength(1);
  });

  it('NDJSON', () => {
    const lines = splitWirePayload(`{"type":"status","state":"idle"}\n{"type":"daemon_ready","state":"ready"}`);
    expect(lines).toHaveLength(2);
  });

  it('empty input', () => {
    expect(splitWirePayload('')).toHaveLength(0);
  });

  it('trailing newline', () => {
    const lines = splitWirePayload(`{"type":"status"}\n`);
    expect(lines).toHaveLength(1);
  });

  it('whitespace only', () => {
    expect(splitWirePayload('  \n  \n  ')).toHaveLength(0);
  });

  it('multiple newlines', () => {
    const lines = splitWirePayload(`{"a":1}\n\n{"b":2}\n{"c":3}`);
    expect(lines).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// extractSootheThreadID tests
// ---------------------------------------------------------------------------

describe('extractSootheThreadID', () => {
  it('from StatusResponse', () => {
    const [id, ok] = extractSootheThreadID({ type: 'status', thread_id: 'abc' });
    expect(ok).toBe(true);
    expect(id).toBe('abc');
  });

  it('from StatusResponse empty', () => {
    const [, ok] = extractSootheThreadID({ type: 'status' });
    expect(ok).toBe(false);
  });

  it('from EventMessage top-level thread_id', () => {
    const [id, ok] = extractSootheThreadID({ type: 'event', thread_id: 'evt-thread' });
    expect(ok).toBe(true);
    expect(id).toBe('evt-thread');
  });

  it('from EventMessage data.thread_id', () => {
    const [id, ok] = extractSootheThreadID({ type: 'event', data: { thread_id: 'data-thread' } });
    expect(ok).toBe(true);
    expect(id).toBe('data-thread');
  });

  it('from EventMessage data.threadId (camelCase)', () => {
    const [id, ok] = extractSootheThreadID({ type: 'event', data: { threadId: 'camel-thread' } });
    expect(ok).toBe(true);
    expect(id).toBe('camel-thread');
  });

  it('from generic map with thread_id', () => {
    const [id, ok] = extractSootheThreadID({ thread_id: 'map-thread' });
    expect(ok).toBe(true);
    expect(id).toBe('map-thread');
  });

  it('returns false for unsupported type', () => {
    const [, ok] = extractSootheThreadID('not a message');
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function tests
// ---------------------------------------------------------------------------

describe('factory functions', () => {
  it('newInputMessage', () => {
    const msg = newInputMessage('hello', 'thread-1');
    expect(msg.type).toBe('input');
    expect(msg.text).toBe('hello');
    expect(msg.thread_id).toBe('thread-1');
    expect(msg.request_id).toBeTruthy();
  });

  it('newSubscribeThreadMessage', () => {
    const msg = newSubscribeThreadMessage('tid', 'detailed');
    expect(msg.type).toBe('subscribe_thread');
    expect(msg.thread_id).toBe('tid');
    expect(msg.verbosity).toBe('detailed');
  });

  it('newNewThreadMessage', () => {
    const msg = newNewThreadMessage('/tmp/ws');
    expect(msg.type).toBe('new_thread');
    expect(msg.workspace).toBe('/tmp/ws');
  });

  it('newResumeThreadMessage', () => {
    const msg = newResumeThreadMessage('tid', '/tmp/ws');
    expect(msg.type).toBe('resume_thread');
    expect(msg.thread_id).toBe('tid');
    expect(msg.workspace).toBe('/tmp/ws');
  });

  it('newRequestID generates UUID', () => {
    const id = newRequestID();
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f-]+$/);
  });

  it('newRequestID generates unique IDs', () => {
    const id1 = newRequestID();
    const id2 = newRequestID();
    expect(id1).not.toBe(id2);
  });
});
