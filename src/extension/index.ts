/** @file Creates a Prisma query extension after validating its model configuration. */
import type { PrismaClient } from '@prisma/client';
import { validateConfig } from '../config.js';
import type { EmbedConfig } from '../types.js';
import { executeCreate } from './create.js';
import { executeCreateMany } from './createMany.js';
import { executeUpdate } from './update.js';
import { executeUpsert } from './upsert.js';
import { rejectUpdateMany } from './updateMany.js';

/** Validates configuration and returns the actual Prisma client extension type. */
export function withEmbeddings<T extends PrismaClient>(client: T, config: EmbedConfig) {
  validateConfig(config);

  return client.$extends({
    name: 'prisma-embedding-sync',
    query: {
      $allModels: {
        create({ model, args, query }) {
          return executeCreate(model, args, query, config.models);
        },
        async update({ model, args, query }) {
          return executeUpdate(model, args, query, config.models);
        },
        async createMany({ model, args, query }) {
          return executeCreateMany(model, args, query, config.models);
        },
        async upsert({ model, args, query }) {
          return executeUpsert(model, args, query, config.models);
        },
        async updateMany({ model }) {
          return rejectUpdateMany(model);
        },
      },
    },
  });
}
