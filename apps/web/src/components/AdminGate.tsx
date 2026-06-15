"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { loginAdmin } from "../api";
import {
  clearAdminSession,
  isAdminSessionCurrent,
  readAdminSession,
  writeAdminSession,
  type StoredAdminSession,
} from "../admin-session";

type Props = {
  children: (
    session: StoredAdminSession,
    helpers: { logout: () => void },
  ) => ReactNode;
};

export function AdminGate({ children }: Props) {
  const [session, setSession] = useState<StoredAdminSession | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    const stored = readAdminSession();
    if (isAdminSessionCurrent(stored)) {
      setSession(stored);
    } else {
      clearAdminSession();
    }
    setCheckedStorage(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await loginAdmin({ password });
      const nextSession = {
        token: response.token,
        expiresAt: response.expiresAt,
      };
      writeAdminSession(nextSession);
      setSession(nextSession);
      setPassword("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to sign in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function logout() {
    clearAdminSession();
    setSession(null);
  }

  if (!checkedStorage) {
    return (
      <main className="admin-page">
        <section className="admin-login-card">
          <p className="admin-kicker">PulseRx Admin</p>
          <h1>Loading secure console</h1>
        </section>
      </main>
    );
  }

  if (session && isAdminSessionCurrent(session)) {
    return <>{children(session, { logout })}</>;
  }

  return (
    <main className="admin-page">
      <section className="admin-login-card">
        <div className="admin-login-copy">
          <p className="admin-kicker">PulseRx Admin</p>
          <h1>Survey Backend</h1>
          <p>
            Sign in to manage survey guides, source material, side-panel assets,
            and launch readiness for each live survey.
          </p>
        </div>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            <span>Admin password</span>
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              type="password"
              value={password}
            />
          </label>

          {error ? <p className="admin-error">{error}</p> : null}

          <button
            className="admin-button admin-button-primary"
            disabled={isSubmitting || !password.trim()}
            type="submit"
          >
            {isSubmitting ? "Signing in..." : "Open admin"}
          </button>
        </form>
      </section>
    </main>
  );
}
