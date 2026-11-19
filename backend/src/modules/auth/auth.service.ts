import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { authSessions, users, type User } from '../../db/schema.js';
import { badRequest, conflict, unauthorized } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { WalletService } from '../wallet/wallet.service.js';

const SESSION_TTL_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

export interface RegisterInput {
  name: string;
  email: string;
  phoneDdi: string;
  phoneNumber: string;
  wallet: string;
  password: string;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  phone: { ddi: string; number: string };
  wallet: string;
  walletNetwork: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
}

export interface SessionResult {
  token: string;
  expiresAt: string;
  user: UserDTO;
}

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: { ddi: u.phoneDdi, number: u.phoneNumber },
    wallet: u.walletAddress,
    walletNetwork: u.walletNetwork,
    emailVerified: u.emailVerified,
    phoneVerified: u.phoneVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64!, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly logger: Logger,
  ) {}

  async register(input: RegisterInput): Promise<SessionResult> {
    const wallet = this.wallet.assertValid(input.wallet, 'wallet');
    const email = input.email.trim().toLowerCase();
    const phoneDdi = input.phoneDdi.replace(/\D/g, '');
    const phoneNumber = input.phoneNumber.replace(/\D/g, '');
    const phoneE164 = `+${phoneDdi}${phoneNumber}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
      throw badRequest('PHONE_INVALID', 'Telefone inválido. Confira o DDI e o número.', [{ field: 'phoneNumber', message: 'Telefone inválido.' }]);
    }

    try {
      const [row] = await this.db
        .insert(users)
        .values({
          name: input.name.trim().replace(/\s+/g, ' '),
          email,
          phoneDdi,
          phoneNumber,
          phoneE164,
          walletAddress: wallet.address,
          walletNetwork: wallet.network,
          passHash: hashPassword(input.password),
        })
        .returning();
      this.logger.info({ userId: row!.id }, 'Conta criada');
      return this.createSession(row!);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === '23505' || e?.cause?.code === '23505') {
        throw conflict('EMAIL_IN_USE', 'Já existe uma conta com este e-mail. Faça login.', [
          { field: 'email', message: 'Já existe uma conta com este e-mail.' },
        ]);
      }
      throw err;
    }
  }

  async login(emailRaw: string, password: string): Promise<SessionResult> {
    const email = String(emailRaw || '').trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    // Mensagem única para e-mail inexistente e senha errada (não revela qual dos dois).
    if (!user || !verifyPassword(String(password || ''), user.passHash)) {
      throw unauthorized('E-mail ou senha incorretos.');
    }
    return this.createSession(user);
  }

  /** Valida o Bearer token e devolve o usuário; renova nada (TTL fixo). */
  async me(token: string): Promise<UserDTO> {
    const user = await this.userFromToken(token);
    return toUserDTO(user);
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)));
  }

  async userFromToken(token: string): Promise<User> {
    if (!token || token.length < 32) throw unauthorized('Sessão inválida. Faça login novamente.');
    const [row] = await this.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(eq(authSessions.tokenHash, sha256(token)))
      .limit(1);
    if (!row) throw unauthorized('Sessão inválida. Faça login novamente.');
    if (row.session.expiresAt.getTime() < Date.now()) {
      await this.db.delete(authSessions).where(eq(authSessions.tokenHash, row.session.tokenHash));
      throw unauthorized('Sessão expirada. Faça login novamente.');
    }
    return row.user;
  }

  private async createSession(user: User): Promise<SessionResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.db.insert(authSessions).values({ tokenHash: sha256(token), userId: user.id, expiresAt });
    // Limpeza oportunista de sessões vencidas do usuário.
    await this.db.delete(authSessions).where(sql`${authSessions.userId} = ${user.id} and ${authSessions.expiresAt} < now()`);
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDTO(user) };
  }
}
