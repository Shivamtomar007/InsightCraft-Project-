import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  //  server: {
  //   hmr: {
  //     protocol: 'ws',
  //     host: 'localhost'
  //   }
  // }
  plugins: [react(),tailwindcss()],
})
