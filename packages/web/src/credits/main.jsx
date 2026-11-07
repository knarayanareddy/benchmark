import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Credits } from './Credits.jsx';
import '../styles.css';

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(<StrictMode><Credits /></StrictMode>);
