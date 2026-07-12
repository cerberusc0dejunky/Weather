import { History, Trash2, Calendar, ShieldCheck, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

export interface ResolvedAlert {
  id: string;
  event: string;
  areaDesc: string;
  expires: string;
  threatLevel: 'Low' | 'Moderate' | 'High' | 'Extreme';
  resolvedAt: string;
  snippet?: string;
}

interface AlertHistoryProps {
  history: ResolvedAlert[];
  onClearHistory: () => void;
  onRemoveItem: (id: string) => void;
}

export default function AlertHistory({ history, onClearHistory, onRemoveItem }: AlertHistoryProps) {
  const formatTime = (timeStr: string) => {
    try {
      return new Date(timeStr).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timeStr;
    }
  };

  const getThreatBadgeClass = (level: string) => {
    switch (level) {
      case 'Extreme':
        return 'bg-rose-950/40 text-rose-450 dark:text-rose-400 border border-rose-500/40';
      case 'High':
        return 'bg-orange-950/40 text-orange-450 dark:text-orange-400 border border-orange-500/40';
      case 'Moderate':
        return 'bg-amber-950/40 text-amber-450 dark:text-amber-400 border border-amber-500/40';
      default:
        return 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800';
    }
  };

  return (
    <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col" aria-label="Alert History">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800/50">
        <h3 className="text-slate-850 dark:text-white text-sm font-black uppercase tracking-wider flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-[spin_40s_linear_infinite]" />
          Resolved Threat Log (Last 10 Alerts)
        </h3>
        {history.length > 0 && (
          <button
            onClick={onClearHistory}
            className="text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-rose-500 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Purge Log History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="py-10 text-center flex flex-col items-center justify-center border-2 border-dashed border-slate-100 dark:border-slate-850 rounded-2xl">
          <ShieldCheck className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
          <span className="text-[10px] font-black font-sans uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Archive Empty
          </span>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold mt-1 font-mono">
            No resolved proximity threats in record cache
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[360px] overflow-y-auto pr-1">
          {history.slice(0, 10).map((alert, index) => (
            <motion.div
              key={alert.id || index}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-850 p-3.5 rounded-xl flex items-start gap-4 transition-all relative group hover:border-slate-300 dark:hover:border-slate-800"
            >
              <div className="flex-grow min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black uppercase text-slate-800 dark:text-slate-200 truncate max-w-[240px]">
                    {alert.event}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${getThreatBadgeClass(alert.threatLevel)}`}>
                    Threat: {alert.threatLevel}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[8px] font-black uppercase tracking-wider">
                    Resolved
                  </span>
                </div>

                <div className="mt-1.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400 tracking-wider font-mono">
                  ZONES: <span className="font-sans font-medium text-slate-600 dark:text-slate-300">{alert.areaDesc}</span>
                </div>

                {alert.snippet && (
                  <p className="mt-1.5 text-[10px] font-bold text-rose-500 dark:text-red-400 uppercase tracking-wide truncate max-w-[480px]">
                    {alert.snippet}
                  </p>
                )}

                <div className="mt-2.5 flex items-center gap-4 text-[8px] font-mono font-semibold uppercase text-slate-400 dark:text-slate-500">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>Expired: {formatTime(alert.expires)}</span>
                  </div>
                  <span>•</span>
                  <span>Logged: {formatTime(alert.resolvedAt)}</span>
                </div>
              </div>

              <button
                onClick={() => onRemoveItem(alert.id)}
                className="p-1 text-slate-300 hover:text-rose-500 dark:text-slate-700 dark:hover:text-neon-pink transition-colors cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Delete log entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
