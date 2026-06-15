export const ADMIN_SESSION_STORAGE_KEY = "pulserx_admin_session";

export type StoredAdminSession = {
  token: string;
  expiresAt: string;
};

export function readAdminSession(): StoredAdminSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as StoredAdminSession;
    if (!session.token || !session.expiresAt) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function isAdminSessionCurrent(session: StoredAdminSession | null) {
  return Boolean(
    session?.token &&
    session.expiresAt &&
    new Date(session.expiresAt) > new Date(),
  );
}

export function writeAdminSession(session: StoredAdminSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    ADMIN_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
}

export function clearAdminSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
}
