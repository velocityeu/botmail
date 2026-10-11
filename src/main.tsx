import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
const frame = new URLSearchParams(location.search).get('frame')
if (frame === 'ios' || frame === 'mac') document.documentElement.classList.add('f-' + frame)
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
