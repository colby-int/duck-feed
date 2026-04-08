import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate replace to="/admin" />;
  }

  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/admin';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(username, password);
      navigate(destination, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-5 py-10">
      <div className="w-full max-w-[540px]">
        <img alt="duckfeed" className="mx-auto w-[250px] sm:w-[300px]" src="/logo.png" />

        <div className="mt-8 bg-cobalt p-2">
          <div className="bg-ink px-6 py-7 text-white sm:px-8">
            <div className="text-[0.68rem] uppercase tracking-[0.26em] text-white/55">admin</div>
            <h1 className="mt-3 text-4xl font-medium leading-none">login</h1>

            <form className="mt-8 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <span className="mb-2 block text-[0.7rem] uppercase tracking-[0.22em] text-white/65">username</span>
            <input
              autoComplete="username"
              className="w-full bg-white px-4 py-3 text-ink outline-none transition focus:ring-2 focus:ring-butter"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[0.7rem] uppercase tracking-[0.22em] text-white/65">password</span>
            <input
              autoComplete="current-password"
              className="w-full bg-white px-4 py-3 text-ink outline-none transition focus:ring-2 focus:ring-butter"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
                  value={password}
                />
              </label>
              {error ? <p className="text-sm text-[#ff8f8f]">{error}</p> : null}
              <button
                className="w-full bg-butter px-4 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink transition hover:bg-white disabled:opacity-60"
                disabled={submitting}
                type="submit"
              >
                {submitting ? 'signing in' : 'sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
