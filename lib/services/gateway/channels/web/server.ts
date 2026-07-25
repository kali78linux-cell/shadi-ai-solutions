
import WebSocket from 'ws';
import { WebChannel } from '.';

export class WebSocketServer {
  private wss: WebSocket.Server;

  constructor(private port: number, private webChannel: WebChannel) {
    this.wss = new WebSocket.Server({ port });
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });
  }

  private handleConnection(ws: WebSocket) {
    ws.on('message', (message: string | Buffer) => {
      try {
        const rawMessage = typeof message === 'string' ? message : message.toString();
        const parsedMessage = JSON.parse(rawMessage);
        this.webChannel.handleIncomingMessage(parsedMessage);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });
  }

  broadcast(message: any) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}
