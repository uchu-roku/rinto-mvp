// rinto-mvp/frontend/src/components/map/RangeStatsDrawer.tsx
import React from "react";

export type RangeStatItem = {
  /** 選択図形（GeoJSON; Polygon/Rectangleなど） */
  geom: any | null;
  /** 集計結果（Map側で算出済） */
  stats: {
    count: number;
    avgDbh: number | null;    // cm
    avgHeight: number | null; // m
    // 必要になったら sumVolume などを追加してOK
  };
};

type Props = {
  /** ドロワーの表示/非表示 */
  open: boolean;
  /** 集計履歴（新しい順でOK） */
  items: RangeStatItem[];
  /** ドロワーを閉じる */
  onClose: () => void;
  /** 履歴クリア */
  onClear: () => void;
  /**
   * 任意: 図形中心へズームしたい時に渡す。
   * 例: onFocus = (geom) => mapRef.current?.fitBounds(L.geoJSON(geom).getBounds(), { padding: [16,16] })
   */
  onFocus?: (geom: any) => void;
  /** 任意: ヘッダー分のオフセット(px)。未指定なら 72 */
  topOffset?: number;
};

export default function RangeStatsDrawer({
  open,
  items,
  onClose,
  onClear,
  onFocus,
  topOffset = 72,
}: Props) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: topOffset,
        width: 320,
        maxHeight: "65%",
        overflow: "auto",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 6px 24px rgba(0,0,0,.12)",
        zIndex: 1100,
        padding: 12,
        pointerEvents: "auto",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 700 }}>範囲集計</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClear}
            title="一覧をクリア"
            style={btnStyle()}
          >
            クリア
          </button>
          <button
            onClick={onClose}
            title="閉じる"
            style={btnStyle()}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 説明 */}
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        地図左上の描画ツール（□ / ⬠）で範囲を作図すると、ここに集計が追加されます。
      </div>

      {/* 本体 */}
      {items.length === 0 ? (
        <div style={{ color: "#9ca3af" }}>まだ集計結果がありません。</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {items.map((it, i) => (
            <li
              key={i}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 600 }}>選択 {i + 1}</div>
                {onFocus && it.geom ? (
                  <button
                    onClick={() => onFocus(it.geom)}
                    title="この範囲へズーム"
                    style={btnStyle()}
                  >
                    ズーム
                  </button>
                ) : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "8rem 1fr", rowGap: 6 }}>
                <Label>選択本数</Label>
                <Value>{it.stats.count}</Value>

                <Label>平均DBH</Label>
                <Value>{fmt(it.stats.avgDbh, 1)}<Unit> cm</Unit></Value>

                <Label>平均樹高</Label>
                <Value>{fmt(it.stats.avgHeight, 1)}<Unit> m</Unit></Value>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- 小さい表示用コンポーネント/ユーティリティ ---------- */

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#6b7280" }}>{children}</div>;
}

function Value({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700 }}>{children}</div>;
}

function Unit({ children }: { children: React.ReactNode }) {
  return <span style={{ fontWeight: 500, color: "#6b7280", marginLeft: 4 }}>{children}</span>;
}

/** ボタンの共通スタイル */
function btnStyle(): React.CSSProperties {
  return {
    padding: "4px 8px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 8,
    cursor: "pointer",
  };
}

/** 数値のフォーマット。null/NaNは "—" を返す */
function fmt(n: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  const f = Math.pow(10, digits);
  return (Math.round(n * f) / f).toFixed(digits);
}
