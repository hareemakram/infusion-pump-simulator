import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { FaultSpec, Snapshot } from '../api/types';
import { EventLog, FaultPanel, SimControls, TrendPanel, TruthPanel } from '../components/Bench';
import { Device } from '../components/Device';
import { usePump } from '../hooks/usePump';
import { useAlarmAudio } from '../hooks/useAlarmAudio';
import { infusing } from '../test/fixtures';

jest.mock('../api/client', () => ({
  api: { fault: jest.fn().mockResolvedValue({ faults: [] }), sim: jest.fn().mockResolvedValue({ speed: 1 }), state: jest.fn() },
  ApiError: class extends Error {},
}));

const CATALOG: FaultSpec[] = [
  { id: 'downstream_occlusion', label: 'Downstream occlusion', group: 'Fluid path', description: 'd', expected_alarm: 'DOWNSTREAM_OCCLUSION', pulse: false, params: {} },
  { id: 'air_bubble', label: 'Air bubble', group: 'Fluid path', description: 'b', expected_alarm: 'AIR_IN_LINE', pulse: true, params: {} },
  { id: 'motor_stall', label: 'Motor stall', group: 'Mechanism', description: 's', expected_alarm: 'MOTOR_STALL', pulse: false, params: {} },
];

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  t: 1000, status: infusing(), faults: [], sample: [1000, 22, 31, 10], events: [], last_event_id: 0, speed: 1,
  plant: { line_outflow_ml: 1, air_to_patient_ul: 0, downstream_true: 21.5, upstream_true: 31, reservoir_ml: 240, flow_ml_h: 10.2 },
  ...over,
});

describe('bench panels', () => {
  it('groups faults and injects, clears and triggers them', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FaultPanel catalog={CATALOG} active={[]} />);
    expect(screen.getByText('Mechanism')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Downstream occlusion' }));
    expect(api.fault).toHaveBeenLastCalledWith('downstream_occlusion', 'inject');
    rerender(<FaultPanel catalog={CATALOG} active={['downstream_occlusion']} />);
    expect(screen.getByRole('switch', { name: 'Downstream occlusion' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('1 active')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Downstream occlusion' }));
    expect(api.fault).toHaveBeenLastCalledWith('downstream_occlusion', 'clear');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(api.fault).toHaveBeenLastCalledWith('air_bubble', 'inject');
  });

  it('compares pump readings with the plant model', () => {
    render(<TruthPanel snapshot={snap()} />);
    expect(screen.getByText('10.2 mL/h')).toBeInTheDocument();
    expect(screen.getByText('240.0 mL')).toBeInTheDocument();
  });

  it('lists events newest first', () => {
    render(<EventLog events={[
      { id: 1, seq: 1, t: 1000, kind: 'COMMAND', message: 'first' },
      { id: 2, seq: 2, t: 2000, kind: 'ALARM', message: 'second' },
    ]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('second');
    expect(rows[0]).toHaveClass('log__row--alarm');
  });

  it('changes speed, resets and toggles sound', async () => {
    const user = userEvent.setup();
    const onSound = jest.fn();
    render(<SimControls speed={1} sound={false} onSound={onSound} />);
    await user.click(screen.getByRole('radio', { name: '10×' }));
    expect(api.sim).toHaveBeenCalledWith({ speed: 10 });
    await user.click(screen.getByRole('button', { name: 'Reset simulation' }));
    expect(api.sim).toHaveBeenCalledWith({ action: 'restart' });
    await user.click(screen.getByRole('checkbox', { name: 'Alarm sound' }));
    expect(onSound).toHaveBeenCalledWith(true);
  });

  it('renders the trend panel legend with the threshold', () => {
    render(<TrendPanel history={[[0, 10, 30, 5], [100, 12, 30, 5]]} threshold={300} />);
    expect(screen.getByText('Alarm 300')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /pressure trend/ })).toBeInTheDocument();
  });

  it('device light bar follows alarm priority', () => {
    render(<Device priority="HIGH" audible><span>screen</span></Device>);
    expect(screen.getByTestId('lightbar')).toHaveClass('lightbar--high', 'is-audible');
    expect(screen.getByText('screen')).toBeInTheDocument();
  });
});

class FakeEventSource {
  static last: FakeEventSource;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeEventSource.last = this; }
  close() { this.closed = true; }
  emit(s: Snapshot) { this.onmessage?.({ data: JSON.stringify(s) }); }
}

describe('usePump', () => {
  beforeEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    (api.state as jest.Mock).mockResolvedValue(snap({ history: [[900, 20, 30, 10]], events: [{ id: 1, seq: 1, t: 0, kind: 'SYSTEM', message: 'Power on' }] }));
  });

  it('loads a snapshot, then merges stream frames', async () => {
    const { result, unmount } = renderHook(() => usePump());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.link).toBe('live');
    expect(result.current.history).toHaveLength(1);
    act(() => FakeEventSource.last.emit(snap({ t: 1100, sample: [1100, 25, 30, 10], last_event_id: 2,
      events: [{ id: 2, seq: 2, t: 1100, kind: 'COMMAND', message: 'START' }] })));
    expect(result.current.history).toHaveLength(2);
    expect(result.current.events.map((e) => e.id)).toEqual([1, 2]);
    act(() => result.current.applyStatus(infusing({ state: 'PAUSED' })));
    expect(result.current.snapshot?.status.state).toBe('PAUSED');
    act(() => FakeEventSource.last.onerror?.());
    expect(result.current.link).toBe('stale');
    act(() => FakeEventSource.last.emit(snap({ error: 'firmware exited' })));
    expect(result.current.link).toBe('stale');
    unmount();
    expect(FakeEventSource.last.closed).toBe(true);
  });

  it('reloads when the simulation restarts', async () => {
    const { result } = renderHook(() => usePump());
    await act(async () => { await Promise.resolve(); });
    (api.state as jest.Mock).mockClear();
    await act(async () => { FakeEventSource.last.emit(snap({ t: 100 })); await Promise.resolve(); });
    expect(api.state).toHaveBeenCalled();
    expect(result.current.link).toBe('live');
  });

  it('reports a stale link when the service is unreachable', async () => {
    (api.state as jest.Mock).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePump());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.link).toBe('stale');
  });
});

describe('useAlarmAudio', () => {
  it('does nothing when sound is off or no audio API exists', () => {
    expect(() => renderHook(() => useAlarmAudio('HIGH', true, false))).not.toThrow();
    expect(() => renderHook(() => useAlarmAudio('HIGH', true, true))).not.toThrow();
  });
});
