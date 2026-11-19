/**
 * CLI de banco:  npm run db:migrate  |  npm run db:seed
 */
import { loadEnv } from '../config/env.js';
import { createDatabase } from './client.js';
import { seedNativeTokens } from './seed.js';

async function main() {
  const cmd = process.argv[2];
  const env = loadEnv();
  const handle = await createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  try {
    if (cmd === 'migrate') {
      await handle.migrate();
      console.log('✔ Migrations aplicadas');
    } else if (cmd === 'seed') {
      await handle.migrate();
      const n = await seedNativeTokens(handle.db);
      console.log(`✔ Seed concluído (${n} token(s) inserido(s))`);
    } else {
      console.error('Uso: tsx src/db/cli.ts <migrate|seed>');
      process.exitCode = 1;
    }
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
