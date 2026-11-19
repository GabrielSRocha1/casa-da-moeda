import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from '../../shared/logger.js';

/** Abstração do envio de e-mail — permite trocar SMTP real por console (dev) ou mock (teste). */
export interface EmailSender {
  send(to: string, subject: string, html: string, text: string): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Envio real via SMTP (Zoho). Credenciais vêm exclusivamente das variáveis de ambiente. */
export class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true = SSL (465); false = STARTTLS (587)
      auth: { user: config.user, pass: config.pass },
    });
  }

  async send(to: string, subject: string, html: string, text: string): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, to, subject, html, text });
  }
}

/** Dev/teste sem credenciais: loga o conteúdo em vez de enviar. */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  async send(to: string, subject: string, _html: string, text: string): Promise<void> {
    this.logger.info({ to, subject, text }, '[dev] e-mail NÃO enviado (SMTP não configurado) — conteúdo no log');
  }
}
