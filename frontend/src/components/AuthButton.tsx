// frontend/src/components/AuthButton.tsx
import React, { useEffect, useState } from 'react';
import { auth, provider } from '../lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = onAuthStateChanged(auth, setUser);
    return () => off(); // 明示クリーンアップ
  }, []);

  const handleLogin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 通常はポップアップ
      await signInWithPopup(auth, provider);
    } catch (e) {
      // モバイルSafariやポップアップブロック時のフォールバック
      try {
        await signInWithRedirect(auth, provider);
      } catch (e2) {
        console.error(e2);
        alert('ログインに失敗しました。ポップアップ許可をご確認ください。');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
      alert('ログアウトに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <button onClick={handleLogin} disabled={busy}>
        {busy ? '処理中…' : 'Googleでログイン'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>👤 {user.displayName ?? user.email ?? 'ユーザー'}</span>
      <button onClick={handleLogout} disabled={busy}>
        {busy ? '処理中…' : 'ログアウト'}
      </button>
    </div>
  );
}
