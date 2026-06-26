import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useRouteError, useNavigate } from 'react-router';
import { AlertOctagon, RefreshCw, Home, Terminal } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  props: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled exception:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return <ErrorFallbackPage error={this.state.error} resetError={() => (this as any).setState({ hasError: false, error: null })} />;
    }

    return this.props.children;
  }
}

export function RouteErrorElement() {
  const error = useRouteError() as any;
  const navigate = useNavigate();

  return (
    <ErrorFallbackPage
      error={error instanceof Error ? error : new Error(error?.message || error?.statusText || JSON.stringify(error))}
      resetError={() => navigate('/', { replace: true })}
    />
  );
}

interface FallbackProps {
  error: Error | null;
  resetError: () => void;
}

function ErrorFallbackPage({ error, resetError }: FallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white font-sans relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 pointer-events-none"></div>
      
      <div className="max-w-xl w-full bg-slate-900/60 backdrop-blur-md border border-red-500/30 rounded-3xl p-8 shadow-[0_10px_40px_rgba(239,68,68,0.15)] relative z-10 text-center">
        <div className="w-20 h-20 bg-rose-500/10 border-2 border-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
          <AlertOctagon className="w-10 h-10 text-rose-500" />
        </div>

        <h1 className="text-3xl font-black uppercase tracking-tight text-rose-500 mb-2">
          Telemetry Failure
        </h1>
        <p className="text-slate-400 text-xs font-mono tracking-widest uppercase mb-4">
          Atmospheric Tracking Interrupt
        </p>

        <p className="text-slate-300 font-medium text-sm leading-relaxed mb-6">
          An unexpected error was encountered in the telemetry rendering pipelines. Active monitoring was paused to prevent corrupted tracking telemetry.
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-4 mb-6">
          <button
            onClick={() => {
              resetError();
              window.location.reload();
            }}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg shadow-rose-900/30"
          >
            <RefreshCw className="w-4 h-4" /> Restart System
          </button>
          
          <button
            onClick={() => {
              resetError();
              window.location.href = '/';
            }}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
          >
            <Home className="w-4 h-4" /> Return Home
          </button>
        </div>

        <div className="border-t border-slate-800/80 pt-4 text-left">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-400 transition-colors font-mono cursor-pointer mx-auto"
          >
            <Terminal className="w-3.5 h-3.5" />
            {showDetails ? 'Hide Diagnostics' : 'Show Diagnostics'}
          </button>

          {showDetails && (
            <div className="mt-4 p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl text-[10px] font-mono text-rose-400 overflow-x-auto max-h-40 leading-relaxed uppercase tracking-wider select-all">
              {error?.stack || error?.message || 'Unknown execution trace.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
