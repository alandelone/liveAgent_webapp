import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import seedData from '../../test-fixtures/seed-data.json';
import { HermesServerEvent } from '../types/protocol';

export interface MockServerOptions {
  port?: number;
  autoStartReplay?: boolean;
  speedMultiplier?: number;
  seedFixture?: typeof seedData;
}

export class MockHermesServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private options: Required<MockServerOptions>;
  private replayTimers: Array<ReturnType<typeof setTimeout>> = [];
  public receivedClientEvents: any[] = [];
  public receivedAudioChunks: Buffer[] = [];

  constructor(options: MockServerOptions = {}) {
    this.options = {
      port: options.port ?? 8765,
      autoStartReplay: options.autoStartReplay ?? true,
      speedMultiplier: options.speedMultiplier ?? 1.0,
      seedFixture: options.seedFixture ?? seedData,
    };
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.options.port }, () => {
          const address = this.wss?.address();
          const actualPort = typeof address === 'object' && address ? address.port : this.options.port;
          this.options.port = actualPort;
          resolve(actualPort);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          this.clients.add(ws);

          ws.on('message', (data: RawData, isBinary: boolean) => {
            if (isBinary) {
              this.receivedAudioChunks.push(Buffer.from(data as Buffer));
              return;
            }

            try {
              const msg = JSON.parse(data.toString());
              this.receivedClientEvents.push(msg);
              this.handleClientMessage(ws, msg);
            } catch (err) {
              console.error('[MockServer] Parse error from client:', err);
            }
          });

          ws.on('close', () => {
            this.clients.delete(ws);
            this.clearReplayTimers();
          });
        });

        this.wss.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    this.clearReplayTimers();
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      this.clients.forEach((ws) => {
        try {
          ws.close();
        } catch (_) {}
      });
      this.clients.clear();

      this.wss.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.options.port;
  }

  public broadcast(event: HermesServerEvent | Record<string, unknown>): void {
    const payload = JSON.stringify(event);
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  public broadcastAudio(buffer: Buffer | Uint8Array): void {
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }
    });
  }

  private handleClientMessage(ws: WebSocket, msg: any): void {
    if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      return;
    }

    if (msg.type === 'CLIENT_HELLO') {
      const { lastSeq } = msg;

      // Send AGENT_MANIFEST
      ws.send(JSON.stringify(this.options.seedFixture.manifest));

      // Handle reconnect gap replay
      if (typeof lastSeq === 'number' && lastSeq > 0) {
        const reconnectScenario = this.options.seedFixture.reconnectScenario;
        if (reconnectScenario && reconnectScenario.replayedEvents) {
          const eventsToReplay = this.options.seedFixture.replayTimeline
            .map((item) => item.event)
            .filter((ev) => reconnectScenario.replayedEvents.includes(ev.seq));

          eventsToReplay.forEach((ev) => {
            ws.send(JSON.stringify(ev));
          });
        }
      } else {
        // Send initial transcripts if any
        if (this.options.seedFixture.initialTranscripts) {
          this.options.seedFixture.initialTranscripts.forEach((item) => {
            ws.send(JSON.stringify(item));
          });
        }

        if (this.options.autoStartReplay) {
          this.startTimelineReplay(ws);
        }
      }
      return;
    }

    if (msg.type === 'USER_INTERRUPT') {
      // Stop TTS playback immediately
      this.clearReplayTimers();
      this.broadcast({
        type: 'AGENT_STATE',
        seq: 999,
        agentId: 'hermes',
        state: 'interrupted',
        detail: 'TTS interrupted by user speech',
      });
      return;
    }

    if (msg.type === 'USER_SPEECH_START') {
      this.broadcast({
        type: 'AGENT_STATE',
        seq: 800,
        agentId: 'hermes',
        state: 'listening',
      });
      return;
    }

    if (msg.type === 'USER_TEXT') {
      this.broadcast({
        type: 'STT_FINAL',
        seq: 801,
        turnId: msg.turnId,
        text: msg.text,
      });
      this.broadcast({
        type: 'AGENT_STATE',
        seq: 802,
        agentId: 'hermes',
        state: 'thinking',
      });
      return;
    }
  }

  public startTimelineReplay(ws?: WebSocket): void {
    this.clearReplayTimers();
    const timeline = this.options.seedFixture.replayTimeline;

    timeline.forEach((item) => {
      const delay = Math.round(item.delayMs / this.options.speedMultiplier);
      const timer = setTimeout(() => {
        const payload = JSON.stringify(item.event);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        } else {
          this.broadcast(item.event);
        }
      }, delay);
      this.replayTimers.push(timer);
    });
  }

  public clearReplayTimers(): void {
    this.replayTimers.forEach((timer) => clearTimeout(timer));
    this.replayTimers = [];
  }
}
