import { apiOrigin } from '../env';

export interface HealthLive {
  status: 'ok';
}

export interface HealthReady {
  status: 'ok' | 'error';
  checks: {
    database: 'up' | 'down';
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiOrigin}${path}`);
  return (await res.json()) as T;
}

export async function fetchHealthLive(): Promise<HealthLive> {
  const res = await fetch(`${apiOrigin}/health/live`);
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return (await res.json()) as HealthLive;
}

export async function fetchHealthReady(): Promise<HealthReady> {
  return getJson<HealthReady>('/health/ready');
}
