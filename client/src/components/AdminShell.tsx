import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/episodes', label: 'Episodes' },
  { to: '/admin/ingest', label: 'Ingest' },
  { to: '/admin/stream', label: 'Stream' },
];

export function AdminShell() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-brand text-ink">
      <header className="px-4 pb-3 pt-6 sm:px-6 sm:pt-8">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <Link aria-label="Open public player" className="block" to="/">
              <img
                alt="duckfeed"
                className="w-[210px] transition hover:opacity-80 sm:w-[250px]"
                src="/logo.png"
              />
            </Link>
            <div className="bg-cobalt px-3 py-1 text-[0.68rem] uppercase tracking-[0.26em] text-white">
              admin
            </div>
          </div>
          <div className="flex items-center gap-3 self-start lg:self-auto">
            <span className="bg-card px-3 py-2 text-sm font-medium text-ink shadow-[0_0_0_1px_rgba(20,20,19,0.1)]">
              {user?.username ?? 'Unknown'}
            </span>
            <button
              className="bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-white hover:text-ink"
              onClick={() => void logout()}
              type="button"
            >
              logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-6 px-4 pb-10 pt-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-6">
        <nav className="bg-cobalt p-2">
          <div className="bg-ink p-3">
            <div className="mb-3 text-[0.68rem] uppercase tracking-[0.24em] text-white/55">sections</div>
            <div className="flex flex-col gap-2">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  className={({ isActive }) =>
                    [
                      'px-4 py-3 text-sm font-medium uppercase tracking-[0.18em] transition',
                      isActive ? 'bg-butter text-ink' : 'bg-transparent text-white hover:bg-white/10',
                    ].join(' ')
                  }
                  end={link.end}
                  to={link.to}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        <main className="space-y-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
