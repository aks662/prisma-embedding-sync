/** @file Creates a Prisma query extension after validating its model configuration. */
import { validateConfig } from '../config.js';
import type { EmbedConfig, EmbeddingExtension, EmbeddingQueryContext } from '../types.js';
import { executeCreate } from './create.js';
import { executeCreateMany } from './createMany.js';
import { executeUpdate } from './update.js';
import { executeUpsert } from './upsert.js';
import { rejectUpdateMany } from './updateMany.js';

/** Validates configuration and returns a Prisma query extension for the consumer's client. */
export function withEmbeddings(config: EmbedConfig): EmbeddingExtension {
  validateConfig(config);

  return {
    name: 'prisma-embedding-sync',
    query: {
      $allModels: {
        create: async <TArgs extends { data: unknown }, TResult>(
          context: EmbeddingQueryContext<TArgs, TResult>,
        ): Promise<TResult> =>
          executeCreate(context.model, context.args, context.query, config.models),
        update: async <TArgs extends { where: unknown; data: unknown }, TResult>(
          context: EmbeddingQueryContext<TArgs, TResult>,
        ): Promise<TResult> =>
          executeUpdate(context.model, context.args, context.query, config.models),
        createMany: async <TArgs extends { data: unknown }, TResult>(
          context: EmbeddingQueryContext<TArgs, TResult>,
        ): Promise<TResult> =>
          executeCreateMany(context.model, context.args, context.query, config.models),
        upsert: async <TArgs extends { where: unknown; create: unknown; update: unknown }, TResult>(
          context: EmbeddingQueryContext<TArgs, TResult>,
        ): Promise<TResult> =>
          executeUpsert(context.model, context.args, context.query, config.models),
        updateMany: async <TArgs, TResult>(
          context: EmbeddingQueryContext<TArgs, TResult>,
        ): Promise<never> => rejectUpdateMany(context.model),
      },
    },
  };
}
