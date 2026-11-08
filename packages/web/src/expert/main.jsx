import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { registerServiceWorker } from '../lib/pwa.js';
import '../styles.css';

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(<StrictMode><App /></StrictMode>);
registerServiceWorker();
