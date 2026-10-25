import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['buy.bingyun.vip'],
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/server/**', '**/tests/**'] },
  },
  /* cssTarget 用现代浏览器：否则 CSS 压缩会把标准的 backdrop-filter 删掉，顶栏的毛玻璃模糊失效。 */
  build: { target: 'es2022', cssTarget: ['chrome111', 'safari18', 'firefox115'], sourcemap: false },
});
