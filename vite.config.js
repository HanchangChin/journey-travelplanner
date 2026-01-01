import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 🔥 強制這兩個套件只使用專案根目錄的版本
    dedupe: ['react', 'react-dom'],
  },
})