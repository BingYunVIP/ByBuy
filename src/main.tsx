import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { LocaleProvider } from './locale';

createRoot(document.getElementById('root')!).render(<StrictMode><LocaleProvider><App /></LocaleProvider></StrictMode>);
