import { defineConfig } from 'drizzle-kit';

/**
 * Configuração do drizzle-kit (geração de migrations SQL).
 * `npm run db:generate` lê o schema TypeScript e escreve SQL versionado em ./drizzle.
 * As migrations são aplicadas pelo próprio servidor na inicialização (ou via `npm run db:migrate`).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
