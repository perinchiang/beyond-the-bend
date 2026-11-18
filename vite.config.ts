import { defineConfig } from 'vite';

export default defineConfig({
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local') },
  base: '/beyond-the-bend/',
  server: { port: 5183, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022' },
});
