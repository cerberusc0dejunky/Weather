import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';

// Dynamically initialize Google Analytics if VITE_GA_MEASUREMENT_ID is configured
const gaId = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID;
if (gaId) {
  const script1 = document.createElement('script');
  script1.async = true;
  script1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script1);

  const script2 = document.createElement('script');
  script2.text = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){window.dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${gaId}', { send_page_view: true });
  `;
  document.head.appendChild(script2);
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  console.error("Failed to find the root element.");
}

// Register PWA service worker in production; unregister and purge stale caches on localhost/dev
if ('serviceWorker' in navigator) {
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    Boolean((import.meta as any).env?.DEV);

  if (isLocalhost) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((reg) => reg.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => caches.delete(key));
      });
    }
  } else {
    const registerSW = () => {
      const swUrl = `${(import.meta as any).env?.BASE_URL || '/'}sw.js`;
      navigator.serviceWorker.register(swUrl)
        .then((registration) => {
          console.log('DAISY ServiceWorker successfully registered on scope:', registration.scope);
        })
        .catch((error) => {
          console.warn('DAISY ServiceWorker registration failed:', error);
        });
    };

    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
}
