import { SystemStatus } from './features/system/SystemStatus';

export function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <p className="text-base font-semibold">Blood Operations Platform</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <SystemStatus />
      </main>
      <footer className="mx-auto max-w-5xl px-4 py-6 text-sm text-slate-500">
        <p>Development build</p>
      </footer>
    </div>
  );
}
