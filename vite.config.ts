import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['buy.bingyun.vip'],
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/server/**', '**/tests/**'] },
  },
  build: { target: 'es2022', sourcemap: false },
});
