import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, useApp } from './store/app'
import './styles.css'

// The main process passes the theme in the URL: apply it before the first render to avoid a flash.
applyTheme(useApp.getState().theme.dark)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
