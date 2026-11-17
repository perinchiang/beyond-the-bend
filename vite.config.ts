import { defineConfig } from 'vite';

export default defineConfig({
  base: '/beyond-the-bend/',
  server: { port: 5183, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022' },
});
