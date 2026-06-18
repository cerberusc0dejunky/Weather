import { AlertTriangle, ShieldCheck, Compass, MapPin, Zap, RefreshCw, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { NWSAlert } from '../types';

interface ThreatCardProps {
  key?: string;
  alert: NWSAlert;
  hasAssets: boolean;
  onViewTrajectory?: (alert: NWSAlert) => void;
  userMaskActive?: boolean;
}

export default function ThreatCard({ alert, hasAssets, onViewTrajectory, userMaskActive = true }: ThreatCardProps) {
  const { event: rawEvent, areaDesc, expires, minDist, isDirectHit, headedTowards, etaMinutes, snippet, keywords, justUpdated } = alert;
  
  // Clean translation of event titles if user mask is active
  const translateEventName = (raw: string) => {
    const upper = raw.toUpperCase();
    if (upper.includes('TORNADO EMERGENCY')) return 'Secure Climate Advisory';
    if (upper.includes('TORNADO WARNING')) return 'Safety Precaution: Wind Rotation';
    if (upper.includes('TORNADO WATCH')) return 'Atmospheric Watch: Wind Currents';
    if (upper.includes('SEVERE THUNDERSTORM WARNING')) return 'Rain & Gusts Advisory';
    if (upper.includes('SEVERE THUNDERSTORM WATCH')) return 'Rain & Gusts Watch';
    if (upper.includes('SPECIAL WEATHER STATEMENT')) return 'Climate Statement';
    if (upper.includes('WARNING')) return 'Weather Advisory';
    if (upper.includes('WATCH')) return 'Weather Watch';
    return raw;
  };

  const isEmergency = keywords.emergency || rawEvent.includes('EMERGENCY');
  const isTornado = rawEvent.includes('TORNADO') || keywords.rotation || keywords.observed || keywords.funnel;
  const isSevereThunderstorm = rawEvent.includes('THUNDERSTORM') || keywords.destructive;
  const isWatch = rawEvent.includes('WATCH');

  // Override mask strictly if there is an active tornado warning/emergency near the person to keep them safe
  const isRealTornadoNear = isTornado && 
    (isDirectHit || (minDist <= 25 && headedTowards) || minDist <= 15) && 
    (rawEvent.toUpperCase().includes('WARNING') || rawEvent.toUpperCase().includes('EMERGENCY') || keywords.observed);

  const cardMaskActive = userMaskActive && !isRealTornadoNear;

  const event = cardMaskActive ? translateEventName(rawEvent) : rawEvent;

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
      actionText = cardMaskActive ? 'PREPARE GENTLY' : 'PREPARE IN ADVANCE';
      actionBg = 'bg-amber-50 dark:bg-amber-955/80 border border-amber-300 dark:border-amber-500 text-amber-700 dark:text-amber-400';
      actionSubtext = cardMaskActive ? 'Skies are clear, but conditions indicate shower potential' : 'Conditions favorable for severe systems';
    } else if (isTornado) {
      actionText = cardMaskActive ? 'SEEK COZY COVER' : 'TAKE COVER NOW';
      actionBg = 'bg-slate-100 dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200';
      actionSubtext = cardMaskActive ? 'Let\'s rest in a safe interior room out of comfort' : 'Go to basement or interior safety room';
    } else if (isSevereThunderstorm) {
      actionText = cardMaskActive ? 'STAY INDOORS' : 'PREPARE FOR IMPACT';
      actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-705 dark:text-slate-350';
      actionSubtext = cardMaskActive ? 'Moderate showers and gusts ahead. Enjoy the cozy day inside.' : 'Severe wind or hail threat expected';
    } else {
      actionText = cardMaskActive ? 'LIGHT RAIN ALERT' : 'WARNING ACTIVE';
      actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-650 dark:text-slate-300';
      actionSubtext = cardMaskActive ? 'Showers inside your local zone' : 'Storm inside your zone';
    }
  } else if (minDist <= 25) {
    if (isTornado && headedTowards) {
      actionText = cardMaskActive ? 'STAY COMFORTABLE' : 'TAKE SHELTER SOON';
      actionBg = 'bg-slate-50 dark:bg-slate-905 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-250';
      actionSubtext = cardMaskActive ? `Showers heading towards you, estimating: ${etaMinutes || 'Calculating'} mins` : `Storm heading towards you, ETA: ${etaMinutes || 'Calculating'} mins`;
    } else {
      if (isTornado) {
        actionText = cardMaskActive ? 'REGIONAL WEATHER ACTIVE' : 'IMMINENT REGIONAL THREAT';
        actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 text-slate-650 dark:text-slate-300';
        actionSubtext = cardMaskActive ? 'Distant weather structure being monited within 25 miles' : 'Tornadic structure/threat within 25 miles';
      } else {
        actionText = 'REGIONAL WEATHER ALERT';
        actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300';
        actionSubtext = cardMaskActive ? 'Cloud systems detected within 25 miles' : 'Severe convective cell within 25 miles';
      }
    }
  } else if (minDist <= 50) {
    actionText = cardMaskActive ? 'Distant Weather' : 'CLOSED INTERVAL WARNING';
    actionBg = 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400';
    actionSubtext = cardMaskActive ? 'Cloud cell within 50 miles monitoring radius' : 'Weather cell within 50 miles monitoring radius';
  }

  // Display Distance (Change 1: Always-Visible Distance under 3 Mi Fix)
  let distanceLabel = 'OUTSIDE AREA';
  if (hasAssets) {
    if (minDist === 0 || isDirectHit) {
      distanceLabel = cardMaskActive ? 'IN SELECTED ZONE' : '⚠ IN ZONE';
    } else if (minDist > 0 && minDist < 999) {
      distanceLabel = cardMaskActive ? `${minDist.toFixed(1)} MILES DISTANT` : `⚠ ${minDist.toFixed(1)} MILES AWAY`;
    } else {
      distanceLabel = cardMaskActive ? 'MONITORED AREA' : 'WATCH AREA';
    }
  }

  // Visual classes representing different warning types
  let cardClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm';
  let headerClass = 'bg-slate-100 dark:bg-slate-850 text-slate-700 dark:text-slate-200';

  if (cardMaskActive) {
    // Beautiful, calm style matching any advisory
    if (isDirectHit) {
      cardClass = 'bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-750 shadow-sm';
      headerClass = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold uppercase text-center tracking-normal py-2';
    } else {
      cardClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm';
      headerClass = 'bg-slate-50 dark:bg-slate-850 text-slate-650 dark:text-slate-350 font-semibold uppercase text-center tracking-normal py-1.5';
    }
  } else {
    if (isEmergency && isDirectHit) {
      // Level 3 strobe
      cardClass = 'bg-white dark:bg-slate-955 border-4 border-red-600 strobe-pds-active';
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
    } else if (rawEvent.includes('WARNING')) {
      cardClass = 'bg-white dark:bg-slate-900 border border-blue-500/40';
      headerClass = 'bg-blue-600 text-white font-bold uppercase text-center tracking-wider';
    }
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
  if (cardMaskActive) {
    threatLevelBadge = 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-700 font-medium';
  } else {
    if (threatLevel === 'Extreme') {
      threatLevelBadge = 'bg-rose-950/90 text-rose-400 border border-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse';
    } else if (threatLevel === 'High') {
      threatLevelBadge = 'bg-orange-950/90 text-orange-400 border border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]';
    } else if (threatLevel === 'Moderate') {
      threatLevelBadge = 'bg-amber-955/90 text-amber-400 border border-amber-500';
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`flex flex-col rounded-2xl overflow-hidden transition-all duration-300 ${cardClass}`}
      id={`alert-card-${alert.id}`}
    >
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
          <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 border-l-4 border-slate-300 dark:border-slate-700 rounded-r-xl transition-colors">
            <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center mb-0.5">
              <Zap className="w-3 h-3 mr-1 text-slate-400 dark:text-slate-500" /> {cardMaskActive ? 'Atmospheric Observations' : 'Ground Hazards / Observations'}
            </span>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wide line-clamp-2">
              {cardMaskActive ? 'Local cloud current variables showing minor rain cloud structure aloft.' : snippet}
            </p>
          </div>
        )}

        {/* Dynamic Diagnostic Trigger Signatures */}
        {(() => {
          const fullText = `${alert.event} ${alert.areaDesc} ${alert.description || ''} ${alert.instruction || ''} ${alert.snippet || ''}`.toUpperCase();
          const triggerConfig = [
            { word: 'TORNADO EMERGENCY', label: cardMaskActive ? 'Precautionary Comfort' : 'Tornado Emergency', reason: cardMaskActive ? 'A reassuring reminder to relax comfortably indoors.' : 'Immediate warning: Extreme threat to human life and property.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: 'DEBRIS SIGNATURE', label: cardMaskActive ? 'Dynamic Updraft Echo' : 'Tornadic Debris Signature (TDS)', reason: cardMaskActive ? 'Doppler signals show active cloud currents nearby.' : 'Radar confirms debris detection, verifying active tornado on the ground.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: 'TORNADO DEBRIS', label: cardMaskActive ? 'Dynamic Particle Flow' : 'Tornado Debris Signature', reason: cardMaskActive ? 'Correlation instruments measuring interesting rain-height clouds.' : 'Drop in Correlation Coefficient verifies lofted particulate debris.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: 'TORNADO ON THE GROUND', label: cardMaskActive ? 'Vibrant Cloud Interaction' : 'Observed Ground Tornado', reason: cardMaskActive ? 'Weather watchers note playful atmospheric currents aloft.' : 'Eyewitness or emergency responder confirmation of tornado contact.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: 'PARTICULARLY DANGEROUS SITUATION', label: cardMaskActive ? 'Atmospheric Highlight' : 'PDS Severe Threat', reason: cardMaskActive ? 'Perfect timing to hold inside with warm tea.' : 'High-severity warning indicating historically volatile storm dynamics.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: 'VELOCITY COUPLING', label: cardMaskActive ? 'Air Velocity Mingle' : 'Velocity Coupling', reason: cardMaskActive ? 'Beautiful warm and cool breeze layers matching nicely.' : 'Severe localized gate-to-gate Doppler velocity shear.', severity: cardMaskActive ? 'note' : 'high' },
            { word: 'MESOCYCLONE', label: cardMaskActive ? 'Mild Cloud Movement' : 'Supercell Mesocyclone', reason: cardMaskActive ? 'Upper cloud layer showing typical condensation patterns.' : 'Strong rotating updraft capable of supporting violent tornadoes.', severity: cardMaskActive ? 'note' : 'high' },
            { word: 'ROTATING WALL', label: cardMaskActive ? 'Atmospheric Cloud Arch' : 'Rotating Wall Cloud', reason: cardMaskActive ? 'Lovely structured condensation patterns in upper humidity.' : 'Visual precursor showing intense atmospheric vorticity.', severity: cardMaskActive ? 'note' : 'high' },
            { word: 'DEVELOPING ROTATION', label: cardMaskActive ? 'Gentle Breeze Hub' : 'Developing Rotation', reason: cardMaskActive ? 'Localized swirling cycles in the higher clouds.' : 'Increasing rotational trends detected in the storm core.', severity: cardMaskActive ? 'note' : 'moderate' },
            { word: 'ROTATION DETECTED', label: cardMaskActive ? 'Calm Vortex Swirl' : 'Radar Rotation', reason: cardMaskActive ? 'Slight circulating cloud system lofted aloft.' : 'Base velocity imagery indicates persistent mesocyclonic rotation.', severity: cardMaskActive ? 'note' : 'moderate' },
            { word: 'FUNNEL CLOUD', label: cardMaskActive ? 'Vaporous Cloud Columns' : 'Funnel Cloud', reason: cardMaskActive ? 'Small moisture formation expanding in upper cloud levels.' : 'Reported condensation funnel aloft, indicating localized shear.', severity: cardMaskActive ? 'note' : 'moderate' },
            { word: 'SHELF CLOUD', label: cardMaskActive ? 'Structured Rain Edge' : 'Shelf Cloud Signature', reason: cardMaskActive ? 'Pleasant cool breezes signaling fresh rainfall.' : 'Strong cell gust front exhibiting potentially severe downburst wind potential.', severity: cardMaskActive ? 'note' : 'moderate' },
            { word: 'WALL CLOUD', label: cardMaskActive ? 'Moist Lowering Edge' : 'Wall Cloud Signature', reason: cardMaskActive ? 'A small cloud lowering signaling a structured system.' : 'Localized lowering of updraft indicating supercellular organization.', severity: cardMaskActive ? 'note' : 'moderate' },
            { word: 'DESTRUCTIVE', label: cardMaskActive ? 'Lively System Dynamics' : 'Destructive Parameters', reason: cardMaskActive ? 'Active winds accompanying standard rainfall.' : 'Storm attributes exceed normal warn thresholds for wind or hail.', severity: cardMaskActive ? 'note' : 'high' },
            { word: '100 MPH', label: cardMaskActive ? 'Lively 100+ MPH Winds' : '100+ MPH Hurricane Winds', reason: cardMaskActive ? 'Particularly fresh, spirited winds passing downstream.' : 'Exceptional, destructive straight-line convective winds.', severity: cardMaskActive ? 'note' : 'extreme' },
            { word: '90 MPH', label: cardMaskActive ? 'Robust 90 MPH Airflow' : 'Violent 90 MPH Winds', reason: cardMaskActive ? 'Cool, refreshing gust cycles clearing high summer heat.' : 'Downburst potential capable of structural damage and utility failures.', severity: cardMaskActive ? 'note' : 'high' },
            { word: '80 MPH', label: cardMaskActive ? 'Cleansing 80 MPH Breezes' : 'Severe 80 MPH Winds', reason: cardMaskActive ? 'Clean breeze system helpful for plant-pollen dispersal.' : 'Severe straight-line winds capable of significant damage.', severity: cardMaskActive ? 'note' : 'high' },
            { word: 'TORNADO...POSSIBLE', label: cardMaskActive ? 'Swirling Air Possible' : 'Tornado Possible', reason: cardMaskActive ? 'Slight tendency for rain cell structures to mingle.' : 'Atmospheric profile supports rapid low-level tornadogenesis.', severity: cardMaskActive ? 'note' : 'moderate' }
          ];

          const matched = triggerConfig.filter(t => fullText.includes(t.word));

          if (matched.length === 0) return null;

          return (
            <div className="mt-4 p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl transition-colors">
              <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400 tracking-wider flex items-center mb-2.5">
                <Zap className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                {userMaskActive ? 'Atmospheric Insights' : 'Diagnostic Trigger Signatures'}
              </span>
              <div className="flex flex-col gap-2.5">
                {matched.map((trig, idx) => (
                  <div key={idx} className="flex flex-col border-l-2 pl-2.5 py-0.5 transition-all border-slate-350 dark:border-slate-800 hover:border-slate-550">
                    <div className="flex items-center gap-1.5 justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        {trig.label}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest leading-none ${
                        userMaskActive
                          ? 'bg-slate-100 text-slate-600 border border-slate-200'
                          : trig.severity === 'extreme'
                          ? 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
                          : trig.severity === 'high'
                          ? 'bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400'
                          : 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400'
                      }`}>
                        {userMaskActive ? 'note' : trig.severity}
                      </span>
                    </div>
                    <p className="text-[9px] font-medium text-slate-500 dark:text-slate-400 leading-snug mt-1">
                      {trig.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Extracted badges tags */}
        <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
          {headedTowards && (
            <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 font-extrabold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'FLOWING DOWNSTREAM' : 'HEADED TOWARDS YOU'}
            </span>
          )}
          {etaMinutes !== undefined && (
            <span className="px-2 py-1 bg-slate-50 dark:bg-slate-955 border border-slate-200 dark:border-slate-700 text-slate-605 dark:text-slate-405 font-bold uppercase text-[9px] tracking-wider rounded">
              ETA: {etaMinutes} MINS
            </span>
          )}
          {keywords.emergency && (
            <span className="px-2 py-1 bg-slate-100 border border-slate-300 text-slate-700 font-black text-[9px] tracking-widest rounded">
              {userMaskActive ? 'CALM PRECAUTION ACTIVE' : 'TORNADO EMERGENCY'}
            </span>
          )}
          {keywords.observed && (
            <span className="px-2 py-1 bg-slate-100 border border-slate-300 text-slate-700 font-bold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'CONFIRMED CIRRUS SPIRAL' : 'OBSERVED TORNADO'}
            </span>
          )}
          {keywords.rotation && (
            <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-600 font-bold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'CLOUD CIRCULATION NOTES' : 'ROTATION DETECTED'}
            </span>
          )}
          {keywords.funnel && (
            <span className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-500 font-bold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'CONDENSATION COLUMN' : 'FUNNEL CLOUD'}
            </span>
          )}
          {keywords.destructive && (
            <span className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-600 font-bold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'CONVECTIVE RAIN SYSTEM' : 'DESTRUCTIVE CELL'}
            </span>
          )}
          {keywords.possible && !keywords.observed && (
            <span className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-505 font-bold uppercase text-[9px] tracking-wider rounded">
              {userMaskActive ? 'SYSTEM SWIRL POSSIBLE' : 'TORNADO POSSIBLE'}
            </span>
          )}
          {keywords.vector && (
            <span className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-500 font-mono text-[9px] rounded">
              {userMaskActive ? `FLOW: SEC ${keywords.vector[0]}` : `VCTR: ${keywords.vector[0]} @ ${keywords.vector[1]} ${keywords.vector[2]}`}
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
    </motion.div>
  );
}
