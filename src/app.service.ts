import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Observable, Subject } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AppService implements OnModuleInit {
  private db: admin.firestore.Firestore;
  private activeObservers = new Map<string, any>();

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    // Initialize Firebase Admin
    // Ensure GOOGLE_APPLICATION_CREDENTIALS env var is set or pass serviceAccount object
    /*
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    this.db = admin.firestore();
    */
    console.log('Firebase disabled for now');
  }

  /**
   * Trigger an action (send message, button click, etc.)
   * This calls the n8n webhook to process the logic.
   */
  async triggerAction(payload: any) {
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL; // e.g., https://n8n.yourdomain.com/webhook/...
    if (!n8nWebhookUrl) {
      throw new Error('N8N_WEBHOOK_URL is not defined');
    }

    try {
      // Forward the payload to n8n
      // n8n will then update Firestore or perform other actions
      const response = await firstValueFrom(
        this.httpService.post(n8nWebhookUrl, payload),
      );
      return response.data;
    } catch (error) {
      console.error('Error calling n8n:', error.message);
      throw error;
    }
  }

  /**
   * Save a message to Firestore
   */
  async saveMessage(sessionId: string, message: any) {
    try {
      /*
      const docRef = this.db.collection('conversations').doc(sessionId);
      await docRef.collection('messages').add({
        ...message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      */
      console.log(`[Mock] Saved message for session ${sessionId}:`, message);

      // Emit to active stream if exists
      const observer = this.activeObservers.get(sessionId) as Subject<any> | undefined;
      if (observer) {
        console.log(`[Mock] Emitting to observer for session ${sessionId}`);

        // Format message for frontend
        const typedMessage = message as Record<string, any>;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let type = typedMessage['type'];
        
        // If type is missing or 'text', check for rich content fields to override
        if (!type || type === 'text') {
          if (typedMessage['card']) type = 'card';
          else if (typedMessage['carousel']) type = 'carousel';
          else if (typedMessage['table']) type = 'table';
          else if (typedMessage['list']) type = 'list';
          else if (typedMessage['image']) type = 'image';
          else if (typedMessage['buttons']) type = 'buttons';
        }

        const frontendMessage = {
          // Only set plainText if it's not already present and content is available
          plainText: (typedMessage.plainText !== undefined
            ? typedMessage.plainText
            : typedMessage.content) as string,
          participant: 'bot',
          timestamp: new Date().toISOString(),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          type,
          ...typedMessage,
        };

        observer.next({
          data: frontendMessage,
        } as MessageEvent);
      } else {
        console.log(`[Mock] No active observer for session ${sessionId}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving message to Firestore:', error);
      throw error;
    }
  }

  /**
   * Stream updates for a specific session from Firestore
   */
  getSessionStream(sessionId: string): Observable<MessageEvent> {
    return new Observable((observer) => {
      console.log(`Getting session stream for sessionId: '${sessionId}'`);
      
      // Register observer
      this.activeObservers.set(sessionId, observer);

      /*
      let docRef;
      try {
        docRef = this.db.collection('conversations').doc(sessionId);
      } catch (error) {
        console.error(`Error creating doc ref for sessionId '${sessionId}':`, error);
        observer.error(error);
        return;
      }
      const messagesRef = docRef.collection('messages').orderBy('timestamp', 'asc');

      // Listen to the conversation document for status changes
      const docUnsubscribe = docRef.onSnapshot(
        (doc) => {
          if (doc.exists) {
            const data = doc.data();
            if (data) {
              // Emit state update
              observer.next({
                type: 'state',
                data: {
                  type: 'state_update',
                  status: data.status,
                  meta: data.meta,
                  params: data.params,
                },
              } as MessageEvent);
            }
          }
        },
        (error) => {
          console.error('Firestore doc snapshot error:', error);
        }
      );

      // Listen for new messages
      const msgUnsubscribe = messagesRef.onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const messageData = change.doc.data();
              // Emit new message
              observer.next({
                data: messageData,
              } as MessageEvent);
            }
          });
        },
        (error) => {
          console.error('Firestore messages snapshot error:', error);
        }
      );

      return () => {
        docUnsubscribe();
        msgUnsubscribe();
      };
      */
      console.log(`[Mock] Stream started for session ${sessionId}`);
      // Keep the connection open
      return () => {
        console.log(`[Mock] Stream closed for session ${sessionId}`);
        this.activeObservers.delete(sessionId);
      };
    });
  }
}

