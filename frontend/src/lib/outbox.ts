// frontend/src/lib/outbox.ts
import { getAuth } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { createStore, get, set, del, keys } from "idb-keyval";
import { db } from "./firebase";

const store = createStore("rinto-outbox", "reports");
const KEY_PREFIX = "r:";

export type SubmitResult = "sent" | "queued";

/**
 * レポート送信のエントリポイント。
 * - オンライン時は即送信（API → 失敗時は Firestore 直書きにフォールバック）
 * - オフライン時/失敗時は Outbox にキューして後で自動送信
 */
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

// ================= 内部実装 =================

async function enqueue(data: any) {
  const id = `${KEY_PREFIX}${Date.now()}:${crypto.randomUUID()}`;
  await set(id, data, store);
}

/** Outbox を送信。成功件数を返す */
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
        // 次回に再挑戦
      }
    }
  }
  return sent;
}

/** 送信を指数バックオフで何度かリトライ */
async function retryableSend(data: any, tries = 5) {
  let wait = 500;
  for (let i = 0; i < tries; i++) {
    try {
      await sendOnce(data);
      return;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 8_000);
    }
  }
}

/** 一度だけ送信（API → ダメなら Firestore にフォールバック） */
async function sendOnce(data: any) {
  const user = getAuth().currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  // 1) まずはバックエンド API（存在する環境向け）
  try {
    await sendViaApi(data, await user.getIdToken());
    return;
  } catch (e: any) {
    // API が無い Hosting 単体環境などでは 404 になる想定
    const status = e?.status ?? parseStatusFromMessage(e?.message);
    const apiUnavailable =
      status === 404 || status === 405 || status === 501 || status === 0 || status == null;
    if (!apiUnavailable) {
      // 4xx で API が生きている場合はそのままエラー
      // （二重登録を避けるためフォールバックしない）
      throw e;
    }
  }

  // 2) Firestore 直書き（Hosting 単体運用のフォールバック）
  await sendViaFirestore(data, {
    uid: user.uid,
    name: user.displayName ?? null,
    email: user.email ?? null,
  });
}

/** バックエンド API へ送信 */
async function sendViaApi(data: any, idToken: string) {
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status}`);
    (err.status = res.status), (err.statusText = res.statusText);
    throw err;
  }
}

/** Firestore に直接保存 */
async function sendViaFirestore(
  data: any,
  author: { uid: string; name: string | null; email: string | null }
) {
  // 期待するフィールド: text, photoUrl(null可), track(GeoJSON)
  await addDoc(collection(db, "work_reports"), {
    ...data,
    author_uid: author.uid,
    author_name: author.name,
    author_email: author.email,
    created_at: serverTimestamp(),
  });
}

/** "HTTP 404" のようなメッセージから status を抽出 */
function parseStatusFromMessage(msg?: string): number | null {
  const m = msg?.match(/HTTP\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}
