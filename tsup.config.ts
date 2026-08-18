import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: true,
  sourcemap: true,
  clean: true,
  bundle: true,
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  removeNodeProtocol: false,
  external: ['node:sqlite']
});
