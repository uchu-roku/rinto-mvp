// frontend/src/App.tsx
import React, { useEffect, useState, lazy, Suspense } from 'react';
import MapView from './components/MapView';
import AuthButton from './components/AuthButton';
import { auth } from './lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { initOutboxAutoFlush, flushOutbox } from './lib/outbox';

// 遅延読み込み（最上部で定義）
const Plans = lazy(() => import('./components/Plans'));
const Reports = lazy(() => import('./components/Reports'));

type Tab = 'map' | 'plans' | 'reports';

export default function App() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [tab, setTab] = useState<Tab>('map');
  const [authReady, setAuthReady] = useState(false);

  // アウトボックス：起動時に監視開始（オンライン復帰で自動フラッシュ）
  useEffect(() => {
    initOutboxAutoFlush();
  }, []);

  // 認証状態の購読（ログイン成立時にキュー再送も試行）
  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        try { await flushOutbox(); } catch { /* 未ログインやネット不通なら次回 */ }
      }
    });
    return () => off();
  }, []);

  // タブの永続化（任意）
  useEffect(() => { try { localStorage.setItem('tab', tab); } catch {} }, [tab]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tab') as Tab | null;
      if (saved) setTab(saved);
    } catch {}
  }, []);

  const TabButton = ({
    id, label, needLogin = false,
  }: { id: Tab; label: string; needLogin?: boolean }) => {
    const disabled = needLogin && !user;
    const active = tab === id;
    return (
      <button
        onClick={() => !disabled && setTab(id)}
        disabled={disabled}
        aria-pressed={active}
        title={disabled ? 'ログインすると利用できます' : ''}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: active ? '1px solid #4b5563' : '1px solid #e5e7eb',
          background: active ? '#f3f4f6' : '#fff',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: '48px 1fr' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid #eee' }}>
        <strong style={{ flex: 1 }}>RINTO Clone MVP</strong>
        <nav style={{ display: 'flex', gap: 8 }}>
          <TabButton id="map" label="地図" />
          <TabButton id="plans" label="施業計画" needLogin />
          <TabButton id="reports" label="日報" needLogin />
        </nav>
        <div style={{ marginLeft: 'auto' }}>
          <AuthButton />
        </div>
      </header>

      {!authReady ? (
        <div style={{ padding: 16 }}>読み込み中…</div>
      ) : (
        <>
          {tab === 'map' && <MapView />}

          {tab === 'plans' && (
            user ? (
              <Suspense fallback={<div style={{ padding: 16 }}>読み込み中…</div>}>
                <Plans />
              </Suspense>
            ) : (
              <div style={{ padding: 16 }}>
                <p>施業計画はログインが必要です。</p>
                <AuthButton />
              </div>
            )
          )}

          {tab === 'reports' && (
            user ? (
              <Suspense fallback={<div style={{ padding: 16 }}>読み込み中…</div>}>
                <Reports />
              </Suspense>
            ) : (
              <div style={{ padding: 16 }}>
                <p>日報はログインが必要です。</p>
                <AuthButton />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
