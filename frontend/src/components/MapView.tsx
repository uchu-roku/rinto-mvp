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
  スギ: "#3b7",
  ヒノキ: "#2a6",
  カラマツ: "#c84",
  トドマツ: "#58c",
  エゾマツ: "#26a",
  その他: "#888",
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
    const onl = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", onl);
    window.addEventListener("offline", off);
    return () => {
      (map.getContainer() as HTMLElement).removeEventListener("mousemove", onMove);
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

// ---------------------- 追加UI：スケールバー ----------------------
function ScaleControl() {
  const map = useMap();
  useEffect(() => {
    const ctrl = L.control.scale({ metric: true, imperial: false });
    ctrl.addTo(map);
    return () => (map as any).removeControl(ctrl);
  }, [map]);
  return null;
}

// ---------------------- 追加UI：URLハッシュ同期 ----------------------
function ViewHashSync({ initial }: { initial: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    // ハッシュがあれば復元、無ければ初期範囲
    const m = location.hash.match(/^#(\d{1,2})\/(-?\d+\.\d+)\/(-?\d+\.\d+)$/);
    if (m) {
      const z = Number(m[1]),
        lat = Number(m[2]),
        lng = Number(m[3]);
      if (Number.isFinite(z) && Number.isFinite(lat) && Number.isFinite(lng)) {
        map.setView([lat, lng], z);
      } else {
        map.fitBounds(initial);
      }
    } else {
      map.fitBounds(initial);
    }
    const onMove = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      history.replaceState(null, "", `#${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
    };
    map.on("moveend", onMove);
    return () => map.off("moveend", onMove);
  }, [map, initial]);
  return null;
}

// ---------------------- 追加UI：クイック操作 ----------------------
function QuickControls({
  initial,
  onCsv,
}: {
  initial: LatLngBoundsExpression;
  onCsv: () => void;
}) {
  const map = useMap();
  const accRef = useRef<L.Circle | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);

  // locate/go-home のカスタムイベントを拾う
  useEffect(() => {
    const locate = () => map.locate({ enableHighAccuracy: true });
    const home = () => map.fitBounds(initial);
    window.addEventListener("locate-me", locate as any);
    window.addEventListener("go-home", home as any);
    return () => {
      window.removeEventListener("locate-me", locate as any);
      window.removeEventListener("go-home", home as any);
    };
  }, [map, initial]);

  useEffect(() => {
    const onFound = (e: L.LocationEvent) => {
      const ll = e.latlng;
      const acc = e.accuracy || 30;
      if (!meRef.current) {
        meRef.current = L.circleMarker(ll, { radius: 6, color: "#1976d2", weight: 2 }).addTo(map);
      } else {
        meRef.current.setLatLng(ll);
      }
      if (!accRef.current) {
        accRef.current = L.circle(ll, {
          radius: acc,
          color: "#1976d2",
          weight: 1,
          fillColor: "#1976d2",
          fillOpacity: 0.15,
        }).addTo(map);
      } else {
        accRef.current.setLatLng(ll).setRadius(acc);
      }
      map.setView(ll, Math.max(map.getZoom(), 16));
    };
    const onErr = (e: any) => alert("位置取得に失敗しました: " + (e?.message || e));
    map.on("locationfound", onFound);
    map.on("locationerror", onErr);
    return () => {
      map.off("locationfound", onFound);
      map.off("locationerror", onErr);
      if (accRef.current) map.removeLayer(accRef.current);
      if (meRef.current) map.removeLayer(meRef.current);
    };
  }, [map]);

  const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
    <button
      {...props}
      style={{
        padding: "6px 10px",
        border: "1px solid #e5e7eb",
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 1px 2px rgba(0,0,0,.06)",
        ...props.style,
      }}
    />
  );

  return (
    <div style={{ position: "absolute", left: 8, top: 60, display: "flex", flexDirection: "column", gap: 6, zIndex: 1000 }}>
      <Btn title="現在地へ (L)" onClick={() => map.locate({ enableHighAccuracy: true })}>
        📍
      </Btn>
      <Btn title="初期表示に戻る (H)" onClick={() => map.fitBounds(initial)}>
        🏠
      </Btn>
      <Btn title="CSV出力 (E)" onClick={onCsv}>
        CSV
      </Btn>
    </div>
  );
}

// ---------------------- 追加UI：ショートカットヘルプ ----------------------
function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        right: 12,
        top: 70,
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
        <li>
          <b>F</b>: 条件検索を開く
        </li>
        <li>
          <b>L</b>: 現在地へ移動
        </li>
        <li>
          <b>H</b>: 初期表示に戻る
        </li>
        <li>
          <b>E</b>: 表示中の単木をCSV出力
        </li>
        <li>
          <b>?</b>: このヘルプを表示/閉じる
        </li>
      </ul>
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
  const [loading, setLoading] = useState(false);
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
 
