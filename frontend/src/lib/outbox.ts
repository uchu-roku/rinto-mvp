// frontend/src/lib/outbox.ts
import { getAuth } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { createStore, get, set, del, keys } from "idb-keyval";
import { db } from "./firebase";

const store = createStore("rinto-outbox", "reports");
const KEY_PREFIX = "r:";
const API_URL = "/api/reports";
const API_STATE_KEY = "rinto:api_state"; // "up" | "down"

type ApiState = "up" | "down" | null;

export type SubmitResult = "sent" | "queued";

/** エントリポイント：オンラインなら即送信、失敗/オフラインならキュー */
export async function submitReport(data: any): Promise<SubmitResult> {
  if (navigator.onLine) {
    try {
      await retryableSend(data);
      return "sent";
    } catch {
      await enqueue(data);
      return "queued";
    }
  } else {
    await enqueue(data);
    return "queued";
  }
}

/** 起動時＆オンライン復帰時に自動送信を試みる */
export function initOutboxAutoFlush() {
  flushOutbox();
  window.addEventListener("online", () => flushOutbox());
}

// ============ 内部実装 ============

async function enqueue(data: any) {
  const id = `${KEY_PREFIX}${Date.now()}:${crypto.randomUUID()}`;
  await set(id, data, store);
}

export async function flushOutbox(): Promise<number> {
  let sent = 0;
  for (const k of (await keys(store)) as string[]) {
    if (typeof k === "string" && k.startsWith(KEY_PREFIX)) {
      const data = await get(k, store);
      try {
        await retryableSend(data);
        await del(k, store);
        sent++;
      } catch {
        // 次回再挑戦
      }
    }
  }
  return sent;
}

async function retryableSend(data: any, tries = 5) {
  let wait = 500;
  for (let i = 0; i < tries; i++) {
    try {
      await sendOnce(data);
      return;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 8000);
    }
  }
}

let apiStateMemo: ApiState = null;

function getCachedApiState(): ApiState {
  if (apiStateMemo) return apiStateMemo;
  const v = localStorage.getItem(API_STATE_KEY);
  if (v === "up" || v === "down") apiStateMemo = v;
  return apiStateMemo;
}
function setCachedApiState(s: Exclude<ApiState, null>) {
  apiStateMemo = s;
  localStorage.setItem(API_STATE_KEY, s);
}

/** API が使えるか一度だけ確認（結果をキャッシュ） */
async function isApiAvailable(): Promise<boolean> {
  const cached = getCachedApiState();
  if (cached) return cached === "up";
  try {
    // HEAD で軽く叩く。404/ネットエラー等なら down とみなす
    const res = await fetch(API_URL, { method: "HEAD" });
    const ok = res.ok;
    setCachedApiState(ok ? "up" : "down");
    return ok;
  } catch {
    setCachedApiState("down");
    return false;
  }
}

async function sendOnce(data: any) {
  const user = getAuth().currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  // API が無いと分かっている環境では最初から Firestore 直書き
  if (!(await isApiAvailable())) {
    await sendViaFirestore(data, user);
    return;
  }

  try {
    await sendViaApi(data, await user.getIdToken());
    // 問題なく送れたので up を覚えておく
    setCachedApiState("up");
    return;
  } catch (e: any) {
    // API 不在/無効っぽいコードは静かにフォールバックし、以後は叩かない
    const status = e?.status ?? parseStatusFromMessage(e?.message);
    const apiUnavailable =
      status === 404 || status === 405 || status === 501 || status === 0 || status == null;
    if (apiUnavailable) {
      setCachedApiState("down");
      await sendViaFirestore(data, user);
      return;
    }
    // それ以外（本当の 4xx エラーなど）は表に伝える
    throw e;
  }
}

async function sendViaApi(data: any, idToken: string) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.statusText = res.statusText;
    throw err;
  }
}

async function sendViaFirestore(data: any, user: { uid: string; displayName: string | null; email: string | null }) {
  await addDoc(collection(db, "work_reports"), {
    ...data,                              // text, photoUrl(null可), track(FC) を想定
    author_uid: user.uid,
    author_name: user.displayName ?? null,
    author_email: user.email ?? null,
    created_at: serverTimestamp(),
  });
}

function parseStatusFromMessage(msg?: string): number | null {
  const m = msg?.match(/HTTP\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

/** 将来 Functions をデプロイしたらこの関数を一度呼べば API を再検出できます */
export function resetApiAvailabilityCache() {
  localStorage.removeItem(API_STATE_KEY);
  apiStateMemo = null;
}
