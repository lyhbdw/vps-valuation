import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // html-to-image 只在点击「生成图片」时才需要，拆成独立 chunk 按需加载，
        // 首屏 JS 减少约 13KB（未压缩）/ 5.4KB（gzip）。
        manualChunks: (id) => {
          if (id.includes('html-to-image')) return 'html-to-image';
          return undefined;
        }
      }
    }
  }
});
