import { describe, it, expect } from "vitest";
import type WebSocket from "ws";
import { Client } from "../src/client.js";
import { defaultConfig } from "../src/config.js";
import { DaemonSession } from "../src/appkit/daemon_session.js";
import { STREAM_END, stalePendingFrameLabel } from "../src/stream_terminal.js";
import { createTestServer, fullBootstrapHandler } from "./helpers/ws-server.js";

describe("Client.peelStalePendingControlEvents", () => {
  it("removes stale terminals from the message buffer", () => {
    const client = new Client("ws://localhost:0", defaultConfig());
    const internal = client as unknown as { messageBuffer: Record<string, unknown>[] };
    internal.messageBuffer.push(
      { type: "complete" },
      {
        type: "event",
        mode: "custom",
        data: { type: STREAM_END, scope: "turn" },
      },
      { type: "status", state: "running", loop_id: "loop-1" },
    );
    const removed = client.peelStalePendingControlEvents();
    expect(removed).toContain("complete");
    expect(removed).toContain(STREAM_END);
    expect(internal.messageBuffer).toHaveLength(1);
    expect(internal.messageBuffer[0].type).toBe("status");
    expect(stalePendingFrameLabel(internal.messageBuffer[0])).toBeNull();
  });
});

/**
 * Builds a test server that handshakes, bootstraps a loop (loop_new +
 * loop_events subscribe), and answers `loop_set_clarification_mode` requests
 * with `result.applied`. Captures the params of the last clarification-mode
 * request so tests can assert on the wire payload.
 */
function clarificationModeServer(applied: boolean): {
  url: string;
  close: () => Promise<void>;
  seenParams: () => Record<string, unknown> | null;
} {
  let captured: Record<string, unknown> | null = null;
  const server = createTestServer((ws: WebSocket) => {
    ws.on("message", raw => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.type === "connection_init") {
        // Mirror fullBootstrapHandler's handshake (status + connection_ack).
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "status",
            state: "idle",
            input_history: [],
          }),
        );
        const params = (m.params as Record<string, unknown> | undefined) ?? {};
        const clientCaps = (params.capabilities as string[] | undefined) ?? [];
        const daemonCaps = ["streaming", "batch", "heartbeat", "receipts"];
        const negotiated = daemonCaps.filter(c => clientCaps.includes(c));
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "connection_ack",
            result: {
              server_version: "0.1.0",
              protocol_version: "1",
              capabilities: negotiated,
              readiness_state: "ready",
              heartbeat_interval_ms: 0,
            },
          }),
        );
        return;
      }
      const typ = m.type as string;
      const id = m.id;
      const params = (m.params as Record<string, unknown> | undefined) ?? {};
      const method = m.method as string | undefined;
      if (typ === "request" && method === "loop_new") {
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "response",
            id,
            result: { loop_id: "loop-cl-mode-1", success: true },
          }),
        );
        return;
      }
      if (typ === "subscribe" && method === "loop_events") {
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "next",
            id,
            payload: {
              loop_id: String(params.loop_id ?? ""),
              event: "subscribed",
              success: true,
              client_id: "c1",
            },
          }),
        );
        return;
      }
      if (typ === "request" && method === "loop_set_clarification_mode") {
        captured = { ...params };
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "response",
            id,
            result: { applied },
          }),
        );
        return;
      }
      if (typ === "request") {
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "response",
            id,
            result: { ok: true },
          }),
        );
      }
    });
  });
  return {
    url: server.url,
    close: server.close,
    seenParams: () => captured,
  };
}

describe("DaemonSession.setClarificationMode", () => {
  it("sends loop_set_clarification_mode with mode + interaction_mode and returns applied=true", async () => {
    const server = clarificationModeServer(true);
    try {
      const session = new DaemonSession(server.url, { config: defaultConfig() });
      try {
        await session.connect();
        const applied = await session.setClarificationMode("auto", {
          interactionMode: "bypass",
        });
        expect(applied).toBe(true);
        const params = server.seenParams();
        expect(params).not.toBeNull();
        expect(params!.mode).toBe("auto");
        expect(params!.interaction_mode).toBe("bypass");
        expect(params!.loop_id).toBe("loop-cl-mode-1");
      } finally {
        await session.close();
      }
    } finally {
      await server.close();
    }
  });

  it("returns false early when no loop_id is bound (no RPC sent)", async () => {
    // No server needed: the method must short-circuit before any connection.
    const session = new DaemonSession("ws://invalid.invalid", {
      config: defaultConfig(),
    });
    try {
      const applied = await session.setClarificationMode("manual");
      expect(applied).toBe(false);
    } finally {
      await session.close();
    }
  });

  it("omits interaction_mode when undefined and reflects daemon applied=false", async () => {
    const server = clarificationModeServer(false);
    try {
      const session = new DaemonSession(server.url, { config: defaultConfig() });
      try {
        await session.connect();
        const applied = await session.setClarificationMode("manual");
        expect(applied).toBe(false);
        const params = server.seenParams();
        expect(params).not.toBeNull();
        expect(params!.mode).toBe("manual");
        expect(Object.prototype.hasOwnProperty.call(params!, "interaction_mode")).toBe(false);
        expect(params!.loop_id).toBe("loop-cl-mode-1");
      } finally {
        await session.close();
      }
    } finally {
      await server.close();
    }
  });
});

describe("Client.setClarificationMode (RPC helper)", () => {
  it("sends loop_set_clarification_mode and resolves applied=true", async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.on("message", raw => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (m.type === "connection_init") {
          ws.send(
            JSON.stringify({ proto: "1", type: "status", state: "idle", input_history: [] }),
          );
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "connection_ack",
              result: {
                server_version: "0.1.0",
                protocol_version: "1",
                capabilities: ["streaming", "batch", "heartbeat", "receipts"],
                readiness_state: "ready",
                heartbeat_interval_ms: 0,
              },
            }),
          );
          return;
        }
        if (m.type === "request" && m.method === "loop_set_clarification_mode") {
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "response",
              id: m.id,
              result: { applied: true },
            }),
          );
          return;
        }
        if (m.type === "request") {
          ws.send(
            JSON.stringify({ proto: "1", type: "response", id: m.id, result: { ok: true } }),
          );
        }
      });
    });
    try {
      const client = new Client(server.url, defaultConfig());
      try {
        await client.connect();
        const applied = await client.setClarificationMode("loop-1", "auto", {
          interactionMode: "bypass",
        });
        expect(applied).toBe(true);
      } finally {
        client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("resolves false when daemon reports applied=false", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url, defaultConfig());
      try {
        await client.connect();
        const applied = await client.setClarificationMode("loop-1", "manual");
        // fullBootstrapHandler echoes unknown requests back with { echoed: method }
        // so result.applied is undefined → Boolean(undefined) === false.
        expect(applied).toBe(false);
      } finally {
        client.close();
      }
    } finally {
      await server.close();
    }
  });
});
