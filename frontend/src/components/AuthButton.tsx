import React, { useEffect, useState } from 'react';
import { auth, provider } from '../lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, u => setUser(u)), []);

  async function handleLogin() {
    try { setBusy(true); await signInWithPopup(auth, provider); }
    finally { setBusy(false); }
  }
  async function handleLogout() {
    try { setBusy(true); await signOut(auth); }
    finally { setBusy(false); }
  }

  if (!user) return <button onClick={handleLogin} disabled={busy}>{busy ? '処理中…' : 'Googleでログイン'}</button>;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>👤 {user.displayName ?? user.email ?? 'ユーザー'}</span>
      <button onClick={handleLogout} disabled={busy}>{busy ? '処理中…' : 'ログアウト'}</button>
    </div>
  );
}
