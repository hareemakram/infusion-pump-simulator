import { api, ApiError } from '../api/client';

describe('api client', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  it('posts commands as JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: { ok: true } }) });
    await api.command('PROGRAM', { drug: 'saline', rate: 10 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/command');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ command: 'PROGRAM', args: { drug: 'saline', rate: 10 } });
  });

  it('raises the service error message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'unknown command' }) });
    await expect(api.fault('x', 'inject')).rejects.toThrow(new ApiError('unknown command'));
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
    await expect(api.sim({ speed: 2 })).rejects.toThrow('HTTP 500');
  });

  it('covers the read endpoints', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await api.state();
    await api.library();
    await api.faults();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/state', '/api/library', '/api/faults']);
  });
});
