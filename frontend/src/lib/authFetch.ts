import { auth } from './firebase';

export async function authFetch(input: string, init: RequestInit = {}) {
  const current = auth.currentUser;
  const token = current ? await current.getIdToken() : '';
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, headers });
}
