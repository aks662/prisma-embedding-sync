/** @file Creates a Prisma query extension after validating its model configuration. */
import type { PrismaClientExtends } from '@prisma/client';
import { validateConfig } from '../config.js';
import type { EmbedConfig } from '../types.js';

/** Validates configuration and returns the actual Prisma client extension type. */
export function withEmbeddings<T extends PrismaClientExtends>(client: T, config: EmbedConfig) {
  validateConfig(config);

  return client.$extends({
    name: 'prisma-embedding-sync',
    query: {
      $allModels: {
        async create({ args, query }) {
          return query(args);
        },
        async update({ args, query }) {
          return query(args);
        },
        async createMany({ args, query }) {
          return query(args);
        },
        async upsert({ args, query }) {
          return query(args);
        },
        async updateMany({ args, query }) {
          return query(args);
        },
      },
    },
  });
}
