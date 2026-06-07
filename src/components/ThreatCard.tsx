import { AlertTriangle, ShieldCheck, Compass, MapPin, Zap, RefreshCw, Eye } from 'lucide-react';
import { NWSAlert } from '../types';

interface ThreatCardProps {
  key?: string;
  alert: NWSAlert;
  hasAssets: boolean;
  onViewTrajectory?: (alert: NWSAlert) => void;
}

export default function ThreatCard({ alert, hasAssets, onViewTrajectory }: ThreatCardProps) {
  const { event, areaDesc, expires, minDist, isDirectHit, headedTowards, etaMinutes, snippet, keywords, justUpdated } = alert;
  const isEmergency = keywords.emergency || event.includes('EMERGENCY');
  const isTornado = event.includes('TORNADO') || keywords.rotation || keywords.observed || keywords.funnel;
  const isSevereThunderstorm = event.includes('THUNDERSTORM') || keywords.destructive;
  const isWatch = event.includes('WATCH');

  // Urgency logic - actions
  let actionText = 'MONITOR CONDITIONS';
  let actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300';
  let actionSubtext = 'System Monitoring';

  if (!hasAssets) {
    actionText = 'PIN A LOCATION';
    actionBg = 'bg-slate-50 dark:bg-slate-900 border border-cyan-400 dark:border-neon-aqua text-cyan-700 dark:text-neon-aqua';
    actionSubtext = 'Add a city/zip to track storm proximity';
  } else if (isDirectHit) {
    if (isWatch) {
      actionText = 'PREPARE IN ADVANCE';
      actionBg = 'bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-500 text-amber-700 dark:text-amber-400';
      actionSubtext = 'Conditions favorable for severe systems';
    } else if (isTornado) {
      actionText = 'TAKE COVER NOW';
      actionBg = 'bg-red-50 dark:bg-red-950 border-2 border-red-500 text-red-700 dark:text-red-100 animate-pulse';
      actionSubtext = 'Go to basement or interior safety room';
    } else if (isSevereThunderstorm) {
      actionText = 'PREPARE FOR IMPACT';
      actionBg = 'bg-orange-50 dark:bg-orange-955 border-2 border-orange-500 text-orange-700 dark:text-orange-200';
      actionSubtext = 'Severe wind or hail threat imminent';
    } else {
      actionText = 'HAZARD IMMINENT';
      actionBg = 'bg-amber-50 dark:bg-amber-955 border border-amber-500 text-amber-700 dark:text-amber-300';
      actionSubtext = 'Storm inside your zone';
    }
  } else if (minDist <= 25) {
    if (isTornado && headedTowards) {
      actionText = 'TAKE SHELTER SOON';
      actionBg = 'bg-red-50 dark:bg-red-955 border border-red-500 text-red-750 dark:text-red-200';
      actionSubtext = `Storm heading towards you, ETA: ${etaMinutes || 'Calculating'} mins`;
    } else {
      actionText = 'IMMINENT REGIONAL THREAT';
      actionBg = 'bg-slate-50 dark:bg-slate-900 border border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-200';
      actionSubtext = 'Severe convective cell within 25 miles';
    }
  } else if (minDist <= 50) {
    actionText = 'CLOSED INTERVAL WARNING';
    actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-705 dark:text-slate-300';
    actionSubtext = 'Weather cell within 50 miles monitoring radius';
  }

  // Display Distance (Change 1: Always-Visible Distance under 3 Mi Fix)
  let distanceLabel = 'OUTSIDE AREA';
  if (hasAssets) {
    if (minDist === 0 || isDirectHit) {
      distanceLabel = '⚠ IN ZONE';
    } else if (minDist > 0 && minDist < 999) {
      distanceLabel = `⚠ ${minDist.toFixed(1)} MILES AWAY`;
    } else {
      distanceLabel = 'WATCH AREA';
    }
  }

  // Visual classes representing different warning types
  let cardClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm';
  let headerClass = 'bg-slate-100 dark:bg-slate-850 text-slate-700 dark:text-slate-200';

  if (isEmergency && isDirectHit) {
    // Level 3 strobe
    cardClass = 'bg-white dark:bg-slate-950 border-4 border-red-600 strobe-pds-active';
    headerClass = 'bg-red-600 text-white font-black uppercase text-center tracking-widest text-lg';
  } else if (isTornado && (isDirectHit || minDist <= 25)) {
    // Level 2 severe red glow animation
    cardClass = 'bg-white dark:bg-slate-900 border-2 border-red-500 shadow-md dark:shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-[pulse_2s_infinite]';
    headerClass = 'bg-red-600 text-white font-extrabold uppercase text-center tracking-wider';
  } else if (isSevereThunderstorm && (isDirectHit || minDist <= 25)) {
    cardClass = 'bg-white dark:bg-slate-900 border border-orange-500 shadow-sm';
    headerClass = 'bg-orange-500 text-white font-bold uppercase text-center tracking-wider';
  } else if (isWatch) {
    cardClass = 'bg-white dark:bg-slate-900 border border-yellow-500/40';
    headerClass = 'bg-yellow-500 text-black font-bold uppercase text-center tracking-wider';
  } else if (event.includes('WARNING')) {
    cardClass = 'bg-white dark:bg-slate-900 border border-blue-500/40';
    headerClass = 'bg-blue-600 text-white font-bold uppercase text-center tracking-wider';
  }

  const formatTime = (timeStr: string) => {
    try {
      return new Date(timeStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  // Threat Level Visual Indicators (No emojis as requested)
  const threatLevel = alert.threatLevel || 'Low';
  let threatLevelBadge = 'bg-slate-900 border border-slate-700 text-slate-400';
  if (threatLevel === 'Extreme') {
    threatLevelBadge = 'bg-rose-950/90 text-rose-400 border border-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse';
  } else if (threatLevel === 'High') {
    threatLevelBadge = 'bg-orange-950/90 text-orange-400 border border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]';
  } else if (threatLevel === 'Moderate') {
    threatLevelBadge = 'bg-amber-955/90 text-amber-400 border border-amber-500';
  }

  return (
    <div className={`flex flex-col rounded-2xl overflow-hidden transition-all duration-300 ${cardClass}`} id={`alert-card-${alert.id}`}>
      {/* Top Event Title Bar */}
      <div className={`py-3 px-4 font-black flex items-center justify-between text-xs md:text-sm ${headerClass}`}>
        <span className="truncate">{event}</span>
        {justUpdated && (
          <span className="px-2 py-0.5 bg-green-500 text-black text-[9px] font-black uppercase rounded animate-pulse tracking-tight flex items-center col-span-1 border-0">
            <RefreshCw className="w-2.5 h-2.5 mr-1 animate-spin" /> NEW INFO
          </span>
        )}
      </div>

      <div className="p-5 flex-grow flex flex-col justify-between">
        {/* Qualitative Threat Level Section */}
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Threat Assessment
          </span>
          <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${threatLevelBadge}`}>
            THREAT LEVEL: {threatLevel}
          </span>
        </div>

        {/* Status Alarm Banner */}
        <div className={`p-4 rounded-xl flex flex-col text-center justify-center ${actionBg} transition-all duration-250`}>
          <span className="text-xl md:text-2xl font-black uppercase tracking-wide leading-tight">
            {actionText}
          </span>
          
          {/* ALWAYS VISIBLE DISTANCE LINE (Change 1 Fix) */}
          <span className="text-xs font-black tracking-widest mt-2 flex items-center justify-center bg-slate-900/5 dark:bg-black/40 py-1.5 px-3 rounded-full border border-slate-900/10 dark:border-white/10 uppercase text-slate-800 dark:text-white">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-rose-500 dark:text-neon-pink" />
            PHYSICAL DISTANCE: <span className="text-rose-600 dark:text-neon-pink ml-1">{distanceLabel}</span>
          </span>

          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 mt-2">
            {actionSubtext}
          </span>
        </div>

        {/* Areas / Counties Block */}
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl transition-colors">
          <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center mb-1">
            <MapPin className="w-3 h-3 mr-1" /> Affected Area Description
          </span>
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 leading-snug line-clamp-2 md:line-clamp-3">
            {areaDesc}
          </p>
        </div>

        {/* Reported Threat Details Snippet */}
        {snippet && (
          <div className="mt-3 p-3 bg-rose-50 dark:bg-red-955/20 border-l-4 border-rose-500 dark:border-red-500 rounded-r-xl transition-colors">
            <span className="text-[10px] font-black uppercase text-rose-600 dark:text-red-400 tracking-wider flex items-center mb-0.5">
              <Zap className="w-3 h-3 mr-1 text-rose-500 dark:text-red-500" /> Ground Hazards / Observations
            </span>
            <p className="text-xs font-bold text-rose-800 dark:text-red-200 uppercase tracking-wide line-clamp-2">
              {snippet}
            </p>
          </div>
        )}

        {/* Extracted badges tags */}
        <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
          {headedTowards && (
            <span className="px-2 py-1 bg-blue-105 border border-blue-200 dark:border-blue-500 text-blue-800 dark:text-blue-200 font-extrabold uppercase text-[9px] tracking-wider rounded">
              HEADED TOWARDS YOU
            </span>
          )}
          {etaMinutes !== undefined && (
            <span className="px-2 py-1 bg-slate-50 dark:bg-slate-955 border border-indigo-200 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold uppercase text-[9px] tracking-wider rounded">
              ETA: {etaMinutes} MINS
            </span>
          )}
          {keywords.emergency && (
            <span className="px-2 py-1 bg-black text-red-500 border border-red-600 font-black animate-bounce text-[9px] tracking-widest rounded">
              TORNADO EMERGENCY
            </span>
          )}
          {keywords.observed && (
            <span className="px-2 py-1 bg-red-800 border border-red-500 text-white font-bold uppercase text-[9px] tracking-wider rounded">
              OBSERVED TORNADO
            </span>
          )}
          {keywords.rotation && (
            <span className="px-2 py-1 bg-orange-100 dark:bg-orange-600/30 border border-orange-300 dark:border-orange-500 text-orange-850 dark:text-orange-200 font-bold uppercase text-[9px] tracking-wider rounded">
              ROTATION DETECTED
            </span>
          )}
          {keywords.funnel && (
            <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-600/30 border border-yellow-300 dark:border-yellow-500 text-yellow-850 dark:text-yellow-200 font-bold uppercase text-[9px] tracking-wider rounded">
              FUNNEL CLOUD
            </span>
          )}
          {keywords.destructive && (
            <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-500 text-purple-850 dark:text-purple-200 font-bold uppercase text-[9px] tracking-wider rounded">
              DESTRUCTIVE CELL
            </span>
          )}
          {keywords.possible && !keywords.observed && (
            <span className="px-2 py-1 bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/50 text-amber-850 dark:text-amber-300 font-bold uppercase text-[9px] tracking-wider rounded">
              TORNADO POSSIBLE
            </span>
          )}
          {keywords.vector && (
            <span className="px-2 py-1 bg-slate-55 dark:bg-slate-955 border border-slate-201 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[9px] rounded">
              VCTR: {keywords.vector[0]} @ {keywords.vector[1]} {keywords.vector[2]}
            </span>
          )}
        </div>

        {/* View Trajectory Button on interactive map */}
        {onViewTrajectory && (isDirectHit || minDist <= 50) && (
          <button
            onClick={() => onViewTrajectory(alert)}
            className="mt-4 w-full bg-slate-50 dark:bg-slate-950 border border-cyan-300 dark:border-neon-aqua/50 hover:border-cyan-500 dark:hover:border-neon-aqua hover:bg-cyan-50 dark:hover:bg-neon-aqua/10 text-cyan-600 dark:text-neon-aqua font-bold py-2 rounded-xl text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" /> Analyze Storm Trajectory
          </button>
        )}
      </div>

      {/* Expiration Bar */}
      <div className="bg-slate-50 dark:bg-slate-955 p-2.5 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest border-t border-slate-200 dark:border-slate-800 font-mono transition-colors">
        EXPIRES: {formatTime(expires)}
      </div>
    </div>
  );
}
