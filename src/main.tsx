import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('EngOps UI 啟動失敗:找不到 #root 掛載點')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
