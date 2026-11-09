/** @file Defines the ESM, CommonJS, and declaration build for the package. */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node22',
  external: ['@prisma/client'],
});
