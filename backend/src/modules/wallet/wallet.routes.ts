import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../shared/http.js';
import type { WalletService } from './wallet.service.js';

const ValidateBody = z.object({ address: z.string({ required_error: 'address é obrigatório' }).max(200) });

/**
 * POST /api/wallet/validate  { address }
 * Usado pelo frontend para validar o endereço antes de criar a ordem.
 * É POST (e não GET com o endereço na URL) para o endereço não ficar em logs de proxy.
 */
export function walletRoutes(wallet: WalletService): Router {
  const router = Router();

  router.post(
    '/validate',
    asyncHandler(async (req, res) => {
      const { address } = ValidateBody.parse(req.body);
      const result = wallet.assertValid(address, 'address');
      return ok(res, result);
    }),
  );

  return router;
}
