/**
 * Grimoire Pro — Database Migration Runner
 *
 * Dead-simple migration approach for v1: read schema.sql, execute it.
 * All statements use IF NOT EXISTS / IF NOT EXISTS so it's idempotent —
 * safe to run multiple times without breaking anything.
 *
 * Why not a migration framework (Prisma, Drizzle, etc.)?
 *   - We have 2 tables. A framework would add more complexity than it removes.
 *   - Raw SQL is easier to review in a security audit
 *   - When we outgrow this, migrating TO a framework is straightforward
 *
 * Run: npx tsx src/db/migrate.ts
 * Or:  npm run db:migrate
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, {
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  });

  try {
    console.log('Running database migrations...');

    // Read and execute schema
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Execute the entire schema as a single transaction.
    // If anything fails, nothing is applied — no half-migrated state.
    await sql.unsafe(schema);

    console.log('Migrations complete.');

    // Verify tables exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log('Tables:', tables.map(t => t.table_name).join(', '));
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
