type EventHandler = (payload?: unknown) => void;

type EventMap = Record<string, EventHandler[]>;

class MockServerConnection {
  readyState = 1;
  private readonly handlers: EventMap = {};
  private readonly client: MockClientWebSocket;

  constructor(client: MockClientWebSocket) {
    this.client = client;
  }

  on(event: string, handler: EventHandler) {
    this.handlers[event] ??= [];
    this.handlers[event].push(handler);
    return this;
  }

  emit(event: string, payload?: unknown) {
    for (const handler of this.handlers[event] ?? []) {
      handler(payload);
    }
  }

  send(data: string | Buffer) {
    const message = typeof data === 'string' ? data : data.toString();
    this.client.emit('message', message);
  }

  close() {
    this.readyState = 3;
  }
}

class MockClientWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockClientWebSocket.OPEN;
  private readonly handlers: EventMap = {};
  private readonly server?: MockServer;
  private connection?: MockServerConnection;

  constructor(url?: string) {
    const match = url?.match(/:(\d+)/);
    const port = match ? Number(match[1]) : undefined;
    this.server = port ? (globalThis as any).__wsMockServers?.get(port) : undefined;

    queueMicrotask(() => {
      if (!this.server) return;
      this.connection = new MockServerConnection(this);
      this.server.clients.add(this.connection);
      this.server.emitConnection(this.connection);
      this.emit('open');
    });
  }

  on(event: string, handler: EventHandler) {
    this.handlers[event] ??= [];
    this.handlers[event].push(handler);
    return this;
  }

  emit(event: string, payload?: unknown) {
    for (const handler of this.handlers[event] ?? []) {
      handler(payload);
    }
  }

  send(data: string | Buffer) {
    if (!this.connection || this.readyState !== MockClientWebSocket.OPEN) return;
    this.connection.emit('message', typeof data === 'string' ? data : data.toString());
  }

  close() {
    this.readyState = MockClientWebSocket.CLOSED;
    this.connection?.close();
  }
}

class MockServer {
  readonly clients = new Set<MockServerConnection>();
  private connectionHandler?: (ws: MockServerConnection) => void;
  private readonly port: number;

  constructor(options: { port: number }) {
    this.port = options.port;
    (globalThis as any).__wsMockServers ??= new Map();
    (globalThis as any).__wsMockServers.set(this.port, this);
  }

  on(event: string, handler: EventHandler) {
    if (event === 'connection') {
      this.connectionHandler = handler as (ws: MockServerConnection) => void;
    }
    return this;
  }

  emitConnection(connection: MockServerConnection) {
    this.connectionHandler?.(connection);
  }

  close() {
    (globalThis as any).__wsMockServers?.delete(this.port);
  }
}

const WebSocketModule = MockClientWebSocket as unknown as typeof import('ws') & {
  Server: typeof MockServer;
  OPEN: 1;
};

WebSocketModule.Server = MockServer as never;
WebSocketModule.OPEN = MockClientWebSocket.OPEN as 1;

export const OPEN = MockClientWebSocket.OPEN;
export class Server extends MockServer {}
export class WebSocket extends MockClientWebSocket {}
export default WebSocket;
