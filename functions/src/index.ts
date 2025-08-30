// functions/src/index.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

// --- 自作ミドルウェア／スキーマ ---
import { requireAuth } from "./mw/auth";
import { validateBody } from "./mw/validate";
import {
  ReportSchema,
  PlanSchema,
  TrackSchema,
  TreesSearchQuerySchema,
  PlansListQuerySchema,
} from "./schemas";

// --- 型拡張（requireAuth により req.user が付与される前提） ---
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken & { org_id?: string };
    }
  }
}

// --- Admin 初期化 ---
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// --- CORS 許可オリジン ---
const ALLOWLIST = [
  "http://localhost:5173",
  "https://rinto-mvp.web.app",
  "https://rinto-mvp.firebaseapp.com",
];

// --- レイヤ設定（環境変数で上書き可） ---
const LAYER_CONFIG = {
  dem: process.env.TILES_DEM_URL ?? "https://tiles.example.com/dem/{z}/{x}/{y}.png",
  slope: process.env.TILES_SLOPE_URL ?? "https://tiles.example.com/slope/{z}/{x}/{y}.png",
  canopy_surface:
    process.env.TILES_CANOPY_SURFACE_URL ??
    "https://tiles.example.com/canopy_surface/{z}/{x}/{y}.png",
  relative_stem_distance_ratio:
    process.env.TILES_RSDR_URL ?? "https://tiles.example.com/rsdr/{z}/{x}/{y}.png",
  orthophoto:
    process.env.TILES_ORTHO_URL ?? "https://tiles.example.com/orthophoto/{z}/{x}/{y}.jpg",
  contour: process.env.TILES_CONTOUR_URL ?? "https://tiles.example.com/contour/{z}/{x}/{y}.png",
  // ベクタ（将来のMVT/PostGIS想定）
  species_polygon:
    process.env.MVT_SPECIES_URL ?? "https://tiles.example.com/mvt/species/{z}/{x}/{y}.pbf",
} as const;
type LayerKey = keyof typeof LAYER_CONFIG;

// --- Express 構築 ---
const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(express.json({ limit: "1mb" }));

// CORS
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWLIST.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
app.options("*", cors());

// レート制限（ヘルス＆OPTIONS除外）
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || req.path === "/healthz",
  })
);

// ヘルスチェック（認証不要）
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/* =========================================================
 * ルータを / と /api の両方にマウント（互換のため）
 * =======================================================*/
const router = express.Router();

/* =========================================================
 * 1) レイヤ設定
 * =======================================================*/
router.get("/config/layers", requireAuth, (_req, res) => {
  res.json({ layers: LAYER_CONFIG });
});

/* =========================================================
 * 2) 樹木検索（MVP）
 * =======================================================*/
router.get("/trees/search", requireAuth, async (req, res) => {
  try {
    const qv = TreesSearchQuerySchema.parse(req.query);
    const { species, height_min, height_max, dbh_min, dbh_max, limit } = qv;

    let q: FirebaseFirestore.Query = db.collection("trees");
    if (height_min != null) q = q.where("height_m", ">=", height_min);
    if (height_max != null) q = q.where("height_m", "<=", height_max);

    // species 単一は Firestore、複数は in-memory
    if (species && !species.includes(",")) {
      q = q.where("species", "==", species);
    }

    q = q.limit(limit ?? 500);

    const snap = await q.get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (dbh_min != null) items = items.filter((x: any) => (x.dbh_cm ?? 0) >= dbh_min);
    if (dbh_max != null) items = items.filter((x: any) => (x.dbh_cm ?? 0) <= dbh_max);
    if (species && species.includes(",")) {
      const set = new Set(species.split(",").map((s) => s.trim()).filter(Boolean));
      items = items.filter((x: any) => set.has(String(x.species ?? "")));
    }

    res.json({ items });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "bad request" });
  }
});

/* =========================================================
 * 3) 施業計画（一覧・登録・更新・削除）
 * =======================================================*/
// GET /plans
router.get("/plans", requireAuth, async (req, res) => {
  try {
    const qv = PlansListQuerySchema.parse(req.query);
    const limitNum = qv.limit ?? 50;

    const orgId = req.user?.org_id;
    let q: FirebaseFirestore.Query = db.collection("plans");
    if (orgId) q = q.where("org_id", "==", orgId);
    q = q.orderBy("created_at", "desc").limit(limitNum);

    const snap = await q.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "bad request" });
  }
});

// POST /plans
router.post(
  "/plans",
  requireAuth,
  validateBody(PlanSchema),
  async (req: Request, res: Response) => {
    try {
      const claimOrg = req.user?.org_id;
      if (claimOrg && claimOrg !== req.body.org_id) {
        return res.status(403).json({ error: "org_id mismatch" });
      }
      const payload = {
        ...req.body,
        created_by: req.user!.uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      const doc = await db.collection("plans").add(payload);
      res.status(201).json({ id: doc.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "internal error" });
    }
  }
);

// PATCH /plans/:id
router.patch("/plans/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const ref = db.collection("plans").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "plan not found" });
    const docData = snap.data() as any;
    const claimOrg = req.user?.org_id;
    if (claimOrg && docData?.org_id && docData.org_id !== claimOrg) {
      return res.status(403).json({ error: "forbidden" });
    }

    // 許可キーのみ
    const ALLOWED_KEYS = new Set([
      "name",
      "status_pct",
      "assignee",
      "task_type",
      "period_from",
      "period_to",
      "target_volume",
      "geom",
    ]);
    const body: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (ALLOWED_KEYS.has(k)) body[k] = v;
    }
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: "no updatable fields" });
    }

    // 進捗は 0..100 にクランプ
    if (typeof body.status_pct === "number") {
      body.status_pct = Math.max(0, Math.min(100, body.status_pct));
    }
    // 期間整合（両方あるとき）
    if (typeof body.period_from === "string" && typeof body.period_to === "string") {
      const from = new Date(body.period_from);
      const to = new Date(body.period_to);
      if (Number.isNaN(+from) || Number.isNaN(+to) || from > to) {
        return res
          .status(400)
          .json({ error: "invalid period (period_from must be <= period_to)" });
      }
    }

    body.updated_by = req.user!.uid;
    body.updated_at = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(body, { merge: true });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "internal error" });
  }
});

// DELETE /plans/:id
router.delete("/plans/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const ref = db.collection("plans").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "plan not found" });

    const data = snap.data() as any;
    const planOrg = data?.org_id as string | undefined;
    if (planOrg && req.user?.org_id && planOrg !== req.user.org_id) {
      return res.status(403).json({ error: "forbidden" });
    }

    await ref.delete();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "internal error" });
  }
});

/* =========================================================
 * 4) 日報／トラック
 * =======================================================*/
router.post(
  "/reports",
  requireAuth,
  validateBody(ReportSchema),
  async (req: Request, res: Response) => {
    try {
      const claimOrg = req.user?.org_id;
      if (claimOrg && claimOrg !== req.body.org_id) {
        return res.status(403).json({ error: "org_id mismatch" });
      }
      const payload = {
        ...req.body,
        created_by: req.user!.uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      const doc = await db.collection("reports").add(payload);
      res.status(201).json({ id: doc.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "internal error" });
    }
  }
);

// 外部設計の用語に合わせた互換ルート（保存先は reports）
router.post(
  "/work_reports",
  requireAuth,
  validateBody(ReportSchema),
  async (req: Request, res: Response) => {
    try {
      const claimOrg = req.user?.org_id;
      if (claimOrg && claimOrg !== req.body.org_id) {
        return res.status(403).json({ error: "org_id mismatch" });
      }
      const payload = {
        ...req.body,
        created_by: req.user!.uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      const doc = await db.collection("reports").add(payload);
      res.status(201).json({ id: doc.id, alias: "work_reports" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "internal error" });
    }
  }
);

// 軌跡
router.post(
  "/tracks",
  requireAuth,
  validateBody(TrackSchema),
  async (req: Request, res: Response) => {
    try {
      const payload = {
        ...req.body, // { report_id, geom(LineString), start, end, length_m }
        created_by: req.user!.uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      const doc = await db.collection("tracks").add(payload);
      res.status(201).json({ id: doc.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "internal error" });
    }
  }
);

/* =========================================================
 * 5) 事前DL（オフラインバンドル）
 * 入力: { bbox:{minLng,minLat,maxLng,maxLat}, zmin, zmax, layers[], limit? }
 * 返却: { urls, count, by_layer, tiles }
 * =======================================================*/
const BBOX = z
  .object({
    minLng: z.number().gte(-180).lte(180),
    minLat: z.number().gte(-85.0511).lte(85.0511),
    maxLng: z.number().gte(-180).lte(180),
    maxLat: z.number().gte(-85.0511).lte(85.0511),
  })
  .refine((b) => b.maxLat > b.minLat, { message: "maxLat must be > minLat" });

const OfflineBundleSchema = z
  .object({
    bbox: BBOX,
    zmin: z.number().int().min(0).max(22),
    zmax: z.number().int().min(0).max(22),
    layers: z.array(z.string()).min(1),
    limit: z.number().int().min(1).max(200_000).optional(), // 返却するURL上限（任意）
  })
  .refine((v) => v.zmax >= v.zmin, { message: "zmax must be >= zmin" })
  .transform((v) => ({
    ...v,
    limit: v.limit ?? 30_000, // 既定上限
  }));

// 経度→X タイル、緯度→Y タイル（WebMercator）
function lngLatToTileXY(lng: number, lat: number, z: number) {
  const latClamped = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  // wrap X/Y
  const xWrapped = ((x % n) + n) % n;
  const yClamped = Math.max(0, Math.min(n - 1, y));
  return { x: xWrapped, y: yClamped };
}

// bbox をズーム z のタイル範囲へ
function tilesForBBox(b: z.infer<typeof BBOX>, z: number) {
  const splitByIDL =
    b.minLng <= b.maxLng
      ? [{ minLng: b.minLng, maxLng: b.maxLng }]
      : [
          { minLng: -180, maxLng: b.maxLng },
          { minLng: b.minLng, maxLng: 180 },
        ];
  const parts: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  for (const part of splitByIDL) {
    const a = lngLatToTileXY(part.minLng, b.maxLat, z); // NW
    const c = lngLatToTileXY(part.maxLng, b.minLat, z); // SE
    parts.push({
      x0: Math.min(a.x, c.x),
      x1: Math.max(a.x, c.x),
      y0: Math.min(a.y, c.y),
      y1: Math.max(a.y, c.y),
    });
  }
  return parts;
}

router.post(
  "/offline/bundle",
  requireAuth,
  validateBody(OfflineBundleSchema),
  async (req: Request, res: Response) => {
    try {
      const { bbox, zmin, zmax, layers, limit } = req.body as z.infer<
        typeof OfflineBundleSchema
      >;

      // レイヤ検証 & 解決
      const bad = (layers as string[]).filter((k) => !(k in LAYER_CONFIG));
      if (bad.length) {
        return res.status(400).json({ error: `unknown layer(s): ${bad.join(", ")}` });
      }
      const lk = layers as LayerKey[];

      // タイル列挙
      const tiles: Array<{ z: number; x: number; y: number }> = [];
      const seen = new Set<string>();
      for (let z = zmin; z <= zmax; z++) {
        for (const r of tilesForBBox(bbox, z)) {
          for (let x = r.x0; x <= r.x1; x++) {
            for (let y = r.y0; y <= r.y1; y++) {
              const key = `${z}/${x}/${y}`;
              if (!seen.has(key)) {
                seen.add(key);
                tiles.push({ z, x, y });
                if (tiles.length * lk.length > limit) {
                  return res.status(413).json({
                    error: "too many tiles",
                    note: `The request would generate more than ${limit} URLs. Shrink bbox or z-range, or raise 'limit'.`,
                    estimated_urls: tiles.length * lk.length,
                  });
                }
              }
            }
          }
        }
      }

      // URL 生成
      const urls: string[] = [];
      const by_layer: Record<string, number> = {};
      for (const layer of lk) {
        const pattern = LAYER_CONFIG[layer];
        let count = 0;
        for (const t of tiles) {
          urls.push(
            pattern
              .replace("{z}", String(t.z))
              .replace("{x}", String(t.x))
              .replace("{y}", String(t.y))
          );
          count++;
        }
        by_layer[layer] = count;
      }

      res.json({
        count: urls.length,
        by_layer,
        tiles: tiles.length,
        urls,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "internal error" });
    }
  }
);

/* =========================================================
 * 404 / 共通エラー
 * =======================================================*/
router.use((_req, res) => res.status(404).json({ error: "not found" }));

app.use("/", router);
app.use("/api", router);

// 共通エラーハンドラ（CORS 例外など）
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS rejected" });
  }
  return res.status(500).json({ error: err?.message ?? "internal error" });
});

// Functions エクスポート（東京）
export const api = functions.region("asia-northeast1").https.onRequest(app);
