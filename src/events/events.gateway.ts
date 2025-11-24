import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly orchestratorService: OrchestratorService) {}

  @SubscribeMessage('message:send')
  async handleMessage(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    console.log('Message received from client:', client.id, data);
    // Assuming data has a 'content' field. Adjust based on actual frontend payload.
    const messageContent = data.content || data.message || JSON.stringify(data);
    // Use the sessionId passed in the data if available (this is the browser's socket ID)
    // Fallback to client.id (which is the Next.js server's socket ID)
    const sessionId = data.sessionId || client.id;
    await this.orchestratorService.handleUserMessage(sessionId, messageContent);
  }

  sendMessageToClient(clientId: string, payload: any) {
      console.log(`Attempting to send message to client ${clientId}. Payload:`, payload);
      const clientSocket = this.server.sockets.sockets.get(clientId);
      if (clientSocket) {
          console.log(`Found socket for client ${clientId}, emitting message:received`);
          clientSocket.emit('message:received', payload);
      } else {
          console.log(`Socket not found for client ${clientId}. Available sockets:`, Array.from(this.server.sockets.sockets.keys()));
          // Fallback: Try broadcasting to see if it reaches (for debugging)
          // this.server.emit('message:received', payload); 
      }
  }
}
