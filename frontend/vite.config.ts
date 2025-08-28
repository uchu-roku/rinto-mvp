// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const ENABLE_PWA = process.env.ENABLE_PWA === '1' // ← 追加

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ここを追加：CIではPWA生成をスキップ
      disable: !ENABLE_PWA,

      registerType: 'autoUpdate',
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'RINTO Clone MVP',
        short_name: 'RINTO',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111827',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
