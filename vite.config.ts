import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 게임 안 버전 표시·업데이트 소식이 읽는다 (package.json 의 version)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: Number(process.env.PORT) || 5173 },
});
