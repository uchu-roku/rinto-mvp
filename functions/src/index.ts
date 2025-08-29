// functions/src/index.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// --- 自作ミドルウェア／スキーマ（既存前提） ---
import { requireAuth } from './mw/auth';
import { validateBody } from './mw/validate';
import { ReportSchema, PlanSchema, TrackSchema } from './schemas';

// --- 型拡張（requireAuth により req.user が付与される前提） ---
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

// --- Admin 初期化 ---
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// --- CORS 許可オリジン（基本設計の想定URL） ---
const ALLOWLIST = [
  'http://localhost:5173',
  'https://rinto-mvp.web.app',
  'https://rinto-mvp.firebaseapp.com',
];

// --- レイヤ設定（外部設計に合わせた最小キーを提供。値は環境変数で上書き可） ---
const LAYER_CONFIG = {
  dem: process.env.TILES_DEM_URL ?? 'https://tiles.example.com/dem/{z}/{x}/{y}.png',
  slope: process.env.TILES_SLOPE_URL ?? 'https://tiles.example.com/slope/{z}/{x}/{y}.png',
  canopy_surface:
    process.env.TILES_CANOPY_SURFACE_URL ?? 'https://tiles.example.com/canopy_surface/{z}/{x}/{y}.png',
  relative_stem_distance_ratio:
    process.env.TILES_RSDR_URL ?? 'https://tiles.example.com/rsdr/{z}/{x}/{y}.png',
  orthophoto:
    process.env.TILES_ORTHO_URL ?? 'https://tiles.example.com/orthophoto/{z}/{x}/{y}.jpg',
  contour: process.env.TILES_CONTOUR_URL ?? 'https://tiles.example.com/contour/{z}/{x}/{y}.png',
  // ベクタ（将来のMVT/PostGIS想定）:
  species_polygon: process.env.MVT_SPECIES_URL ?? 'https://tiles.example.com/mvt/species/{z}/{x}/{y}.pbf',
};

// --- Express 構築 ---
const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '1mb' }));

// CORS
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWLIST.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
app.options('*', cors());

// レート制限（ヘルス＆OPTIONS除外）
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS' || req.path === '/healthz',
  })
);

// ヘルスチェック
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/* =========================================================
 * 1) 設計準拠：レイヤ設定（事前DL/PWA 初期化用）
 * ---------------------------------------------------------
 * GET /config/layers  -> { dem, slope, canopy_surface, ... }
 * =======================================================*/
app.get('/config/layers', requireAuth, (_req, res) => {
  res.json({ layers: LAYER_CONFIG });
});

/* =========================================================
 * 2) 樹木検索（MVP最小）
 * ---------------------------------------------------------
 * GET /trees/search?species=&height_min=&height_max=&dbh_min=&dbh_max=&limit=
 * Firestore 制約により複雑条件は部分対応：
 *  - height_m での範囲検索を優先（複合は in-memory フィルタ）
 *  - species は等価一致（複数指定はカンマ区切り）
 * =======================================================*/
app.get('/trees/search', requireAuth, async (req, res) => {
  try {
    const {
      species,
      height_min,
      height_max,
      dbh_min,
      dbh_max,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>;

    const limitNum = Math.min(Math.max(parseInt(limitStr ?? '500', 10) || 500, 1), 2000);

    let q: FirebaseFirestore.Query = db.collection('trees');
    // Firestore のクエリ都合で height_m を inequality の主軸に
    if (height_min) q = q.where('height_m', '>=', Number(height_min));
    if (height_max) q = q.where('height_m', '<=', Number(height_max));
    if (species) {
      // カンマ区切り指定 → ひとまず単一 equal のみに対応（複数は in-memory）
      const list = species.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) {
        q = q.where('species', '==', list[0]);
      }
    }
    q = q.limit(limitNum);

    const snap = await q.get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // 複合条件の in-memory フィルタ（height はクエリ済みなので DBH だけ見る）
    const dbhMin = dbh_min ? Number(dbh_min) : undefined;
    const dbhMax = dbh_max ? Number(dbh_max) : undefined;
    if (dbhMin != null) items = items.filter((x: any) => (x.dbh_cm ?? 0) >= dbhMin);
    if (dbhMax != null) items = items.filter((x: any) => (x.dbh_cm ?? 0) <= dbhMax);

    // species 複数対応の in-memory
    if (species) {
      const list = species.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length > 1) {
        const set = new Set(list);
        items = items.filter((x: any) => set.has(String(x.species ?? '')));
      }
    }

    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

/* =========================================================
 * 3) 施業計画（一覧・登録・更新）
 * ---------------------------------------------------------
 * GET  /plans                      -> 一覧（最新50件）
 * POST /plans                      -> 新規登録
 * PATCH /plans/:id                 -> 一部更新（status_pct 等）
 * =======================================================*/
app.get('/plans', requireAuth, async (req, res) => {
  try {
    const limitNum = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const snap = await db.collection('plans').orderBy('created_at', 'desc').limit(limitNum).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

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

app.patch('/plans/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    // 設計で更新対象として明記されたキーのみ許可
    const ALLOWED_KEYS = new Set([
      'status_pct',
      'period_actual_start',
      'period_actual_end',
      'assignee',
      'task_type',
      'target_volume',
      'geom', // ポリゴン修正可
    ]);
    const body: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (ALLOWED_KEYS.has(k)) body[k] = v;
    }
    if (Object.keys(body).length === 0) return res.status(400).json({ error: 'no updatable fields' });

    body.updated_by = req.user!.uid;
    body.updated_at = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('plans').doc(id).set(body, { merge: true });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

/* =========================================================
 * 4) 日報／トラック（現地活用：事前DL/GPS/日報）
 * ---------------------------------------------------------
 * POST /reports（＝work_reports 相当：名称は実装都合で "reports" に統一）
 * POST /work_reports  -> 互換エイリアス（同じコレクションに保存）
 * POST /tracks        -> 軌跡ライン保存
 * =======================================================*/
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

// 外部設計の用語に合わせた互換ルート（保存先は reports）
app.post('/work_reports', requireAuth, validateBody(ReportSchema), async (req: Request, res: Response) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user!.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('reports').add(payload);
    res.json({ id: doc.id, alias: 'work_reports' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// 軌跡
app.post('/tracks', requireAuth, validateBody(TrackSchema), async (req: Request, res: Response) => {
  try {
    const payload = {
      ...req.body, // { report_id, geom(LineString), start, end, length_m }
      created_by: req.user!.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('tracks').add(payload);
    res.json({ id: doc.id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

/* =========================================================
 * 5) 事前DL（オフラインバンドル）プレースホルダ
 * ---------------------------------------------------------
 * POST /offline/bundle { area, layers:[...] }
 *  将来：MVT/COG を ZIP で生成（titiler/PostGIS 連携）。現状は 501 を返す。
 * =======================================================*/
app.post('/offline/bundle', requireAuth, async (req: Request, res: Response) => {
  try {
    const { area, layers } = req.body ?? {};
    if (!area || !Array.isArray(layers)) {
      return res.status(400).json({ error: 'area and layers[] are required' });
    }
    return res.status(501).json({
      error: 'not implemented',
      note:
        'MVP段階ではクライアント側のIndexedDBへ段階的DLを推奨。将来は titiler/PostGIS によりZIP生成へ切替予定。',
      requested: { area, layers },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

/* =========================================================
 * （P1想定）断面図・支障木解析などの解析系 API は PostGIS/PDAL 連携の段で追加
 * =======================================================*/

// 404
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// 共通エラーハンドラ（CORS例外など）
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS rejected' });
  }
  return res.status(500).json({ error: err?.message ?? 'internal error' });
});

// Functions エクスポート（東京）
export const api = functions.region('asia-northeast1').https.onRequest(app);
