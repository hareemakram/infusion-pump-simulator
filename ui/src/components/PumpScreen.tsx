import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CommandName, CommandResponse, Drug, Sensitivity, Status } from '../api/types';
import { actionsFor, type ActionId } from '../domain/actions';
import type { LinkState } from '../hooks/usePump';
import { AlarmBanner } from './AlarmBanner';
import { SettingsSheet, StartConfirm, StopConfirm, TitrateSheet } from './ConfirmSheets';
import { ProgramWizard } from './ProgramWizard';
import { ActionBar, FaultView, IdleView, InfusionView, PrimingView, StatusBar } from './ScreenParts';

type Overlay = null | 'program' | 'edit' | 'start' | 'resume' | 'stop' | 'titrate' | 'settings';

interface Props {
  status: Status;
  drugs: Drug[];
  libraryVersion: string;
  link: LinkState;
  onStatus: (s: Status) => void;
}

export function PumpScreen({ status, drugs, libraryVersion, link, onStatus }: Props) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const drug = drugs.find((d) => d.id === status.drug);

  const send = useCallback(async (name: CommandName, args: Record<string, string | number | boolean | undefined> = {}) => {
    try {
      const { response, status: s } = await api.command(name, args);
      onStatus(s);
      if (!response.ok && !response.needs_confirmation) setNotice(response.reason);
      return response;
    } catch (e) {
      const reason = (e as Error).message;
      setNotice(reason);
      return { command: name, ok: false, reason, needs_confirmation: false } satisfies CommandResponse;
    }
  }, [onStatus]);

  // A sheet that no longer fits the pump state closes itself (e.g. an alarm while confirming start).
  useEffect(() => {
    const allowed: Record<Exclude<Overlay, null>, Status['state'][]> = {
      program: ['IDLE', 'READY'], edit: ['READY'], start: ['READY'], resume: ['PAUSED'],
      stop: ['READY', 'INFUSING', 'PAUSED', 'KVO', 'ALARM'], titrate: ['INFUSING', 'PAUSED'],
      settings: ['IDLE', 'READY', 'PRIMING', 'INFUSING', 'PAUSED', 'KVO', 'ALARM', 'FAULT'],
    };
    if (overlay && !allowed[overlay].includes(status.state)) setOverlay(null);
  }, [overlay, status.state]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const onAction = (id: ActionId) => {
    setNotice(null);
    switch (id) {
      case 'program': setOverlay('program'); break;
      case 'edit': setOverlay('edit'); break;
      case 'start': setOverlay('start'); break;
      case 'resume': setOverlay('resume'); break;
      case 'stop': setOverlay('stop'); break;
      case 'titrate': setOverlay('titrate'); break;
      case 'prime': void send('PRIME'); break;
      case 'pause': void send('PAUSE'); break;
      case 'ack': void send('ACK'); break;
      case 'silence': void send('SILENCE'); break;
      case 'restart': void send('RESET'); break;
    }
  };

  let body: JSX.Element;
  if (status.state === 'FAULT') body = <FaultView status={status} />;
  else if (status.state === 'PRIMING') body = <PrimingView status={status} />;
  else if (status.state === 'IDLE') body = <IdleView status={status} />;
  else body = <InfusionView status={status} drug={drug} />;

  const close = () => setOverlay(null);
  const program = status.drug
    ? { drugId: status.drug, rate: status.rate, vtbi: status.vtbi, weight: status.weight }
    : undefined;

  return (
    <div className={`screen ${link === 'stale' ? 'is-stale' : ''}`} data-state={status.state}>
      <StatusBar status={status} drug={drug} link={link} onSettings={() => setOverlay('settings')} />
      <AlarmBanner alarms={status.alarms} audible={status.audible} silenceMs={status.silence_ms}
                   onSilence={() => void send('SILENCE')} onAcknowledge={() => void send('ACK')} />
      <main className="screen__body">{body}</main>
      {notice && <div className="notice" role="status" data-testid="notice">{notice}</div>}
      <ActionBar actions={actionsFor(status)} onAction={onAction} />

      {link === 'stale' && (
        <div className="stale" role="alert">
          <strong>No data from the pump</strong>
          <span>Values on screen may be out of date.</span>
        </div>
      )}

      {(overlay === 'program' || overlay === 'edit') && (
        <ProgramWizard drugs={drugs} initial={overlay === 'edit' ? program : undefined} onClose={close}
          onSubmit={(a) => send('PROGRAM', { ...a, confirm: a.confirm || undefined })} />
      )}
      {(overlay === 'start' || overlay === 'resume') && (
        <StartConfirm status={status} drug={drug} resume={overlay === 'resume'} onClose={close}
          onConfirm={() => { close(); void send('START'); }} />
      )}
      {overlay === 'stop' && (
        <StopConfirm status={status} onClose={close} onConfirm={() => { close(); void send('STOP'); }} />
      )}
      {overlay === 'titrate' && drug && (
        <TitrateSheet status={status} drug={drug} onClose={close}
          onSubmit={(rate, confirm) => send('TITRATE', { rate, confirm: confirm || undefined })} />
      )}
      {overlay === 'settings' && (
        <SettingsSheet status={status} libraryVersion={libraryVersion} onClose={close}
          onSensitivity={(s: Sensitivity) => void send('SENS', { level: s })} />
      )}
    </div>
  );
}
