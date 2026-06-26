import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ToastProvider } from './contexts/ToastContext';
import router from './router';
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);

// Register PWA service worker for home screen install capability
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    navigator.serviceWorker.register('/sw.js')
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
