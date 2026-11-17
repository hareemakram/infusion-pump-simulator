import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { Drug, FaultSpec } from './api/types';
import { EventLog, FaultPanel, SimControls, TrendPanel, TruthPanel } from './components/Bench';
import { Device } from './components/Device';
import { PumpScreen } from './components/PumpScreen';
import { useAlarmAudio } from './hooks/useAlarmAudio';
import { usePump } from './hooks/usePump';

export default function App() {
  const pump = usePump();
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [libraryVersion, setLibraryVersion] = useState('');
  const [catalog, setCatalog] = useState<FaultSpec[]>([]);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    api.library().then((l) => { setDrugs(l.drugs); setLibraryVersion(l.version); }).catch(() => undefined);
    api.faults().then((f) => setCatalog(f.catalog)).catch(() => undefined);
  }, []);

  const snap = pump.snapshot;
  useAlarmAudio(snap?.status.highest ?? 'NONE', snap?.status.audible ?? false, sound);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <svg className="topbar__mark" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path d="M16 7.5s-5.6 6.3-5.6 10.2a5.6 5.6 0 0 0 11.2 0c0-3.9-5.6-10.2-5.6-10.2z" fill="none"
                  stroke="var(--page)" strokeWidth="2.2" />
          </svg>
          <div>
            <h1 className="topbar__title">IPS-1 Infusion Pump Simulator</h1>
            <p className="topbar__sub">C++ control firmware · Python hardware model · touchscreen UI</p>
          </div>
        </div>
        {snap && <SimControls speed={snap.speed} sound={sound} onSound={setSound} />}
      </header>

      {!snap ? (
        <div className="boot" role="status">
          {pump.link === 'stale'
            ? 'Cannot reach the pump service. Start it with: python -m pumpsim serve'
            : 'Connecting to pump service…'}
        </div>
      ) : (
        <main className="layout">
          <div className="layout__device">
            <Device priority={snap.status.highest} audible={snap.status.audible}>
              <PumpScreen status={snap.status} drugs={drugs} libraryVersion={libraryVersion}
                          link={pump.link} onStatus={pump.applyStatus} />
            </Device>
            <TrendPanel history={pump.history} threshold={snap.status.threshold} />
          </div>
          <div className="layout__bench">
            <FaultPanel catalog={catalog} active={snap.faults} />
            <TruthPanel snapshot={snap} />
            <EventLog events={pump.events} />
          </div>
        </main>
      )}
    </div>
  );
}
