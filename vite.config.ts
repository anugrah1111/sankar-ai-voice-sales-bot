import 'dotenv/config';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT || '3001';
const apiProxy = {
  '/api': process.env.VITE_API_PROXY_TARGET?.trim() || `http://127.0.0.1:${apiPort}`,
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
