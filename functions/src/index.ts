import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// 型
type Tree = {
  tree_id: string;
  lat: number;
  lng: number;
  height_m: number;
  dbh_cm: number;
  volume_m3: number;
  species: string;
};

// 単木検索（簡易：bbox＋属性フィルタ）GeoJSON返却
app.get("/trees/search", async (req, res) => {
  try {
    const { min_h, max_h, min_dbh, max_dbh, species, bbox } =
      req.query as Record<string, string | undefined>;

    const snap = await db.collection("trees").limit(5000).get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as (Tree & { id: string })[];

    let [minLng, minLat, maxLng, maxLat] = [-180, -90, 180, 90];
    if (bbox) {
      const parts = bbox.split(",").map(Number);
      if (parts.length === 4) [minLng, minLat, maxLng, maxLat] = parts;
    }

    const hmin = min_h ? Number(min_h) : -Infinity;
    const hmax = max_h ? Number(max_h) : +Infinity;
    const dmin = min_dbh ? Number(min_dbh) : -Infinity;
    const dmax = max_dbh ? Number(max_dbh) : +Infinity;
    const sp = species?.trim().toLowerCase();

    const filtered = all.filter(
      (t) =>
        t.lng >= minLng &&
        t.lng <= maxLng &&
        t.lat >= minLat &&
        t.lat <= maxLat &&
        t.height_m >= hmin &&
        t.height_m <= hmax &&
        t.dbh_cm >= dmin &&
        t.dbh_cm <= dmax &&
        (!sp || t.species.toLowerCase() === sp)
    );

    const fc = {
      type: "FeatureCollection",
      features: filtered.map((t) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [t.lng, t.lat] },
        properties: {
          tree_id: t.tree_id,
          height_m: t.height_m,
          dbh_cm: t.dbh_cm,
          volume_m3: t.volume_m3,
          species: t.species,
        },
      })),
    };

    res.json(fc);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 範囲集計（bbox または geometry の bbox）
app.post("/trees/stats", async (req, res) => {
  try {
    const { geometry, bbox } = req.body || {};
    let b: [number, number, number, number] | null = null;

    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      b = [bbox[0], bbox[1], bbox[2], bbox[3]];
    } else if (geometry && geometry.type && geometry.coordinates) {
      const nums = JSON.stringify(geometry).match(/-?\d+\.?\d*/g)?.map(Number) || [];
      const xs: number[] = [],
        ys: number[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
      }
      b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    if (!b) return res.status(400).json({ error: "bbox or geometry required" });

    const [minLng, minLat, maxLng, maxLat] = b;
    const snap = await db.collection("trees").limit(5000).get();
    const all = snap.docs.map((d) => d.data() as Tree);
    const inside = all.filter(
      (t) => t.lng >= minLng && t.lng <= maxLng && t.lat >= minLat && t.lat <= maxLat
    );

    const count = inside.length;
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);

    const avg_height = avg(inside.map((x) => x.height_m));
    const avg_dbh = avg(inside.map((x) => x.dbh_cm));
    const sum_volume = sum(inside.map((x) => x.volume_m3));

    res.json({ count, avg_height, avg_dbh, sum_volume });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 施業計画
app.get("/plans", async (_req, res) => {
  const snap = await db.collection("plans").orderBy("period_planned_start", "desc").limit(200).get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

app.post("/plans", async (req, res) => {
  try {
    const data = req.body || {};
    data.created_at = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("plans").add(data);
    res.json({ id: ref.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// 日報
app.post("/reports", async (req, res) => {
  try {
    const data = req.body || {};
    data.created_at = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("work_reports").add(data);
    res.json({ id: ref.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export const api = functions.region("asia-northeast1").https.onRequest(app);
