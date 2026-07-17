/**
 * Shared hermetic-database helper for integration tests.
 *
 * Each spec file gets its own throwaway Postgres database — created fresh
 * against an admin connection, schema pushed via `prisma db push`, and
 * dropped in afterAll. This is the Postgres equivalent of the old
 * "one SQLite file per spec file" trick: full isolation between spec
 * files running in parallel, without a shared Postgres server's tables
 * colliding.
 *
 * Requires a reachable Postgres server; point `TEST_DATABASE_URL` (or
 * `DATABASE_URL`) at its default/admin database. Local dev: the
 * docker-compose `db` service (`postgresql://postgres:postgres@localhost:5432/postgres`).
 * CI: a postgres service container (see .github/workflows/ci.yml).
 */

import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

function adminUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/postgres'
  );
}

function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export interface TestDb {
  prisma: PrismaClient;
  dbUrl: string;
  teardown: () => Promise<void>;
}

/** Creates a fresh, isolated Postgres database with the schema pushed. Call once per spec file, in beforeAll. */
export async function createTestDb(label: string): Promise<TestDb> {
  const admin = adminUrl();
  const dbName = `fb_test_${label}_${process.pid}_${Math.floor(Math.random() * 1e6)}`
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase();
  const dbUrl = withDatabase(admin, dbName);

  const adminClient = new PrismaClient({ datasources: { db: { url: admin } } });
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.$disconnect();

  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  return {
    prisma,
    dbUrl,
    teardown: async () => {
      await prisma.$disconnect();
      const dropClient = new PrismaClient({ datasources: { db: { url: admin } } });
      // Prisma's pool doesn't always close its socket synchronously on
      // $disconnect(), so DROP DATABASE can race a still-closing
      // connection (Postgres error 55006). Force-terminate any lingering
      // backends on this database first, retrying the drop briefly.
      // (This logs a harmless "terminating connection due to administrator
      // command" line to stdout — that's Prisma reporting the connection
      // we just told Postgres to kill, not a test failure.)
      for (let attempt = 0; attempt < 5; attempt++) {
        await dropClient.$executeRawUnsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          dbName,
        );
        try {
          await dropClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
          break;
        } catch (err) {
          if (attempt === 4) throw err;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      await dropClient.$disconnect();
    },
  };
}
