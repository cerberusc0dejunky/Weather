import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import MapView from './routes/MapView';
import AlertsView from './routes/AlertsView';
import TelemetryView from './routes/TelemetryView';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Navigate to="/map" replace />
      },
      {
        path: 'map',
        element: <MapView />
      },
      {
        path: 'alerts',
        element: <AlertsView />
      },
      {
        path: 'telemetry',
        element: <TelemetryView />
      }
    ]
  }
]);

export default router;
