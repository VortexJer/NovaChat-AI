'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { NovaMark } from './icons';

export function AuthForm({ firstRun }: { firstRun: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>(firstRun ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'No se ha podido completar la operacion.');
        return;
      }

      // refresh() antes de push() para que el layout servidor vuelva a leer la
      // cookie recien puesta; sin esto la portada redirige de vuelta al login.
      router.refresh();
      router.push('/');
    } catch {
      setError('No hay conexion con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <NovaMark size={48} id="auth-mark" />
          <div>
            <h1>NovaChat</h1>
            <p>{firstRun ? 'Crea la cuenta de administrador' : 'Acceso privado'}</p>
          </div>
        </div>

        <form onSubmit={submit}>
          {error && <div className="error">{error}</div>}

          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Contrasena</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              required
              minLength={registering ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {registering && <p className="note">Minimo 8 caracteres.</p>}
          </div>

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Un momento...' : registering ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>

        {/* En una instalacion nueva no se ofrece cambiar a "entrar": no hay
            ninguna cuenta con la que hacerlo todavia. */}
        {!firstRun && (
          <p className="auth-switch">
            {registering ? 'Ya tienes cuenta? ' : 'No tienes cuenta? '}
            <button
              type="button"
              onClick={() => {
                setMode(registering ? 'login' : 'register');
                setError(null);
              }}
            >
              {registering ? 'Entrar' : 'Registrarse'}
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
