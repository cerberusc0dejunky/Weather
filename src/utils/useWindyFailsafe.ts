import { useState, useRef, MutableRefObject } from 'react';

export interface FailsafeNotification {
  visible: boolean;
  message: string;
  targetMode: 'satellite' | 'radar' | 'wind';
  timestamp: number;
}

export function useWindyFailsafe(
  windyStore: any,
  onMapModeChange: (mode: 'satellite' | 'radar' | 'wind') => void,
  mapRef: MutableRefObject<any>
) {
  const [notification, setNotification] = useState<FailsafeNotification | null>(null);

  const savedCenterRef = useRef<[number, number] | null>(null);
  const savedZoomRef = useRef<number | null>(null);

  const transitionMapMode = (targetMode: 'satellite' | 'radar' | 'wind') => {
    if (!windyStore) {
      console.warn(`[Windy Failsafe Hook] Windy API store is not available. Triggering failsafe fallback mode for "${targetMode.toUpperCase()}".`);

      // Keep current view intact
      if (mapRef && mapRef.current) {
        try {
          const map = mapRef.current;
          const center = map.getCenter();
          const zoom = map.getZoom();
          savedCenterRef.current = [center.lat, center.lng];
          savedZoomRef.current = zoom;
          console.log(`[Windy Failsafe Hook] Cached map view center: ${center.lat}, ${center.lng} and zoom: ${zoom}`);
        } catch (e) {
          console.warn('[Windy Failsafe Hook] Failed to capture map view during transition:', e);
        }
      }

      setNotification({
        visible: true,
        message: `Failsafe Mode Active: Windy API not detected. Transitioned to "${targetMode.toUpperCase()}" using Leaflet fallback layers. Map view kept intact.`,
        targetMode: targetMode,
        timestamp: Date.now(),
      });

      // Apply mode transition
      onMapModeChange(targetMode);

      // Re-apply preserved view in the next tick to ensure we keep the current map view intact
      setTimeout(() => {
        if (mapRef && mapRef.current && savedCenterRef.current && savedZoomRef.current !== null) {
          try {
            const map = mapRef.current;
            map.setView(savedCenterRef.current, savedZoomRef.current, { animate: false });
            console.log('[Windy Failsafe Hook] Map view successfully fixed intact after transition.');
          } catch (e) {
            console.warn('[Windy Failsafe Hook] Attempting fallback restore failed:', e);
          }
        }
      }, 50);
    } else {
      // Normal Windy store transition
      onMapModeChange(targetMode);
    }
  };

  const clearNotification = () => {
    setNotification(null);
  };

  return {
    notification,
    transitionMapMode,
    clearNotification,
  };
}
