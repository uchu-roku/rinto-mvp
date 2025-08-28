// frontend/src/lib/outbox.ts
import { getAuth } from 'firebase/auth'
import { createStore, get, set, del, keys } from 'idb-keyval'

const store = createStore('rinto-outbox', 'reports')
const KEY_PREFIX = 'r:'

export type SubmitResult = 'sent' | 'queued'

// フォームからはこれだけ呼べばOK
export async function submitReport(data: any): Promise<SubmitResult> {
  if (navigator.onLine) {
    try {
      await retryableSend(data)
      return 'sent'
    } catch {
      await enqueue(data)
      return 'queued'
    }
  } else {
    await enqueue(data)
    return 'queued'
  }
}

// 起動時＆オンライン復帰時に自動送信
export function initOutboxAutoFlush() {
  flushOutbox()
  window.addEventListener('online', () => { flushOutbox() })
}

// ===== 内部実装 =====
async function enqueue(data: any) {
  const id = `${KEY_PREFIX}${Date.now()}:${crypto.randomUUID()}`
  await set(id, data, store)
}

export async function flushOutbox(): Promise<number> {
  let sent = 0
  for (const k of (await keys(store)) as string[]) {
    if (typeof k === 'string' && k.startsWith(KEY_PREFIX)) {
      const data = await get(k, store)
      try {
        await retryableSend(data)
        await del(k, store)
        sent++
      } catch {
        // 次回に再挑戦
      }
    }
  }
  return sent
}

async function retryableSend(data: any, tries = 5) {
  let wait = 500
  for (let i = 0; i < tries; i++) {
    try {
      await sendOnce(data)
      return
    } catch (e) {
      if (i === tries - 1) throw e
      await new Promise(r => setTimeout(r, wait))
      wait = Math.min(wait * 2, 8000)
    }
  }
}

async function sendOnce(data: any) {
  const token = await getIdToken()
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

async function getIdToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('UNAUTHENTICATED')
  return user.getIdToken()
}
