import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffApp } from './StaffApp.jsx';
import '../styles.css';

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(<StrictMode><StaffApp /></StrictMode>);
