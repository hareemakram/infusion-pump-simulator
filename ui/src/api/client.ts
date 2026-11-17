import type { CommandName, CommandResponse, Drug, FaultSpec, Snapshot, Status } from './types';

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: () => request<Snapshot>('/api/state'),
  library: () => request<{ version: string; drugs: Drug[] }>('/api/library'),
  faults: () => request<{ catalog: FaultSpec[]; active: string[] }>('/api/faults'),
  command: (command: CommandName, args: Record<string, string | number | boolean | undefined> = {}) =>
    request<{ response: CommandResponse; status: Status }>('/api/command', {
      method: 'POST',
      body: JSON.stringify({ command, args }),
    }),
  fault: (fault: string, action: 'inject' | 'clear', params: Record<string, unknown> = {}) =>
    request<{ faults: string[] }>('/api/faults', {
      method: 'POST',
      body: JSON.stringify({ fault, action, params }),
    }),
  sim: (body: { speed?: number; action?: 'restart' }) =>
    request<{ speed: number }>('/api/sim', { method: 'POST', body: JSON.stringify(body) }),
};
