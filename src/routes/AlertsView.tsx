import React from 'react';
import { useOutletContext } from 'react-router';
import { Radio, ShieldCheck } from 'lucide-react';
import ThreatCard from '../components/ThreatCard';
import AlertHistory from '../components/AlertHistory';

export default function AlertsView() {
  const context = useOutletContext<any>();
  const {
    alerts,
    showHeadedTowardsOnly,
    setShowHeadedTowardsOnly,
    assets,
    handleFocusTrajectory,
    settings,
    alertHistory,
    handleClearAlertHistory,
    handleRemoveAlertHistoryItem,
  } = context;

  return (
    <div className="flex flex-col gap-6 items-stretch">
      {/* Spatial Proximity alerts listings section */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
          <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white font-sans tracking-wide uppercase flex items-center gap-2">
            <Radio className="w-6 h-6 text-rose-500 dark:text-neon-pink animate-[pulse_1.5s_infinite]" />
            Active Proximity Alerts
          </h2>
          
          {/* Filter Toggle for storm motion or impact trajectory headed towards the user */}
          {alerts.length > 0 && (
            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800/80 self-stretch sm:self-auto">
              <button
                id="show-all-threats-btn"
                type="button"
                onClick={() => setShowHeadedTowardsOnly(false)}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-wider ${
                  !showHeadedTowardsOnly
                    ? 'bg-slate-800 dark:bg-slate-800 text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                All Alerts ({alerts.length})
              </button>
              <button
                id="show-headed-threats-btn"
                type="button"
                onClick={() => setShowHeadedTowardsOnly(true)}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-wider flex items-center justify-center gap-1.5 ${
                  showHeadedTowardsOnly
                    ? 'bg-rose-600 dark:bg-rose-500 text-white shadow-[0_2px_8px_rgba(225,29,72,0.3)]'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                Headed Towards Me ({alerts.filter((a: any) => a.headedTowards || a.isDirectHit).length})
              </button>
            </div>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900/10 border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-3xl p-16 text-center shadow-sm">
            <ShieldCheck className="w-12 h-12 text-teal-600 dark:text-neon-aqua mx-auto mb-4 animate-[pulse_2s_infinite]" />
            <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase font-sans tracking-wider">
              System Clear
            </h3>
            <p className="text-slate-500 dark:text-slate-400 font-semibold text-sm max-w-sm mx-auto mt-1 leading-relaxed">
              Scanning the National Weather Service. No active warnings or watches intersect your designated tracking coordinates.
            </p>
          </div>
        ) : (
          (() => {
            const displayedAlerts = showHeadedTowardsOnly
              ? alerts.filter((alert: any) => alert.headedTowards || alert.isDirectHit)
              : alerts;

            if (displayedAlerts.length === 0) {
              return (
                <div className="bg-white dark:bg-slate-900/10 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-16 text-center shadow-sm">
                  <ShieldCheck className="w-12 h-12 text-teal-600 dark:text-neon-aqua mx-auto mb-4 animate-[pulse_2s_infinite]" />
                  <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase font-sans tracking-wider">
                    Clear in Path
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 font-semibold text-sm max-w-sm mx-auto mt-1 leading-relaxed">
                    You have {alerts.length} active regional alert{alerts.length > 1 ? 's' : ''}, but none are directly projected to track over or intersect your current coordinates or monitored spots.
                  </p>
                  <button
                    id="reset-filter-btn"
                    onClick={() => setShowHeadedTowardsOnly(false)}
                    className="mt-4 px-5 py-2 bg-slate-800 dark:bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    View All Proximity Alerts
                  </button>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {displayedAlerts.map((alert: any) => (
                  <ThreatCard
                    key={alert.id}
                    alert={alert}
                    hasAssets={assets.length > 0}
                    onViewTrajectory={handleFocusTrajectory}
                    userMaskActive={settings.userMaskActive}
                  />
                ))}
              </div>
            );
          })()
        )}
      </section>

      {/* Alert History Section */}
      <div className="mt-8">
        <AlertHistory
          history={alertHistory}
          onClearHistory={handleClearAlertHistory}
          onRemoveItem={handleRemoveAlertHistoryItem}
        />
      </div>
    </div>
  );
}
