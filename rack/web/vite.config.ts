import { defineConfig, type PluginOption } from 'vite';
import preact from '@preact/preset-vite';

// Dev only: either proxy /api to a real backend (RACK_API=http://localhost:4999)
// or serve fixtures. The mock module is imported lazily so it never reaches the build.
export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [preact()];
  const api = process.env.RACK_API;
  if (command === 'serve' && !api) {
    const { rackMock } = await import('./dev/mock');
    plugins.push(rackMock(process.env.RACK_SCENARIO));
  }
  return {
    plugins,
    base: '/',
    build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
    server: {
      port: 5173,
      proxy: api ? { '/api': { target: api, changeOrigin: true } } : undefined,
    },
  };
});
