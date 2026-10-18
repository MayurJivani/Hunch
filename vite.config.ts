import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.PORT) || 5190, // the preview runner assigns PORT
    proxy: { '/socket.io': { target: 'http://localhost:4351', ws: true } },
  },
});
