import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';

// Intercept third-party Windy libBoot.js console.error when a Map API key is domain-restricted
// in preview environments, converting it into an immediate failsafe switch to Leaflet + NOAA NEXRAD.
const originalConsoleError = console.error.bind(console);
console.error = (...args: any[]) => {
  const firstMsg = typeof args[0] === 'string' ? args[0] : '';
  if (firstMsg.includes('Failed to authorize Windy API key')) {
    console.warn(
      '[DAISY Radar Failsafe] Windy Map API key not authorized for this domain/environment — engaging Leaflet + NOAA NEXRAD radar failsafe.'
    );
    (window as any).__daisyWindyAuthFailed = true;
    window.dispatchEvent(new CustomEvent('daisy-windy-auth-failed'));
    return;
  }
  originalConsoleError(...args);
};

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

// Register PWA service worker for standalone installation and background notifications
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    const swUrl = `${(import.meta as any).env?.BASE_URL || '/'}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('DAISY ServiceWorker registered on scope:', registration.scope);
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
