import type { Logger } from 'pino';

// pino-http adiciona `req.id` e `req.log` em cada requisição.
declare module 'http' {
  interface IncomingMessage {
    id: string;
    log: Logger;
  }
}

export {};
