import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { setupDataHmr } from './app/data-hmr'
import { applyThemeClass, initialTheme } from './app/stores/theme'
import './index.css'
import { routeTree } from './routeTree.gen'

// resolve the theme synchronously before first paint to avoid FOUC
applyThemeClass(initialTheme())

setupDataHmr()

// Create a new router instance
const router = createRouter({ routeTree })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
