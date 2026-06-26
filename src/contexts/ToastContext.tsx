import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertOctagon, ShieldCheck, Info } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'error';

interface ToastContextType {
  triggerToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [timerId, setTimerId] = useState<any>(null);

  const triggerToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    
    // Clear old timer if any
    setTimerId((prevTimer: any) => {
      if (prevTimer) clearTimeout(prevTimer);
      return setTimeout(() => {
        setToast(null);
      }, 5000);
    });
  }, []);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={{ triggerToast }}>
      {children}
      {toast && (
        <div className="fixed top-5 right-5 z-[300] max-w-sm w-full bg-slate-900 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-fade-in transition-all">
          {toast.type === 'error' ? (
            <AlertOctagon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          ) : toast.type === 'success' ? (
            <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-neon-aqua shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-grow">
            <p className="text-xs font-bold leading-relaxed">{toast.message}</p>
          </div>
          <button 
            onClick={closeToast}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white shrink-0 font-bold p-0.5"
          >
            ×
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};
