/** @file Configures Prisma 7 schema and migration paths for its isolated compatibility fixture. */
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL must target the disposable Prisma 7 compatibility database');
}

export default defineConfig({
  schema: './schema.prisma',
  migrations: { path: '../../tests/prisma/migrations' },
  datasource: { url: databaseUrl },
});
