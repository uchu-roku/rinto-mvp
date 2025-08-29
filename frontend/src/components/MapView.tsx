// frontend/src/components/MapView.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L, { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import { createRoot } from "react-dom/client";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../lib/firebase";

import TreeDetail from "./TreeDetail";
import LayerSwitcher from "./map/LayerSwitcher";
import OpacitySlider from "./map/OpacitySlider";
import TreePopup from "./map/TreePopup";
import SearchDrawer, { type Filters } from "./search/SearchDrawer";

// ── 共通定数 ──────────────────────────────────────────────────────
const SPECIES_COLORS: Record<string, string> = {
  スギ: "#3b7",
  ヒノキ: "#2a6",
  カラマツ: "#c84",
  トドマツ: "#58c",
  エゾマツ: "#26a",
  その他: "#888",
};

// 画面上部のアプリヘッダー高さ相当（重なり回避用）
const HEADER_OFFSET = 56;

// 初期表示範囲
const INITIAL_BOUNDS: LatLngBoundsExpression = [
  [41.7, 140.6],
  [41.9, 140.9],
] as const;

// ── 型 ─────────────────────────────────────────────────────────
type Tree = {
  id: string;
  lat: number;
  lng: number;
  species?: string;
  dbh?: number | null;
  height?: number | null;
  volume?: number | null;
};

// ── ユーティリティ（画面幅監視） ───────────────────────────────
function useWindowSize() {
  const [w, setW] = useState<number>(typeof window === "undefined" ? 1024 : window.innerWidth);
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return w;
}

// ── ビュー記憶（戻り防止） ─────────────────────────────────────
const VIEW_KEY = "rinto:last_view";
function ViewMemory({ initial }: { initial: LatLngBoundsExpression }) {
  const map = useMap();
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!restoredRef.current) {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw) {
        try {
          const { lat, lng, z } = JSON.parse(raw);
          if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(z)) {
            map.setView([lat, lng], z);
          } else {
            map.fitBounds(initial);
          }
        } catch {
          map.fitBounds(initial);
        }
      } else {
        map.fitBounds(initial);
      }
      restoredRef.current = true;
    }
    const save = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, z }));
    };
    map.on("moveend", save);
    return () => map.off("moveend", save);
  }, [map, initial]);

  return null;
}

// ── ステータスバー ──────────────────────────────────────────────
function StatusBar() {
  const map = useMap();
  const [latlng, setLatlng] = useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const [zoom, setZoom] = useState(map.getZoom());
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const onMove = (e: L.LeafletMouseEvent) => setLatlng(e.latlng);
    const onZoom = () => setZoom(map.getZoom());
    map.on("mousemove", onMove);
    map.on("zoomend", onZoom);
    const onl = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", onl);
    window.addEventListener("offline", off);
    return () => {
      map.off("mousemove", onMove);
      map.off("zoomend", onZoom);
      window.removeEventListener("online", onl);
      window.removeEventListener("offline", off);
    };
  }, [map]);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 28,
        background: "rgba(255,255,255,.9)",
        borderTop: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 12px",
        zIndex: 1000,
      }}
    >
      <span>📍 {latlng.lat.toFixed(5)}, {latlng.lng.toFixed(5)}</span>
      <span>🔎 z{zoom}</span>
      <span>● {online ? "オンライン" : "オフライン"}</span>
    </div>
  );
}

// ── スケールバー ──────────────────────────────────────────────
function ScaleControl() {
  const map = useMap();
  useEffect(() => {
    const ctrl = L.control.scale({ metric: true, imperial: false });
    ctrl.addTo(map);
    return () => (map as any).removeControl(ctrl);
  }, [map]);
  return null;
}

// ── TreesLayer（単木描画 + 集計 + 左上カード） ────────────────
function TreesLayer({
  filters,
  onFeaturesChange,
  initialBounds,
  drawerOpen,
  leftOffset,           // ドロワー状況に応じて親から渡す
}: {
  filters: Filters;
  onFeaturesChange: (features: any[]) => void;
  initialBounds: LatLngBoundsExpression;
  drawerOpen: boolean;
  leftOffset: number;
}) {
  const map = useMap();

  const layerRef = useRef<L.GeoJSON | null>(null);
  const canvasRendererRef = useRef<L.Canvas>(L.canvas());
  const drawGroupRef = useRef<L.FeatureGroup | null>(null);
  const allTreesRef = useRef<Tree[] | null>(null);

  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Tree | null>(null);
  const selectedId = selected?.id ?? null;

  const [areaStats, setAreaStats] = useState<{ count: number; avgDbh: number | null; avgHeight: number | null }>({
    count: 0,
    avgDbh: null,
    avgHeight: null,
  });

  // Firestore 初回ロード
  const ensureTrees = async (): Promise<Tree[]> => {
    if (allTreesRef.current) return allTreesRef.current;
    const q = query(collection(db, "trees"), limit(5000));
    const snap = await getDocs(q);
    const rows: Tree[] = snap.docs
      .map((d) => {
        const p: any = d.data();
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: String(p.tree_id ?? d.id ?? ""),
          lat, lng,
          species: p.species,
          dbh: p.dbh_cm != null ? Number(p.dbh_cm) : null,
          height: p.height_m != null ? Number(p.height_m) : null,
          volume: p.volume_m3 != null ? Number(p.volume_m3) : null,
        };
      })
      .filter((t): t is Tree => !!t);
    allTreesRef.current = rows;
    return rows;
  };

  // フィルタ適用
  const applyFilters = (trees: Tree[], f: Filters): Tree[] => {
    const mh = f.minHeight ?? null;
    const xh = f.maxHeight ?? null;
    const md = f.minDbh ?? null;
    const xd = f.maxDbh ?? null;
    const sp = (f.species ?? []).filter(Boolean);
    return trees.filter((t) => {
      if (mh !== null && !(typeof t.height === "number" && t.height >= mh)) return false;
      if (xh !== null && !(typeof t.height === "number" && t.height <= xh)) return false;
      if (md !== null && !(typeof t.dbh === "number" && t.dbh >= md)) return false;
      if (xd !== null && !(typeof t.dbh === "number" && t.dbh <= xd)) return false;
      if (sp.length && (!t.species || !sp.includes(t.species))) return false;
      return true;
    });
  };

  // レイヤ再構築
  const reload = async () => {
    setSelected(null);
    setLoading(true);
    try {
      const b = map.getBounds();
      const [minLng, minLat, maxLng, maxLat] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const all = await ensureTrees();
      const inBox = all.filter((t) => t.lng >= minLng && t.lng <= maxLng && t.lat >= minLat && t.lat <= maxLat);
      const filtered = applyFilters(inBox, filters);

      const MAX_DRAW = 3000;
      const step = filtered.length > MAX_DRAW ? Math.ceil(filtered.length / MAX_DRAW) : 1;
      const draw = filtered.filter((_, i) => i % step === 0);

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      const fc = {
        type: "FeatureCollection" as const,
        features: draw.map((t) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [t.lng, t.lat] },
          properties: {
            tree_id: t.id,
            species: t.species,
            dbh_cm: t.dbh,
            height_m: t.height,
            volume_m3: t.volume,
            lon: t.lng,
            lat: t.lat,
          },
        })),
      };

      const lyr = L.geoJSON(fc, {
        renderer: canvasRendererRef.current,
        pointToLayer: (f: any, latlng) => {
          const p = f.properties ?? {};
          const isSel = selectedId && String(p.tree_id ?? "") === selectedId;
          const col = SPECIES_COLORS[p.species || "その他"] || "#0a7";
          return L.circleMarker(latlng, {
            radius: isSel ? 7 : 4,
            color: isSel ? "#e91e63" : col,
            weight: isSel ? 2 : 1,
          });
        },
        onEachFeature: (f, layer) => {
          const p: any = f.properties ?? {};
          const div = L.DomUtil.create("div");
          createRoot(div).render(
            <TreePopup
              data={{
                tree_id: p.tree_id,
                species: p.species,
                height_m: p.height_m,
                dbh_cm: p.dbh_cm,
                volume_m3: p.volume_m3,
                lon: p.lon,
                lat: p.lat,
              }}
            />
          );
          layer.bindPopup(div);
          layer.on("click", () => {
            const [lng, lat] = (f.geometry as any).coordinates;
            setSelected({
              id: String(p.tree_id ?? ""),
              lat, lng,
              species: p.species,
              dbh: p.dbh_cm,
              height: p.height_m,
              volume: p.volume_m3,
            });
          });
        },
      }).addTo(map);

      layerRef.current = lyr;
      setCount(filtered.length);
      onFeaturesChange(fc.features);
    } finally {
      setLoading(false);
    }
  };

  // 選択ハイライト更新
  useEffect(() => {
    const l = layerRef.current;
    if (!l) return;
    l.eachLayer((layer: any) => {
      const p = layer.feature?.properties ?? {};
      const isSel = selectedId && String(p.tree_id ?? "") === selectedId;
      const col = SPECIES_COLORS[p.species || "その他"] || "#0a7";
      layer.setStyle?.({
        radius: isSel ? 7 : 4,
        color: isSel ? "#e91e63" : col,
        weight: isSel ? 2 : 1,
      });
      if (isSel) layer.bringToFront?.();
    });
  }, [selectedId]);

  // 描画（多角形/矩形）で集計
  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    const drawControl = new (L.Control as any).Draw({
      draw: { polygon: true, rectangle: true, polyline: false, circle: false, marker: false, circlemarker: false },
      edit: { featureGroup: drawnItems, edit: false, remove: true },
    });
    drawGroupRef.current = drawnItems;
    map.addLayer(drawnItems);
    map.addControl(drawControl);

    const onCreated = (e: any) => {
      const shape = e.layer;
      drawnItems.clearLayers();
      drawnItems.addLayer(shape);

      const features = (layerRef.current?.toGeoJSON() as any)?.features ?? [];
      const inside = (lat: number, lng: number) => {
        if (shape.getBounds) return shape.getBounds().contains(L.latLng(lat, lng));
        if (shape.getLatLngs) {
          const latlngs = (shape.getLatLngs()?.[0] ?? []) as L.LatLng[];
          // 射線法
          const poly: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
          let x = lng, y = lat, ok = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][1], yi = poly[i][0];
            const xj = poly[j][1], yj = poly[j][0];
            const denom = yj - yi || 1e-12;
            const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / denom + xi;
            if (intersect) ok = !ok;
          }
          return ok;
        }
        return false;
      };

      const picked = features.filter((f: any) => {
        const [lng, lat] = f.geometry?.coordinates || [null, null];
        return Number.isFinite(lat) && Number.isFinite(lng) && inside(lat as number, lng as number);
      });

      const props = picked.map((f: any) => f.properties || {});
      const num = (xs: any[]) => xs.map(Number).filter((n) => Number.isFinite(n));
      const avg = (xs: number[]) => (xs.length ? Math.round(((xs.reduce((a, b) => a + b, 0) / xs.length) + Number.EPSILON) * 10) / 10 : null);

      setAreaStats({
        count: props.length,
        avgDbh: avg(num(props.map((p: any) => p.dbh_cm))),
        avgHeight: avg(num(props.map((p: any) => p.height_m))),
      });
    };

    const onDeleted = () => setAreaStats({ count: 0, avgDbh: null, avgHeight: null });

    map.on((L as any).Draw.Event.CREATED, onCreated);
    map.on((L as any).Draw.Event.DELETED, onDeleted);

    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated);
      map.off((L as any).Draw.Event.DELETED, onDeleted);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map]);

  // 初回＋パン/ズームで再構築（デバウンス）
  useEffect(() => {
    let t: any;
    const debounced = () => { clearTimeout(t); t = setTimeout(reload, 150); };
    reload();
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    return () => {
      clearTimeout(t);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // CSV出力
  const exportCsv = () => {
    if (!layerRef.current) return;
    const gj = layerRef.current.toGeoJSON() as any;
    const rows = (gj.features || []).map((f: any) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry?.coordinates || [null, null];
      return {
        id: p.tree_id ?? "", lat, lng,
        species: p.species ?? "",
        dbh_cm: p.dbh_cm ?? "",
        height_m: p.height_m ?? "",
        volume_m3: p.volume_m3 ?? "",
      };
    });
    const headers = ["id", "lat", "lng", "species", "dbh_cm", "height_m", "volume_m3"];
    const csv =
      headers.join(",") + "\n" +
      rows.map((r) => headers.map((h) => JSON.stringify((r as any)[h] ?? "")).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "trees.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── UI：左上カード（ヘッダー下・ドロワー退避） ───────────────
  const topOffset = HEADER_OFFSET + 8;

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: topOffset,
          left: leftOffset,
          background: "#fff",
          padding: 8,
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          zIndex: 1000,
          transition: "left .18s ease",
        }}
      >
        <div>表示本数: {count}{loading ? "（更新中…）" : ""}</div>
        <button
          onClick={() => {
            if (!layerRef.current) return;
            const features = (layerRef.current.toGeoJSON() as any)?.features ?? [];
            const props = features.map((f: any) => f.properties || {});
            const num = (xs: any[]) => xs.map(Number).filter((n) => Number.isFinite(n));
            const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
            const count = props.length;
            const avg_height = avg(num(props.map((p: any) => p.height_m)));
            const avg_dbh = avg(num(props.map((p: any) => p.dbh_cm)));
            const sum_volume = num(props.map((p: any) => p.volume_m3)).reduce((a: number, b: number) => a + b, 0);
            alert(`本数:${count}\n平均樹高:${avg_height.toFixed(2)}m\n平均DBH:${avg_dbh.toFixed(1)}cm\n総材積:${sum_volume.toFixed(2)}m³`);
          }}
          title="現在の表示範囲を集計"
        >
          現在範囲で集計
        </button>
        <button onClick={exportCsv} title="表示中の単木をCSV出力 (E)" aria-label="CSV出力">CSV出力</button>
        <button onClick={() => map.locate({ enableHighAccuracy: true })} title="現在地へ移動 (L)" aria-label="現在地へ">📍</button>
        <button onClick={() => map.fitBounds(initialBounds)} title="初期表示に戻る (H)" aria-label="初期表示に戻る">🏠</button>
      </div>

      {/* 左下：描画範囲の集計結果（ドロワーに応じて右へ退避） */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: leftOffset, // ★ ドロワーオフセットを共有
          background: "#fff",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #ddd",
          boxShadow: "0 10px 20px rgba(0,0,0,.08)",
          zIndex: 1000,
          transition: "left .18s ease",
        }}
      >
        <div>選択本数: <b>{areaStats.count}</b></div>
        <div>平均DBH: <b>{areaStats.avgDbh ?? "—"}</b></div>
        <div>平均樹高: <b>{areaStats.avgHeight ?? "—"}</b></div>
        <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              drawGroupRef.current?.clearLayers();
              setAreaStats({ count: 0, avgDbh: null, avgHeight: null });
            }}
            title="選択領域をクリア"
          >
            クリア
          </button>
        </div>
      </div>

      {/* Draw ツールバーのオフセット（ヘッダー + ドロワー） */}
      <style>{`
        .leaflet-top.leaflet-left .leaflet-draw-toolbar {
          margin-top: ${HEADER_OFFSET + 8}px;
          margin-left: ${leftOffset}px;
        }
        @media (max-width: 768px) {
          .leaflet-top.leaflet-left .leaflet-draw-toolbar { margin-top: ${HEADER_OFFSET + 32}px; }
        }
      `}</style>

      {/* 単木詳細 */}
      <TreeDetail tree={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ── 親コンポーネント ───────────────────────────────────────────
export default function MapView() {
  const winW = useWindowSize();

  // ベース/オーバーレイ
  const [opacity, setOpacity] = useState(0.7);
  const [base, setBase] = useState([
    { id: "std", label: "標準地図", active: true },
    { id: "photo", label: "航空写真", active: false },
  ]);
  const [overlays, setOverlays] = useState([{ id: "slope", label: "傾斜", visible: false }]);
  const activeBase = base.find((b) => b.active)?.id ?? "std";

  // ドロワー・検索
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [features, setFeatures] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [helpOpen, setHelpOpen] = useState(false);

  const speciesOptions = useMemo(
    () => Array.from(new Set(features.map((f: any) => f.properties?.species).filter(Boolean))) as string[],
    [features]
  );

  // キーショートカット（UI系）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e as any).isComposing) return;
      const k = e.key.toLowerCase();
      if (k === "f") setDrawerOpen(true);
      if (k === "?") setHelpOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ドロワーの実効幅（重なり回避用）。モバイルはオーバーレイ表示が多いので退避なし。
  const drawerWidth = useMemo(() => {
    if (!drawerOpen) return 0;
    if (winW < 900) return 0; // スモール画面はオーバーレイ想定：退避しない
    // デスクトップ：画面幅の約 26% を目安に 300〜380px
    return Math.max(300, Math.min(380, Math.round(winW * 0.26)));
  }, [drawerOpen, winW]);

  // 左系UIのオフセット（ヘッダー分 + ドロワー分）
  const leftOffset = 8 + (drawerWidth ? drawerWidth + 12 : 0);

  // Drawツールバーをヘッダーから下げるベースCSS（動的 left は TreesLayer 側で適用）
  const baseToolbarShim = `.leaflet-top.leaflet-left .leaflet-draw-toolbar { margin-top: ${HEADER_OFFSET + 8}px; }`;

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <style>{baseToolbarShim}</style>

      <MapContainer style={{ height: "100%" }} preferCanvas>
        <ViewMemory initial={INITIAL_BOUNDS} />
        <ScaleControl />

        {activeBase === "std" && (
          <TileLayer url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png" attribution="&copy; 国土地理院" />
        )}
        {activeBase === "photo" && (
          <TileLayer url="https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg" attribution="&copy; 国土地理院 航空写真" />
        )}
        {overlays.find((o) => o.id === "slope")?.visible && (
          <TileLayer url="https://tile.example.com/slope/{z}/{x}/{y}.png" opacity={opacity} attribution="Slope demo" />
        )}

        <TreesLayer
          filters={filters}
          onFeaturesChange={setFeatures}
          initialBounds={INITIAL_BOUNDS}
          drawerOpen={drawerOpen}
          leftOffset={leftOffset}
        />
        <StatusBar />
      </MapContainer>

      {/* 右下：凡例 */}
      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,.95)",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          padding: 8,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>凡例</div>
        {(speciesOptions.length ? speciesOptions : Object.keys(SPECIES_COLORS)).map((sp) => (
          <div key={sp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                width: 16,
                height: 12,
                border: "1px solid #999",
                background: SPECIES_COLORS[sp] || SPECIES_COLORS["その他"],
              }}
            />
            <span style={{ fontSize: 13 }}>{sp}</span>
          </div>
        ))}
      </div>

      {/* 右上：レイヤ切替（ヘッダー分下げ） */}
      <LayerSwitcher
        bases={base}
        overlays={overlays}
        onChangeBase={(id) => setBase((bs) => bs.map((b) => ({ ...b, active: b.id === id })))}
        onToggleOverlay={(id, next) => setOverlays((os) => os.map((o) => (o.id === id ? { ...o, visible: next } : o)))}
        position="top-right"
        topOffset={HEADER_OFFSET + 8}
        footer={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <OpacitySlider value={opacity} onChange={setOpacity} label="透過" />
            <button
              onClick={() => setDrawerOpen(true)}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
              title="条件検索 (F)"
            >
              条件検索
            </button>
            <button
              onClick={() => setHelpOpen((v) => !v)}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
              title="ショートカット (?)"
            >
              ？
            </button>
          </div>
        }
      />

      {/* ショートカットヘルプ（ヘッダー分下げ） */}
      {helpOpen && (
        <div
          onClick={() => setHelpOpen(false)}
          style={{
            position: "absolute",
            right: 12,
            top: HEADER_OFFSET + 14,
            zIndex: 1100,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            boxShadow: "0 6px 24px rgba(0,0,0,.12)",
            padding: "10px 12px",
            width: 260,
            cursor: "default",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>ショートカット</div>
          <ul style={{ margin: 0, padding: "0 0 0 14px", lineHeight: 1.8 }}>
            <li><b>F</b>: 条件検索を開く</li>
            <li><b>L</b>: 現在地へ移動</li>
            <li><b>H</b>: 初期表示に戻る</li>
            <li><b>E</b>: 表示中の単木をCSV出力</li>
            <li><b>?</b>: このヘルプを表示/閉じる</li>
          </ul>
        </div>
      )}

      {/* 検索ドロワー */}
      <SearchDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        speciesOptions={speciesOptions}
        features={features}
        onApply={(fs) => { setFilters(fs); setDrawerOpen(false); }}
      />
    </div>
  );
}
