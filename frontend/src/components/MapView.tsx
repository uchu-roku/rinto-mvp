// frontend/src/components/MapView.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L, { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import { createRoot } from "react-dom/client";

import { authFetch } from "../lib/authFetch";

import TreeDetail from "./TreeDetail";
import LayerSwitcher from "./map/LayerSwitcher";
import OpacitySlider from "./map/OpacitySlider";
import TreePopup from "./map/TreePopup";
import LayerManager from "./map/LayerManager";
import SearchDrawer, { type Filters } from "./search/SearchDrawer";
import LegendDock from "./map/LegendDock";
import MapToolbar from "./MapToolbar";
import RangeStatsDrawer from "./map/RangeStatsDrawer";

// ↓ マーカークラスタを使う場合は依存を入れてください（npm i leaflet.markercluster）
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";

/* ----------------------------- 定数 ----------------------------- */
const SPECIES_COLORS: Record<string, string> = {
  スギ: "#3b7",
  ヒノキ: "#2a6",
  カラマツ: "#c84",
  トドマツ: "#58c",
  エゾマツ: "#26a",
  その他: "#888",
};

const HEADER_OFFSET = 56;

/** 初期表示範囲（函館周辺の例） */
const INITIAL_BOUNDS: LatLngBoundsExpression = [
  [41.7, 140.6],
  [41.9, 140.9],
] as const;

/* ----------------------------- 型 ------------------------------ */
type Tree = {
  id: string;
  lat: number;
  lng: number;
  species?: string;
  dbh?: number | null;
  height?: number | null;
  volume?: number | null;
};

type ApiTree = {
  id?: string;
  tree_id?: string;
  lat?: number;
  lng?: number;
  location?: { lat: number; lng: number };
  geom?: { type: "Point"; coordinates: [number, number] };
  species?: string;
  dbh_cm?: number;
  height_m?: number;
  volume_m3?: number;
};

/* --------------------------- フック/ユーティリティ --------------------------- */
function useWindowSize() {
  const [w, setW] = useState<number>(typeof window === "undefined" ? 1024 : window.innerWidth);
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return w;
}

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

function ScaleControl() {
  const map = useMap();
  useEffect(() => {
    const ctrl = L.control.scale({ position: "bottomright", metric: true, imperial: false });
    ctrl.addTo(map);
    return () => (map as any).removeControl(ctrl);
  }, [map]);
  return null;
}

function MapReady({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  return null;
}

/* --------------------------- API --------------------------- */
async function fetchTreesByApi(f: Filters): Promise<Tree[]> {
  const qs = new URLSearchParams();
  if (f.species?.length) qs.set("species", f.species.join(","));
  if (f.minHeight != null) qs.set("height_min", String(f.minHeight));
  if (f.maxHeight != null) qs.set("height_max", String(f.maxHeight));
  if (f.minDbh != null) qs.set("dbh_min", String(f.minDbh));
  if (f.maxDbh != null) qs.set("dbh_max", String(f.maxDbh));
  qs.set("limit", String(f.limit ?? 1000));

  const { items } = await authFetch<{ items: ApiTree[] }>(`/api/trees/search?${qs.toString()}`);

  const norm = (p: ApiTree): Tree | null => {
    let lat = p.lat, lng = p.lng;
    if ((lat == null || lng == null) && p.location) {
      lat = p.location.lat; lng = p.location.lng;
    }
    if ((lat == null || lng == null) && p.geom?.type === "Point") {
      lng = p.geom.coordinates[0]; lat = p.geom.coordinates[1];
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      id: String(p.id ?? p.tree_id ?? `${lat},${lng}`),
      lat: Number(lat), lng: Number(lng),
      species: p.species,
      dbh: p.dbh_cm ?? null,
      height: p.height_m ?? null,
      volume: p.volume_m3 ?? null,
    };
  };

  return items.map(norm).filter((t): t is Tree => !!t);
}

/* --------------------------- TreesLayer --------------------------- */
function TreesLayer({
  filters,
  onFeaturesChange,
  onLoadingChange,
  onDrawComputed,
  detailMode,
  registerExport, // 親からCSVエクスポート関数を登録
}: {
  filters: Filters;
  onFeaturesChange: (features: any[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onDrawComputed: (payload: { geom: any; stats: { count: number; avgDbh: number | null; avgHeight: number | null } }) => void;
  detailMode: "panel" | "popup";
  registerExport: (fn: () => void) => void;
}) {
  const map = useMap();

  const layerRef = useRef<L.Layer | null>(null); // cluster or geojson を入れる
  const canvasRendererRef = useRef<L.Canvas>(L.canvas());
  const [selected, setSelected] = useState<Tree | null>(null);
  const selectedId = selected?.id ?? null;

  const reload = useCallback(async () => {
    onLoadingChange(true);
    setSelected(null);
    try {
      const b = map.getBounds();
      const [minLng, minLat, maxLng, maxLat] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const fetched = await fetchTreesByApi(filters);
      const filtered = fetched.filter(
        (t) => t.lng >= minLng && t.lng <= maxLng && t.lat >= minLat && t.lat <= maxLat
      );

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

      // クラスタ対応（存在すれば使う）
      const hasCluster = typeof (L as any).markerClusterGroup === "function";
      const makeMarker = (f: any, latlng: L.LatLng) => {
        const p = f.properties ?? {};
        const isSel = selectedId && String(p.tree_id ?? "") === selectedId;
        const col = SPECIES_COLORS[p.species || "その他"] || "#0a7";
        return L.circleMarker(latlng, {
          radius: isSel ? 7 : 4,
          color: isSel ? "#e91e63" : col,
          weight: isSel ? 2 : 1,
        });
      };

      const baseGeoJson = L.geoJSON(fc as any, {
        renderer: canvasRendererRef.current,
        pointToLayer: (f: any, latlng) => makeMarker(f, latlng),
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
          if (detailMode === "popup") {
            layer.bindPopup(div);
          } else {
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
          }
        },
      });

      const groupLayer = hasCluster
        ? (L as any).markerClusterGroup({ disableClusteringAtZoom: 18 }).addLayer(baseGeoJson)
        : baseGeoJson;

      groupLayer.addTo(map);
      layerRef.current = groupLayer;

      onFeaturesChange((fc as any).features);
    } finally {
      onLoadingChange(false);
    }
  }, [filters, map, detailMode, onFeaturesChange, onLoadingChange, selectedId]);

  // 選択ハイライト更新（panelモード時のみ意味あり）
  useEffect(() => {
    const l: any = layerRef.current;
    if (!l || !("eachLayer" in l)) return;
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

  // 描画（多角形/矩形）で集計 → RangeStatsDrawerへ
  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    const drawControl = new (L.Control as any).Draw({
      draw: { polygon: true, rectangle: true, polyline: false, circle: false, marker: false, circlemarker: false },
      edit: { featureGroup: drawnItems, edit: false, remove: true },
    });

    const onCreated = (e: any) => {
      const shape = e.layer;
      drawnItems.clearLayers();
      drawnItems.addLayer(shape);

      // 現在描画中のFeaturesを取得
      const features: any[] = ((): any[] => {
        const l: any = layerRef.current;
        if (!l) return [];
        if (l.toGeoJSON) return (l.toGeoJSON() as any)?.features ?? [];
        // cluster の場合も内部geojsonに対して toGeoJSON が生えるので上でOK
        return [];
      })();

      const inside = (lat: number, lng: number) => {
        if (shape.getBounds) return shape.getBounds().contains(L.latLng(lat, lng));
        if (shape.getLatLngs) {
          const ll = shape.getLatLngs?.();
          const latlngs: L.LatLng[] = Array.isArray(ll) ? (Array.isArray(ll[0]) ? ll[0] : ll) : [];
          const poly: [number, number][] = latlngs.map((p) => [p.lat, p.lng]);
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
      const avg = (xs: number[]) =>
        xs.length ? Math.round(((xs.reduce((a, b) => a + b, 0) / xs.length) + Number.EPSILON) * 10) / 10 : null;

      onDrawComputed({
        geom: shape.toGeoJSON ? shape.toGeoJSON() : null,
        stats: {
          count: props.length,
          avgDbh: avg(num(props.map((p: any) => p.dbh_cm))),
          avgHeight: avg(num(props.map((p: any) => p.height_m))),
        },
      });
    };

    map.addLayer(drawnItems);
    map.addControl(drawControl);
    map.on((L as any).Draw.Event.CREATED, onCreated);

    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map, onDrawComputed]);

  // 初回＋パン/ズームで再構築（デバウンス）
  useEffect(() => {
    let t: any;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(reload, 250);
    };
    reload();
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    return () => {
      clearTimeout(t);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [reload, map]);

  // CSV出力（現在のGeoJSONをそのままCSV化）
  const exportCsv = useCallback(() => {
    const layer: any = layerRef.current;
    if (!layer || !layer.toGeoJSON) return;
    const gj = layer.toGeoJSON() as any;
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
      "\r\n" +
      rows.map((r) => headers.map((h) => JSON.stringify((r as any)[h] ?? "")).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trees.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // 親からショートカット用関数を登録させる
  useEffect(() => {
    registerExport(exportCsv);
  }, [exportCsv, registerExport]);

  return (
    <>
      {/* 詳細パネルは panel モードのときだけ */}
      {detailMode === "panel" && <TreeDetail tree={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/* --------------------------- 親コンポーネント --------------------------- */
export default function MapView() {
  const winW = useWindowSize();
  const mapRef = useRef<L.Map | null>(null);

  // ベース/オーバーレイ
  const [opacity, setOpacity] = useState<number>(() => Number(localStorage.getItem("overlayOpacity") ?? 0.7));
  useEffect(() => localStorage.setItem("overlayOpacity", String(opacity)), [opacity]);

  const [base, setBase] = useState([
    { id: "std", label: "標準地図", active: true },
    { id: "photo", label: "航空写真", active: false },
  ]);

  const [overlays, setOverlays] = useState([
    { id: "slope", label: "傾斜", visible: false },
    { id: "dem", label: "DEM", visible: false },
    { id: "contour", label: "等高線", visible: false },
    { id: "canopy_surface", label: "樹冠表面", visible: false },
  ]);

  const [showLayerManager, setShowLayerManager] = useState(false);
  const [detailMode, setDetailMode] = useState<"panel" | "popup">("panel");

  const activeBase = base.find((b) => b.active)?.id ?? "std";

  // ドロワー/検索
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [features, setFeatures] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [helpOpen, setHelpOpen] = useState(false);

  // RangeStatsDrawer
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeStats, setRangeStats] = useState<any[]>([]);

  // ローディング表示用
  const [loading, setLoading] = useState(false);

  const speciesOptions = useMemo(
    () => Array.from(new Set(features.map((f: any) => f.properties?.species).filter(Boolean))) as string[],
    [features]
  );

  // CSVショートカット（TreesLayer側の関数をここに登録）
  const exportCsvRef = useRef<() => void>();
  const registerExport = useCallback((fn: () => void) => {
    exportCsvRef.current = fn;
  }, []);

  // キーショートカット
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e as any).isComposing) return;
      const k = e.key.toLowerCase();
      if (k === "f") setDrawerOpen(true);
      if (k === "?") setHelpOpen((v) => !v);
      if (k === "e") exportCsvRef.current?.();
      if (k === "h") {
        localStorage.removeItem(VIEW_KEY);
        mapRef.current?.fitBounds(INITIAL_BOUNDS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ドロワー幅（衝突回避）
  const drawerWidth = useMemo(() => {
    if (!drawerOpen) return 0;
    if (winW < 900) return 0;
    return Math.max(300, Math.min(380, Math.round(winW * 0.26)));
  }, [drawerOpen, winW]);

  const leftOffset = 8 + (drawerWidth ? drawerWidth + 12 : 0);

  const baseToolbarShim = `
    .leaflet-control-container { pointer-events: none; }
    .leaflet-control { pointer-events: auto; }
    .leaflet-top, .leaflet-bottom { z-index: 400; }
    .leaflet-top.leaflet-left .leaflet-draw-toolbar { margin-top: ${HEADER_OFFSET + 8}px; }
  `;

  // タイルレイヤURLを API から取得（/config/layers）
  const [layerConf, setLayerConf] = useState<any>(null);
  useEffect(() => {
    authFetch<{ layers: any }>("/api/config/layers")
      .then((r) => setLayerConf(r.layers || {}))
      .catch(() => setLayerConf({}));
  }, []);

  // 集計関数（Toolbarから呼ぶ）
  const handleAggregate = useCallback(() => {
    const props = features.map((f: any) => f.properties || {});
    const num = (xs: any[]) => xs.map(Number).filter((n) => Number.isFinite(n));
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const countV = props.length;
    const avg_height = avg(num(props.map((p: any) => p.height_m)));
    const avg_dbh = avg(num(props.map((p: any) => p.dbh_cm)));
    const sum_volume = num(props.map((p: any) => p.volume_m3)).reduce((a: number, b: number) => a + b, 0);
    alert(
      `本数:${countV}\n平均樹高:${avg_height ? avg_height.toFixed(2) : "—"}m\n平均DBH:${avg_dbh ? avg_dbh.toFixed(1) : "—"}cm\n総材積:${sum_volume ? sum_volume.toFixed(2) : "—"}m³`
    );
  }, [features]);

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <style>{baseToolbarShim}</style>

      <MapContainer style={{ height: "100%" }} preferCanvas center={[43.0621, 141.3544]} zoom={16}>
        <MapReady onReady={(m) => (mapRef.current = m)} />
        <ViewMemory initial={INITIAL_BOUNDS} />
        <ScaleControl />

        {/* 背景ベース */}
        {activeBase === "std" && (
          <TileLayer url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png" attribution="&copy; 国土地理院" />
        )}
        {activeBase === "photo" && (
          <TileLayer
            url={layerConf?.orthophoto || "https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg"}
            attribution="&copy; 航空写真"
          />
        )}

        {/* オーバーレイ */}
        {overlays.find((o) => o.id === "slope")?.visible && layerConf?.slope && (
          <TileLayer url={layerConf.slope} opacity={opacity} attribution="Slope" />
        )}
        {overlays.find((o) => o.id === "dem")?.visible && layerConf?.dem && (
          <TileLayer url={layerConf.dem} opacity={opacity} attribution="DEM" />
        )}
        {overlays.find((o) => o.id === "contour")?.visible && layerConf?.contour && (
          <TileLayer url={layerConf.contour} opacity={opacity} attribution="Contour" />
        )}
        {overlays.find((o) => o.id === "canopy_surface")?.visible && layerConf?.canopy_surface && (
          <TileLayer url={layerConf.canopy_surface} opacity={opacity} attribution="Canopy surface" />
        )}

        <TreesLayer
          filters={filters}
          onFeaturesChange={setFeatures}
          onLoadingChange={setLoading}
          onDrawComputed={(payload) => {
            setRangeStats((prev) => [payload, ...prev]);
            setRangeOpen(true);
          }}
          detailMode={detailMode}
          registerExport={registerExport}
        />
        <StatusBar />
      </MapContainer>

      {/* ツールバー（上部・ヘッダー退避） */}
      <MapToolbar
        topOffset={HEADER_OFFSET}
        leftOffset={leftOffset}
        count={features.length}
        loading={loading}
        onAggregate={handleAggregate}
        onExportCsv={() => exportCsvRef.current?.()}
        onLocate={() => mapRef.current?.locate({ enableHighAccuracy: true })}
        onHome={() => {
          localStorage.removeItem(VIEW_KEY);
          mapRef.current?.fitBounds(INITIAL_BOUNDS);
        }}
      />

      {/* 凡例（Dock版） */}
      <LegendDock
        topOffset={HEADER_OFFSET}
        items={(speciesOptions.length ? speciesOptions : Object.keys(SPECIES_COLORS)).map((sp) => ({
          label: sp,
          color: SPECIES_COLORS[sp] || SPECIES_COLORS["その他"],
        }))}
        position="bottom-right"
      />

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
              onClick={() => setDetailMode((m) => (m === "panel" ? "popup" : "panel"))}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
              title="詳細表示モード切替"
            >
              詳細: {detailMode}
            </button>
            <button
              onClick={() => setHelpOpen((v) => !v)}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
              title="ショートカット (?)"
            >
              ？
            </button>
            <button
              onClick={() => setShowLayerManager(true)}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8 }}
              title="レイヤ詳細"
            >
              詳細
            </button>
          </div>
        }
      />

      {/* レイヤ詳細パネル（LayerManager） */}
      {showLayerManager && (
        <LayerManager
          overlays={overlays}
          onChange={(next: typeof overlays) => setOverlays(next)}
          opacity={opacity}
          onOpacity={(v: number) => setOpacity(v)}
          onClose={() => setShowLayerManager(false)}
          topOffset={HEADER_OFFSET + 8}
        />
      )}

      {/* 範囲集計ドロワ */}
      <RangeStatsDrawer
        open={rangeOpen}
        items={rangeStats}
        onClose={() => setRangeOpen(false)}
        onClear={() => setRangeStats([])}
      />

      {/* ショートカットヘルプ */}
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
            pointerEvents: "auto",
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

      {/* 検索ドロワー（CSV出力も使えるようにするなら onExportCsv を渡す） */}
      <SearchDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        speciesOptions={speciesOptions}
        features={features}
        onExportCsv={() => exportCsvRef.current?.()}
        onApply={(fs) => {
          setFilters(fs);
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}
