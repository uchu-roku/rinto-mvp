// frontend/src/lib/authFetch.ts
import { auth } from './firebase';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function authFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers ?? {});
  headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');

  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error || text; } catch {}
    throw new Error(`${res.status} ${res.statusText} - ${msg}`);
  }
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}
