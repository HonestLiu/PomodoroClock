import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopOrb from './components/DesktopOrb';
createRoot(document.getElementById('root')!).render(<StrictMode><DesktopOrb /></StrictMode>);
