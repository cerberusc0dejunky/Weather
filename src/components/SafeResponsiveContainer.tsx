import React, { useState, useEffect, useRef } from 'react';
import { ResponsiveContainer } from 'recharts';

interface SafeResponsiveContainerProps {
  children: React.ReactElement;
  minWidth?: number;
  minHeight?: number;
  height?: string | number;
  width?: string | number;
  loadingLabel?: string;
}

export default function SafeResponsiveContainer({
  children,
  minWidth = 100,
  minHeight = 84,
  width = "100%",
  height = "100%",
  loadingLabel = "Initializing telemetry axes..."
}: SafeResponsiveContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Initial check: check offset dimensions before attaching observer
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      setIsReady(true);
    }

    // Use ResizeObserver to check if dimensions are ready/non-zero
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: entryWidth, height: entryHeight } = entry.contentRect;
        window.requestAnimationFrame(() => {
          if (entryWidth > 0 && entryHeight > 0) {
            setIsReady(true);
          } else {
            setIsReady(false);
          }
        });
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {isReady ? (
        <ResponsiveContainer width={width} height={height} minWidth={minWidth} minHeight={minHeight}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="w-full h-full min-h-[50px] flex items-center justify-center font-mono text-[8px] text-slate-400 dark:text-slate-500 uppercase animate-pulse">
          {loadingLabel}
        </div>
      )}
    </div>
  );
}
