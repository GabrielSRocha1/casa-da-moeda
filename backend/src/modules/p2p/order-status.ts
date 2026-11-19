import type { OrderStatus } from '../../db/schema.js';

/**
 * Máquina de estados da ordem P2P.
 *
 *   PENDING ──► PAID ──► COMPLETED
 *      │
 *      ├──► CANCELLED
 *      └──► EXPIRED   (apenas pelo sistema, quando a cobrança Pix vence)
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED', 'EXPIRED'],
  PAID: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Status que podem ser enviados pelo webhook / PATCH (EXPIRED é exclusivo do sistema). */
export const WEBHOOK_STATUSES = ['PAID', 'COMPLETED', 'CANCELLED'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Rótulos em português para o frontend. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  COMPLETED: 'Concluído / Enviado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
};
