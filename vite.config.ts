import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

import { trajectoryData } from './plugins/trajectory-data.ts'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // pre-transform the hot paths during startup idle time so the babel
    // react-compiler pass does not land on the first request
    warmup: {
      clientFiles: ['./src/main.tsx', './src/routes/**', './src/components/**', './src/app/**'],
    },
    // agent exports and live sqlite writes are not atomic — let chokidar wait
    // for writes to settle before firing data-change events
    watch: {
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    },
  },
  plugins: [
    // Please make sure that '@tanstack/router-plugin' is passed before '@vitejs/plugin-react'
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset(), 'jotai-babel/preset'] }),
    tailwindcss(),
    trajectoryData(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)), // Alias for src folder
    },
  },
})
