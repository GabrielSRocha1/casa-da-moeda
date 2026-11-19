import express, { type Express } from 'express';
import { LEGAL_DISCLAIMER } from './config/constants.js';
import type { Env } from './config/env.js';
import type { DatabaseHandle } from './db/client.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-logger.js';
import { corsPolicy, globalRateLimit, securityHeaders, verificationRateLimit, writeRateLimit } from './middlewares/security.js';
import { webhookAuth } from './middlewares/webhook-auth.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { b2bRoutes } from './modules/b2b/b2b.routes.js';
import { B2BService } from './modules/b2b/b2b.service.js';
import { ConsoleEmailSender, NodemailerEmailSender, type EmailSender } from './modules/verification/email-sender.js';
import { ConsolePhoneVerifier, TwilioPhoneVerifier, type PhoneVerifier } from './modules/verification/phone-verifier.js';
import { verificationRoutes } from './modules/verification/verification.routes.js';
import { VerificationService } from './modules/verification/verification.service.js';
import { SimulatedTokenDispatcher, type TokenDispatcher } from './modules/p2p/custody/token-dispatcher.js';
import { p2pRoutes } from './modules/p2p/p2p.routes.js';
import { P2PService } from './modules/p2p/p2p.service.js';
import { SimulatedPixProvider, type PaymentProvider } from './modules/p2p/payments/payment-provider.js';
import { SolanaRpcClient } from './modules/tokens/solana-rpc.js';
import { tokensRoutes } from './modules/tokens/tokens.routes.js';
import { TokensService } from './modules/tokens/tokens.service.js';
import { walletRoutes } from './modules/wallet/wallet.routes.js';
import { WalletService } from './modules/wallet/wallet.service.js';
import type { Logger } from './shared/logger.js';

export interface AppDeps {
  env: Env;
  database: DatabaseHandle;
  logger: Logger;
  /** Injetáveis para trocar o Pix simulado/dispatcher simulado por integrações reais (ou mocks em teste). */
  paymentProvider?: PaymentProvider;
  dispatcher?: TokenDispatcher;
  emailSender?: EmailSender;
  phoneVerifier?: PhoneVerifier;
}

export interface AppContainer {
  app: Express;
  services: { tokens: TokensService; wallet: WalletService; p2p: P2PService; b2b: B2BService; verification: VerificationService; auth: AuthService };
}

/** Composição da aplicação (injeção de dependências manual, sem mágica). */
export function createApp(deps: AppDeps): AppContainer {
  const { env, database, logger } = deps;
  const db = database.db;

  // ---------------------------------------------------------------- Serviços
  const wallet = new WalletService(env.WALLET_NETWORKS);
  const tokens = new TokensService(db, new SolanaRpcClient(env.SOLANA_RPC_URL));
  const payments =
    deps.paymentProvider ??
    new SimulatedPixProvider({ pixKey: env.PIX_KEY, merchantName: env.PIX_MERCHANT_NAME, merchantCity: env.PIX_MERCHANT_CITY });
  const dispatcher = deps.dispatcher ?? new SimulatedTokenDispatcher();
  const p2p = new P2PService(db, env, tokens, wallet, payments, dispatcher, logger);
  const b2b = new B2BService(db, wallet, logger);

  // Confirmação de e-mail/telefone: providers reais quando há credenciais; console em dev/test.
  const emailSender =
    deps.emailSender ??
    (env.SMTP_USER && env.SMTP_PASS
      ? new NodemailerEmailSender({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.MAIL_FROM,
        })
      : new ConsoleEmailSender(logger));
  const phoneVerifier =
    deps.phoneVerifier ??
    (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID
      ? new TwilioPhoneVerifier({
          accountSid: env.TWILIO_ACCOUNT_SID,
          authToken: env.TWILIO_AUTH_TOKEN,
          verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
        })
      : new ConsolePhoneVerifier(logger, env.VERIFY_CODE_TTL_MINUTES));
  const verification = new VerificationService(db, env, emailSender, phoneVerifier, logger);
  const auth = new AuthService(db, wallet, logger);

  // ---------------------------------------------------------------- Middlewares globais
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.use(requestLogger(logger));
  app.use(securityHeaders());
  app.use(corsPolicy(env));
  app.use(express.json({ limit: '20kb' }));
  app.use(globalRateLimit(env));

  const guards = { write: writeRateLimit(env), webhook: webhookAuth(env.WEBHOOK_SECRET), verify: verificationRateLimit(env) };

  // ---------------------------------------------------------------- Rotas
  app.get('/health', async (_req, res) => {
    try {
      await database.ping();
      res.json({ status: 'ok', database: database.driver, uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.get('/api', (_req, res) =>
    res.json({
      name: 'Casa da Moeda Master Digital API',
      version: '1.0.0',
      endpoints: [
        'GET    /api/tokens',
        'GET    /api/tokens/:symbol',
        'GET    /api/tokens/:symbol/activity',
        'POST   /api/wallet/validate',
        'POST   /api/p2p/orders',
        'GET    /api/p2p/orders/:id',
        'POST   /api/p2p/orders/:id/cancel',
        'PATCH  /api/p2p/orders/:id/status   (x-webhook-secret)',
        'GET    /api/b2b/tokens/categories',
        'POST   /api/b2b/tokens/create',
        'GET    /api/b2b/tokens/requests/:id',
        'POST   /api/b2b/partnerships',
        'POST   /api/auth/register',
        'POST   /api/auth/login',
        'GET    /api/auth/me          (Bearer)',
        'POST   /api/auth/logout      (Bearer)',
        'POST   /api/verification/email/send',
        'POST   /api/verification/email/confirm',
        'POST   /api/verification/phone/send',
        'POST   /api/verification/phone/confirm',
      ],
      disclaimer: LEGAL_DISCLAIMER,
    }),
  );

  app.use('/api/tokens', tokensRoutes(tokens));
  app.use('/api/wallet', walletRoutes(wallet));
  app.use('/api/p2p', p2pRoutes(p2p, guards));
  app.use('/api/b2b', b2bRoutes(b2b, guards));
  app.use('/api/verification', verificationRoutes(verification, guards));
  app.use('/api/auth', authRoutes(auth, guards));

  // ---------------------------------------------------------------- Erros
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, services: { tokens, wallet, p2p, b2b, verification, auth } };
}
