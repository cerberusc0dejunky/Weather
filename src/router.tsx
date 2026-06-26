import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import { RouteErrorElement } from './components/ErrorBoundary';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteErrorElement />
  }
]);

export default router;
