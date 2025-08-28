// frontend/src/components/MapView.tsx
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L, { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

// 図形描画
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";

// React popup
import { createRoot } from "react-dom/client";

// Firestore 直読み（Hostingのみ構成対応）
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../lib/firebase";

// 右側の詳細パネル（既存）
import TreeDetail from "./TreeDetail";

// 納品済み部品
import LayerSwitcher from "./map/LayerSwitcher";
import OpacitySlider from "./map/OpacitySlider";
import TreePopup from "./map/TreePopup";
import SearchDrawer, { type Filters } from "./search/SearchDrawer";

// -------------------------------- 共有定数 --------------------------------
const SPECIES_COLORS: Record<string, string> = {
  "スギ": "#3b7",
  "ヒノキ": "#2a6",
  "カラマツ": "#c84",
  "トドマツ": "#58c",
  "エゾマツ": "#26a",
  "その他": "#888",
};

// ----------------------------- 型 -----------------------------
type Tree = {
  id: string;
  lat: number;
  lng: number;
  species?: string;
  dbh?: number | null;
  height?: number | null;
  volume?: number | null;
};

// ---------------------- StatusBar（地図用） ----------------------
function StatusBar() {
  const map = useMap() as any;
  const [latlng, setLatlng] = React.useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const [zoom, setZoom] = React.useState(map.getZoom());
  const [online, setOnline] = React.useState<boolean>(navigator.onLine);

  React.useEffect(() => {
    const onMove = (e: any) => setLatlng(map.mouseEventToLatLng(e.originalEvent));
    const onZoom = () => setZoom(map.getZoom());
    (map.getContainer() as HTMLElement).addEventListener("mousemove", onMove);
    map.on("zoomend", onZoom);
    const onl = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", onl); window.addEventListener("offline", off);
    return () => {
      (map.getContainer() as HTMLElement).removeEventListener("mousemove", onMove);
      map.off("zoomend", onZoom);
      window.removeEventListener("online", onl); window.removeEventListener("offline", off);
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

// ---------------------- TreesLayer（子） ----------------------
function TreesLayer({
  filters,
  onFeaturesChange,
}: {
  filters: Filters;
  onFeaturesChange: (features: any[]) => void;
}) {
  const map = useMap();

  const layerRef = useRef<L.GeoJSON | null>(null);
  const canvasRendererRef = useRef<L.Canvas>(L.canvas()); // パフォーマンス用
  const drawGroupRef = useRef<L.FeatureGroup | null>(null);
  const allTreesRef = useRef<Tree[] | null>(null);

  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<Tree | null>(null);
  const selectedId = selected?.id ?? null;

  const [areaStats, setAreaStats] = useState<{ count: number; avgDbh: number | null; avgHeight: number | null }>({
    count: 0,
    avgDbh: null,
    avgHeight: null,
  });

  // Firestore 初回のみ
  const ensureTrees = async (): Promise<Tree[]> => {
    if (allTreesRef.current) return allTreesRef.current;
    const q = query(collection(db, "trees"), limit(5000)); // 上限保護
    const snap = await getDocs(q);
    const rows: Tree[] = snap.docs
      .map((d) => {
        const p: any = d.data();
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: String(p.tree_id ?? d.id ?? ""),
          lat,
          lng,
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

  // 条件フィルタ
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

  // 射線法（多角形内判定）
  const pointInPolygon = (point: [number, number], vs: [number, number][]) => {
    const x = point[1], y = point[0];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][1], yi = vs[i][0];
      const xj = vs[j][1], yj = vs[j][0];
      const denom = (yj - yi) || 1e-12;
      const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / denom + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // レイヤ再構築
  const reload = async () => {
    setSelected(null);

    // BBOX
    const b = map.getBounds();
    const [minLng, minLat, maxLng, maxLat] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];

    // 元データ
    const all = await ensureTrees();
    const inBox = all.filter((t) => t.lng >= minLng && t.lng <= maxLng && t.lat >= minLat && t.lat <= maxLat);

    // 条件でさらに絞る
    const filtered = applyFilters(inBox, filters);

    // サンプリング（描画上限）
    const MAX_DRAW = 3000;
    const step = filtered.length > MAX_DRAW ? Math.ceil(filtered.length / MAX_DRAW) : 1;
    const draw = filtered.filter((_, i) => i % step === 0);

    // 既存レイヤを除去
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // GeoJSON 構築
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

    // 反映（Canvasレンダラ使用）＋ 樹種色分け
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
            lat,
            lng,
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
    drawGroupRef.current = drawnItems;
    map.addLayer(drawnItems);

    const drawControl = new (L.Control as any).Draw({
      draw: { polygon: true, rectangle: true, polyline: false, circle: false, marker: false, circlemarker: false },
      edit: { featureGroup: drawnItems, edit: false, remove: true },
    });
    map.addControl(drawControl);

    const onCreated = (e: any) => {
      const shape = e.layer;
      drawnItems.clearLayers();
      drawnItems.addLayer(shape);

      const features = (layerRef.current?.toGeoJSON() as any)?.features ?? [];

      const inside = (lat: number, lng: number) => {
        if (shape.getBounds) return shape.getBounds().contains(L.latLng(lat, lng)); // 矩形
        if (shape.getLatLngs) {
          const latlngs = (shape.getLatLngs()?.[0] ?? []) as L.LatLng[];
          const poly: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
          return pointInPolygon([lat, lng], poly);
        }
        return false;
      };

      const picked = features.filter((f: any) => {
        const [lng, lat] = f.geometry?.coordinates || [null, null];
        return Number.isFinite(lat) && Number.isFinite(lng) && inside(lat as number, lng as number);
      });

      const props = picked.map((f: any) => f.properties || {});
      const num = (xs: any[]) => xs.map(Number).filter((n) => Number.isFinite(n));
      const avg = (xs: number[]) =>
        xs.length ? Math.round(((xs.reduce((a, b) => a + b, 0) / xs.length) + Number.EPSILON) * 10) / 10 : null;

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

  // 初回＋パン/ズーム（デバウンス）で再構築
  useEffect(() => {
    let t: any;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(reload, 150);
    };
    reload();
    map.on("moveend", debounced);
    map.on("zoomend", debounced); // 追加
    return () => {
      clearTimeout(t);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // CSV出力（表示中のレイヤから）
  const exportCsv = () => {
    if (!layerRef.current) return;
    const gj = layerRef.current.toGeoJSON() as any;
    const rows = (gj.features || []).map((f: any) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry?.coordinates || [null, null];
      return {
        id: p.tree_id ?? "",
        lat,
        lng,
        species: p.species ?? "",
        dbh_cm: p.dbh_cm ?? "",
        height_m: p.height_m ?? "",
        volume_m3: p.volume_m3 ?? "",
      };
    });
    const headers = ["id", "lat", "lng", "species", "dbh_cm", "height_m", "volume_m3"];
    const csv =
      headers.join(",") +
      "\n" +
      rows.map((r) => headers.map((h) => JSON.stringify((r as any)[h] ?? "")).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trees.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* 左上：表示本数＋集計ボタン＋CSV */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          background: "#fff",
          padding: 8,
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          zIndex: 1000,
        }}
      >
        <div>表示本数: {count}</div>
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
            alert(
              `本数:${count}\n平均樹高:${avg_height.toFixed(2)}m\n平均DBH:${avg_dbh.toFixed(1)}cm\n総材積:${sum_volume.toFixed(2)}m³`
            );
          }}
        >
          現在範囲で集計
        </button>
        <button onClick={exportCsv}>CSV出力</button>
      </div>

      {/* 左下：描画範囲の集計結果 */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 12,
          background: "#fff",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #ddd",
          boxShadow: "0 10px 20px rgba(0,0,0,.08)",
          zIndex: 1000,
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
          >
            クリア
          </button>
        </div>
      </div>

      {/* 右側：単木詳細パネル */}
      <TreeDetail tree={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------- MapView（親） ----------------------
export default function MapView() {
  const initial: LatLngBoundsExpression = [
    [41.7, 140.6],
    [41.9, 140.9],
  ];

  // レイヤ切替・透過
  const [opacity, setOpacity] = useState(0.7);
  const [base, setBase] = useState([
    { id: "std", label: "標準地図", active: true },
    { id: "photo", label: "航空写真", active: false },
  ]);
  const [overlays, setOverlays] = useState([{ id: "slope", label: "傾斜", visible: false }]);
  const changeBase = (id: string) => setBase((bs) => bs.map((b) => ({ ...b, active: b.id === id })));
  const toggleOverlay = (id: string, next: boolean) =>
    setOverlays((os) => os.map((o) => (o.id === id ? { ...o, visible: next } : o)));
  const activeBase = base.find((b) => b.active)?.id ?? "std";

  // 検索ドロワー
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [features, setFeatures] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({});

  const speciesOptions = Array.from(
    new Set(features.map((f: any) => f.properties?.species).filter(Boolean))
  ) as string[];

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <MapContainer bounds={initial} style={{ height: "100%" }} preferCanvas>
        {/* 地理院タイル（安定・推奨） */}
        {activeBase === "std" && (
          <TileLayer
            url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
            attribution="&copy; 国土地理院"
          />
        )}
        {activeBase === "photo" && (
          <TileLayer
            url="https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg"
            attribution="&copy; 国土地理院 航空写真"
          />
        )}

        {/* オーバーレイ例：傾斜（実タイルURLに置き換え可） */}
        {overlays.find((o) => o.id === "slope")?.visible && (
          <TileLayer url="https://tile.example.com/slope/{z}/{x}/{y}.png" opacity={opacity} attribution="Slope demo" />
        )}

        <TreesLayer filters={filters} onFeaturesChange={setFeatures} />
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

      {/* 右上：レイヤ切替（ヘッダと重ならないよう topOffset を調整） */}
      <LayerSwitcher
        bases={base}
        overlays={overlays}
        onChangeBase={changeBase}
        onToggleOverlay={toggleOverlay}
        position="top-right"
        topOffset={60}
        footer={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <OpacitySlider value={opacity} onChange={setOpacity} label="透過" />
            <button
              onClick={() => setDrawerOpen(true)}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
            >
              条件検索
            </button>
          </div>
        }
      />

      {/* 検索ドロワー（今表示中の features をCSV＆統計に活用） */}
      <SearchDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        speciesOptions={speciesOptions}
        features={features}
        onApply={(fs) => {
          setFilters(fs);
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}
