import { useQuery } from '@tanstack/react-query';
import { fetchHealthLive, fetchHealthReady } from '../../lib/api/health';

function apiState(isPending: boolean, isError: boolean, data: unknown): string {
  if (isPending) return 'Checking...';
  if (isError) return 'Unreachable';
  return data ? 'Reachable' : 'Unreachable';
}

export function SystemStatus() {
  const live = useQuery({ queryKey: ['health', 'live'], queryFn: fetchHealthLive, retry: false });
  const ready = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: fetchHealthReady,
    retry: false,
  });

  const apiLabel = apiState(live.isPending, live.isError, live.data);
  const databaseLabel = ready.isPending
    ? 'Checking...'
    : ready.isError
      ? 'Unreachable'
      : ready.data.checks.database === 'up'
        ? 'Up'
        : 'Down';

  return (
    <section aria-label="System status">
      <h2 className="text-lg font-semibold">System status</h2>
      <dl className="mt-3 grid max-w-md grid-cols-1 gap-3">
        <div className="rounded-lg border border-slate-300 p-4">
          <dt className="text-sm text-slate-600">API</dt>
          <dd className="mt-1 font-mono text-base">{apiLabel}</dd>
        </div>
        <div className="rounded-lg border border-slate-300 p-4">
          <dt className="text-sm text-slate-600">Database</dt>
          <dd className="mt-1 font-mono text-base">{databaseLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
