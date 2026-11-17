import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { Alarm } from '../api/types';
import { AlarmBanner } from '../components/AlarmBanner';
import { ProgramWizard } from '../components/ProgramWizard';
import { PumpScreen } from '../components/PumpScreen';
import { DRUGS, infusing, status } from '../test/fixtures';

jest.mock('../api/client', () => ({ api: { command: jest.fn() }, ApiError: class extends Error {} }));
const command = api.command as jest.Mock;

const ok = (s = status()) => ({ response: { command: 'X', ok: true, reason: '', needs_confirmation: false }, status: s });

beforeEach(() => command.mockReset());

async function key(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const d of digits) await user.click(screen.getByRole('button', { name: d === '.' ? 'Decimal point' : d }));
}

describe('AlarmBanner', () => {
  const occl: Alarm = { id: 'DOWNSTREAM_OCCLUSION', priority: 'HIGH', condition: true, raised_at: 10 };
  const low: Alarm = { id: 'RESERVOIR_LOW', priority: 'LOW', condition: true, raised_at: 20 };

  it('renders nothing without alarms', () => {
    const { container } = render(<AlarmBanner alarms={[]} audible={false} silenceMs={0} onSilence={jest.fn()} onAcknowledge={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the highest priority alarm as an assertive alert with text, not colour alone (SRS-081)', () => {
    render(<AlarmBanner alarms={[low, occl]} audible silenceMs={0} onSilence={jest.fn()} onAcknowledge={jest.fn()} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('data-priority', 'HIGH');
    expect(within(banner).getByText('High priority')).toBeInTheDocument();
    expect(within(banner).getByText('Occlusion: patient side')).toBeInTheDocument();
    expect(within(banner).getByText('+1 more')).toBeInTheDocument();
  });

  it('cannot acknowledge while the condition is present (SRS-043)', () => {
    render(<AlarmBanner alarms={[occl]} audible silenceMs={0} onSilence={jest.fn()} onAcknowledge={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Acknowledge/ })).toBeDisabled();
  });

  it('acknowledges a cleared alarm and silences with a countdown (SRS-042)', async () => {
    const user = userEvent.setup();
    const onAck = jest.fn();
    const onSilence = jest.fn();
    const { rerender } = render(
      <AlarmBanner alarms={[{ ...occl, condition: false }]} audible silenceMs={0} onSilence={onSilence} onAcknowledge={onAck} />);
    await user.click(screen.getByRole('button', { name: /Acknowledge/ }));
    await user.click(screen.getByRole('button', { name: /Silence alarm/ }));
    expect(onAck).toHaveBeenCalled();
    expect(onSilence).toHaveBeenCalled();
    rerender(<AlarmBanner alarms={[occl]} audible={false} silenceMs={95_000} onSilence={onSilence} onAcknowledge={onAck} />);
    expect(screen.getByText('1:35')).toBeInTheDocument();
  });

  it('low priority alarms are polite and have no acknowledge', () => {
    render(<AlarmBanner alarms={[low]} audible silenceMs={0} onSilence={jest.fn()} onAcknowledge={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-priority', 'LOW');
    expect(screen.queryByRole('button', { name: /Acknowledge/ })).toBeNull();
  });
});

describe('ProgramWizard', () => {
  it('walks drug, settings and review, then submits (SRS-002)', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue({ ok: true, reason: '', command: 'PROGRAM', needs_confirmation: false });
    const onClose = jest.fn();
    render(<ProgramWizard drugs={DRUGS} onSubmit={onSubmit} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /Heparin/ }));
    await key(user, '10');
    await user.click(screen.getByTestId('field-vtbi'));
    await key(user, '250');
    expect(screen.getByTestId('dose-verdict')).toHaveTextContent('1,000 units/h is within limits');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('25 h 00 min')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-program'));
    expect(onSubmit).toHaveBeenCalledWith({ drug: 'heparin', rate: 10, vtbi: 250, weight: undefined, confirm: false });
    expect(onClose).toHaveBeenCalled();
  });

  it('requires explicit override for a soft limit (SRS-004)', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue({ ok: true, reason: '', command: 'PROGRAM', needs_confirmation: false });
    render(<ProgramWizard drugs={DRUGS} initial={{ drugId: 'heparin', rate: 25, vtbi: 100, weight: 0 }}
                          onSubmit={onSubmit} onClose={jest.fn()} />);
    expect(screen.getByTestId('dose-verdict')).toHaveTextContent('above the usual maximum');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const confirm = screen.getByTestId('confirm-program');
    expect(confirm).toBeDisabled();
    await user.click(screen.getByTestId('override'));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ confirm: true }));
  });

  it('blocks a hard limit before review (SRS-003)', async () => {
    render(<ProgramWizard drugs={DRUGS} initial={{ drugId: 'heparin', rate: 31, vtbi: 100, weight: 0 }}
                          onSubmit={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('dose-verdict')).toHaveTextContent('above the hard limit');
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });

  it('asks for weight first for weight-based drugs (SRS-007)', async () => {
    const user = userEvent.setup();
    render(<ProgramWizard drugs={DRUGS} onSubmit={jest.fn()} onClose={jest.fn()} />);
    await user.click(screen.getByRole('button', { name: /Propofol/ }));
    expect(screen.getByTestId('field-weight')).toHaveAttribute('aria-pressed', 'true');
    await key(user, '70');
    await user.click(screen.getByTestId('field-rate'));
    await key(user, '14');
    await user.click(screen.getByTestId('field-vtbi'));
    await key(user, '50');
    expect(screen.getByTestId('dose-verdict')).toHaveTextContent('2.00 mg/kg/h is within limits');
  });

  it('shows the firmware verdict when it rejects the program', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue({ ok: false, reason: 'Not allowed while INFUSING', command: 'PROGRAM', needs_confirmation: false });
    render(<ProgramWizard drugs={DRUGS} initial={{ drugId: 'saline', rate: 100, vtbi: 100, weight: 0 }}
                          onSubmit={onSubmit} onClose={jest.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByTestId('confirm-program'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed while INFUSING');
  });
});

describe('PumpScreen', () => {
  const props = { drugs: DRUGS, libraryVersion: 'DL-test', link: 'live' as const, onStatus: jest.fn() };

  it('asks for confirmation before starting and only then sends START (SRS-080)', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok(infusing()));
    const ready = infusing({ state: 'READY', motor_enabled: false, infused: 0 });
    render(<PumpScreen status={ready} {...props} />);
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    expect(command).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Start infusion?' });
    expect(within(dialog).getByText('1,000 units/h')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-start'));
    expect(command).toHaveBeenCalledWith('START', {});
  });

  it('cancelling the start confirmation sends nothing (SRS-080)', async () => {
    const user = userEvent.setup();
    render(<PumpScreen status={infusing({ state: 'READY', motor_enabled: false })} {...props} />);
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it('shows whether the pump is delivering (SRS-083)', () => {
    const { rerender } = render(<PumpScreen status={infusing()} {...props} />);
    expect(screen.getByTestId('rate-display')).toHaveTextContent('Delivering');
    rerender(<PumpScreen status={infusing({ state: 'PAUSED', motor_enabled: false })} {...props} />);
    expect(screen.getByTestId('rate-display')).toHaveTextContent('Not delivering');
  });

  it('pauses with a single tap', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok(infusing({ state: 'PAUSED' })));
    render(<PumpScreen status={infusing()} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(command).toHaveBeenCalledWith('PAUSE', {});
  });

  it('ending an infusion needs confirmation (SRS-014)', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok());
    render(<PumpScreen status={infusing({ state: 'PAUSED', motor_enabled: false })} {...props} />);
    await user.click(screen.getByRole('button', { name: /End infusion/ }));
    expect(screen.getByText('237.5 mL')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-stop'));
    expect(command).toHaveBeenCalledWith('STOP', {});
  });

  it('titration validates the new rate against limits (SRS-006)', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok());
    render(<PumpScreen status={infusing()} {...props} />);
    await user.click(screen.getByRole('button', { name: /Change rate/ }));
    await key(user, '35');
    expect(screen.getByTestId('confirm-titrate')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await key(user, '15');
    await user.click(screen.getByTestId('confirm-titrate'));
    expect(command).toHaveBeenCalledWith('TITRATE', { rate: 15, confirm: undefined });
  });

  it('shows a firmware rejection as a notice', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue({ response: { command: 'PRIME', ok: false, reason: 'Not allowed while FAULT', needs_confirmation: false }, status: status() });
    render(<PumpScreen status={status()} {...props} />);
    await user.click(screen.getByRole('button', { name: /Prime line/ }));
    expect(await screen.findByTestId('notice')).toHaveTextContent('Not allowed while FAULT');
  });

  it('fault state offers only a restart', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok());
    const fault = infusing({
      state: 'FAULT', motor_enabled: false, highest: 'HIGH', audible: true,
      alarms: [{ id: 'SENSOR_FAULT', priority: 'HIGH', condition: true, raised_at: 5 }],
    });
    render(<PumpScreen status={fault} {...props} />);
    expect(screen.getByText(/Pump stopped: sensor failure/)).toBeInTheDocument();
    const controls = screen.getByRole('navigation', { name: 'Pump controls' });
    expect(within(controls).getAllByRole('button')).toHaveLength(1);
    await user.click(within(controls).getByRole('button', { name: /Restart pump/ }));
    expect(command).toHaveBeenCalledWith('RESET', {});
  });

  it('greys out values when the data link is stale (SRS-082)', () => {
    render(<PumpScreen status={infusing()} {...props} link="stale" />);
    expect(screen.getByText('No data from the pump')).toBeInTheDocument();
  });

  it('changes occlusion sensitivity from settings (SRS-031)', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok());
    render(<PumpScreen status={status()} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('radio', { name: /High/ }));
    expect(command).toHaveBeenCalledWith('SENS', { level: 'HIGH' });
    expect(screen.getByText('DL-test')).toBeInTheDocument();
  });

  it('programs a new infusion through the wizard', async () => {
    const user = userEvent.setup();
    command.mockResolvedValue(ok(status({ state: 'READY' })));
    render(<PumpScreen status={status()} {...props} />);
    await user.click(screen.getByRole('button', { name: /New infusion/ }));
    await user.click(screen.getByRole('button', { name: /Sodium chloride/ }));
    await key(user, '100');
    await user.click(screen.getByTestId('field-vtbi'));
    await key(user, '500');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByTestId('confirm-program'));
    expect(command).toHaveBeenCalledWith('PROGRAM', { drug: 'saline', rate: 100, vtbi: 500, weight: undefined, confirm: undefined });
  });
});
