import { randomInt } from 'node:crypto';
import twilio from 'twilio';
import { badGateway, badRequest } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';

/** Abstração da verificação de telefone — Twilio Verify em produção, console em dev, mock em teste. */
export interface PhoneVerifier {
  start(phoneE164: string): Promise<void>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
}

/** Twilio Verify guarda o estado do código do lado deles — nenhuma tabela local é necessária. */
export class TwilioPhoneVerifier implements PhoneVerifier {
  private readonly client: twilio.Twilio;

  constructor(private readonly config: TwilioConfig) {
    this.client = twilio(config.accountSid, config.authToken);
  }

  async start(phoneE164: string): Promise<void> {
    try {
      await this.client.verify.v2.services(this.config.verifyServiceSid).verifications.create({ to: phoneE164, channel: 'sms' });
    } catch (err) {
      throw mapTwilioError(err);
    }
  }

  async check(phoneE164: string, code: string): Promise<boolean> {
    try {
      const result = await this.client.verify.v2
        .services(this.config.verifyServiceSid)
        .verificationChecks.create({ to: phoneE164, code });
      return result.status === 'approved';
    } catch (err) {
      throw mapTwilioError(err);
    }
  }
}

/** Erros da Twilio → AppError com código estável para o frontend. */
function mapTwilioError(err: unknown): Error {
  const e = err as { code?: number; status?: number; message?: string };
  if (e?.code === 60200) return badRequest('PHONE_INVALID', 'Número de telefone inválido para envio de SMS.');
  if (e?.code === 60202 || e?.status === 429) {
    return badRequest('TOO_MANY_ATTEMPTS', 'Muitas tentativas de verificação. Aguarde alguns minutos e tente novamente.');
  }
  if (e?.code === 20404) {
    // Verification não encontrada: código já consumido/expirado
    return badRequest('CODE_EXPIRED', 'Código expirado ou já utilizado. Solicite um novo.');
  }
  return badGateway('SMS_PROVIDER_ERROR', 'Falha ao comunicar com o provedor de SMS. Tente novamente.');
}

/** Dev sem credenciais Twilio: gera código localmente e o escreve no log. */
export class ConsolePhoneVerifier implements PhoneVerifier {
  private readonly codes = new Map<string, { code: string; expiresAt: number }>();

  constructor(
    private readonly logger: Logger,
    private readonly ttlMinutes: number,
  ) {}

  async start(phoneE164: string): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(phoneE164, { code, expiresAt: Date.now() + this.ttlMinutes * 60_000 });
    this.logger.info({ phone: phoneE164, code }, '[dev] SMS NÃO enviado (Twilio não configurado) — código no log');
  }

  async check(phoneE164: string, code: string): Promise<boolean> {
    const entry = this.codes.get(phoneE164);
    if (!entry || Date.now() > entry.expiresAt) return false;
    if (entry.code !== code) return false;
    this.codes.delete(phoneE164);
    return true;
  }
}
