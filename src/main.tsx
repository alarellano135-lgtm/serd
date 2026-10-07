import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { WebRTCProvider } from './contexts/WebRTCContext.tsx';
import './index.css';
import 'leaflet/dist/leaflet.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <WebRTCProvider>
        <App />
      </WebRTCProvider>
    </AuthProvider>
  </StrictMode>,
);
