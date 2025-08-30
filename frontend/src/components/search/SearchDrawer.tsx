// rinto-mvp/frontend/src/components/search/SearchDrawer.tsx
import React, { useMemo, useState } from "react";

export type Filters = {
  minHeight?: number | null;
  maxHeight?: number | null;
  minDbh?: number | null;
  maxDbh?: number | null;
  species?: string[]; // IN
};

type GeoJsonPoint = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, any>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  speciesOptions: string[];
  /** MapView から渡される現在表示レイヤの Feature 群（任意） */
  features?: GeoJsonPoint[];
  /** 適用ボタン押下時にフィルタと（任意で）絞り込み済み features を返す */
  onApply: (filters: Filters, filtered?: GeoJsonPoint[]) => void;
  /** 任意: 外部のCSV出力器を使いたい場合に渡す（未指定なら内部CSVを出力） */
  onExportCsv?: () => void;
};

/* ---- 内部ユーティリティ（CSV/統計） ---- */
const toCSV = (rows: Record<string, any>[], headerOrder?: string[]) => {
  if (!rows.length) return "";
  const headers = headerOrder ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (s: any) => {
    if (s === null || s === undefined) return "";
    const str = String(s);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n");
};
const downloadCSV = (filename: string, csv: string) => {
  // Excel 互換のため BOM 付与
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
};
const calcStats = (features: GeoJsonPoint[]) => {
  const nums = (arr: any[]) => arr.filter((v) => typeof v === "number" && isFinite(v)) as number[];
  const hs = nums(features.map((f) => f.properties?.height_m));
  const ds = nums(features.map((f) => f.properties?.dbh_cm));
  const vs = nums(features.map((f) => f.properties?.volume_m3));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);
  return {
    count: features.length,
    avg_height_m: avg(hs),
    avg_dbh_cm: avg(ds),
    total_volume_m3: sum(vs),
  };
};
/* --------------------------------------- */

export default function SearchDrawer({
  open,
  onClose,
  speciesOptions,
  features = [],
  onApply,
  onExportCsv,
}: Props) {
  const [minHeight, setMinHeight] = useState<string>("");
  const [maxHeight, setMaxHeight] = useState<string>("");
  const [minDbh, setMinDbh] = useState<string>("");
  const [maxDbh, setMaxDbh] = useState<string>("");
  const [species, setSpecies] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const mh = minHeight === "" ? null : Number(minHeight);
    const xh = maxHeight === "" ? null : Number(maxHeight);
    const md = minDbh === "" ? null : Number(minDbh);
    const xd = maxDbh === "" ? null : Number(maxDbh);
    return features.filter((f) => {
      const p = f.properties ?? {};
      if (mh !== null && !(typeof p.height_m === "number" && p.height_m >= mh)) return false;
      if (xh !== null && !(typeof p.height_m === "number" && p.height_m <= xh)) return false;
      if (md !== null && !(typeof p.dbh_cm === "number" && p.dbh_cm >= md)) return false;
      if (xd !== null && !(typeof p.dbh_cm === "number" && p.dbh_cm <= xd)) return false;
      if (species.length && !species.includes(p.species)) return false;
      return true;
    });
  }, [features, minHeight, maxHeight, minDbh, maxDbh, species]);

  const stats = useMemo(() => calcStats(filtered), [filtered]);

  const apply = () => {
    onApply(
      {
        minHeight: minHeight === "" ? null : Number(minHeight),
        maxHeight: maxHeight === "" ? null : Number(maxHeight),
        minDbh: minDbh === "" ? null : Number(minDbh),
        maxDbh: maxDbh === "" ? null : Number(maxDbh),
        species,
      },
      filtered
    );
  };

  // 内蔵CSV（外部onExportCsvが無ければこれを使う）
  const exportCSVInternal = () => {
    const rows = filtered.map((f) => ({
      tree_id: f.properties?.tree_id ?? "",
      species: f.properties?.species ?? "",
      height_m: f.properties?.height_m ?? "",
      dbh_cm: f.properties?.dbh_cm ?? "",
      volume_m3: f.properties?.volume_m3 ?? "",
      lon: f.properties?.lon ?? f.geometry?.coordinates?.[0] ?? "",
      lat: f.properties?.lat ?? f.geometry?.coordinates?.[1] ?? "",
    }));
    const csv = toCSV(rows, ["tree_id", "species", "height_m", "dbh_cm", "volume_m3", "lon", "lat"]);
    downloadCSV(`trees_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };
  const handleExportCsv = onExportCsv ?? exportCSVInternal;

  const reset = () => {
    setMinHeight("");
    setMaxHeight("");
    setMinDbh("");
    setMaxDbh("");
    setSpecies([]);
  };

  return (
    <div style={{ ...drawer, transform: open ? "translateX(0)" : "translateX(-110%)" }}>
      <div style={head}>
        <b>条件検索</b>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={reset} style={btn}>
            リセット
          </button>
          <button onClick={onClose} style={btn}>
            閉じる
          </button>
        </div>
      </div>

      <div style={grid}>
        <label>
          樹高 (m) 最小
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={minHeight}
            onChange={(e) => setMinHeight(e.target.value)}
            placeholder="例: 5"
          />
        </label>
        <label>
          樹高 (m) 最大
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={maxHeight}
            onChange={(e) => setMaxHeight(e.target.value)}
            placeholder="例: 25"
          />
        </label>
        <label>
          直径 DBH (cm) 最小
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={minDbh}
            onChange={(e) => setMinDbh(e.target.value)}
            placeholder="例: 8"
          />
        </label>
        <label>
          直径 DBH (cm) 最大
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={maxDbh}
            onChange={(e) => setMaxDbh(e.target.value)}
            placeholder="例: 30"
          />
        </label>

        <div style={{ gridColumn: "1 / span 2" }}>
          <div style={{ marginBottom: 6 }}>樹種（複数選択）</div>
          <div
            style={{
              display: "grid",
              gap: 6,
              maxHeight: 160,
              overflow: "auto",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
            }}
          >
            {speciesOptions.map((s) => {
              const checked = species.includes(s);
              return (
                <label key={s} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSpecies(checked ? species.filter((x) => x !== s) : [...species, s])}
                  />
                  <span>{s}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={apply} style={btnPrimary}>
          この条件で適用
        </button>
        <button onClick={handleExportCsv} style={btn}>
          CSV出力
        </button>
      </div>

      <div style={statsBox}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>統計</div>
        <div>
          件数: <b>{stats.count}</b>
        </div>
        <div>
          平均樹高 (m): <b>{fmt(stats.avg_height_m, 2)}</b>
        </div>
        <div>
          平均直径 DBH (cm): <b>{fmt(stats.avg_dbh_cm, 1)}</b>
        </div>
        <div>
          総材積 (m³): <b>{fmt(stats.total_volume_m3, 3)}</b>
        </div>
      </div>
    </div>
  );
}

/* ---- スタイル ---- */
const drawer: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  bottom: 0,
  width: 320,
  background: "#fff",
  borderRight: "1px solid #e5e7eb",
  boxShadow: "2px 0 18px rgba(0,0,0,.06)",
  padding: 12,
  transition: "transform .25s ease",
  zIndex: 1001, // 地図コントロールより上
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};
const btn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#111827",
  color: "#fff",
  borderColor: "#111827",
};
const statsBox: React.CSSProperties = {
  marginTop: 12,
  borderTop: "1px solid #e5e7eb",
  paddingTop: 8,
  fontSize: 13,
};

/* ---- 表示補助 ---- */
const fmt = (v: number | null, d = 2) => (v === null || !isFinite(v) ? "—" : v.toFixed(d));
