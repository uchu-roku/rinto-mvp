// functions/src/index.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

// 自作ミドルウェア／スキーマ
import { requireAuth } from './mw/auth';
import { validateBody } from './mw/validate';
import { ReportSchema, PlanSchema } from './schemas';

// --- 型拡張（requireAuth が req.user を付与する前提） ---
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

// --- Firebase Admin 初期化 ---
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// --- CORS 許可オリジン ---
const ALLOWLIST = [
  'http://localhost:5173',
  'https://rinto-mvp.web.app',
  'https://rinto-mvp.firebaseapp.com',
];

// --- Express 準備 ---
const app = express();

// 1) 逆プロキシ環境（Cloud Functions / Cloud Run）での IP 取得用
app.set('trust proxy', 1);

// 2) セキュリティヘッダ
app.use(
  helmet({
    // 画像タイル等のクロスオリジン表示を阻害しない
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 3) JSON ボディ上限（既定 100kb → 1MB）
app.use(express.json({ limit: '1mb' }));

// 4) CORS（プリフライト含む）
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWLIST.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
// 明示的に OPTIONS にも応答（念のため）
app.options('*', cors());

// 5) レート制限（OPTIONS/ヘルスチェックは除外）
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS' || req.path === '/healthz',
  })
);

// 6) ヘルスチェック
app.get('/healthz', (_req: Request, res: Response) => res.status(200).send('ok'));

// --------------------- ここから API 本体 ---------------------

// 例: ツリー検索（最大500件）
app.get('/trees/search', requireAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await db.collection('trees').limit(500).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// 作業日報の登録
app.post('/reports', requireAuth, validateBody(ReportSchema), async (req: Request, res: Response) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user!.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('reports').add(payload);
    res.json({ id: doc.id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// 作業計画の登録
app.post('/plans', requireAuth, validateBody(PlanSchema), async (req: Request, res: Response) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user!.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('plans').add(payload);
    res.json({ id: doc.id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// --------------------- 共通ハンドラ ---------------------

// 404（未定義ルート）
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});

// エラーハンドラ（CORS 等の throw をここで最終処理）
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS rejected' });
  }
  // 予期しない例外
  return res.status(500).json({ error: err?.message ?? 'internal error' });
});

// --- Firebase Functions エクスポート（リージョン：東京） ---
export const api = functions.region('asia-northeast1').https.onRequest(app);
