import React from "react";

export type BaseLayer = { id: string; label: string; active: boolean };
export type OverlayLayer = { id: string; label: string; visible: boolean };

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type Props = {
  bases: BaseLayer[];
  overlays: OverlayLayer[];
  onChangeBase: (id: string) => void;
  onToggleOverlay: (id: string, next: boolean) => void;
  /** どの隅に固定するか（既定: top-left） */
  position?: Position;
  /** ヘッダと重ならないよう上方向のオフセット（px）。positionがtop-*のとき有効。既定: 12 */
  topOffset?: number;
  /** パネル下部に任意UIを差し込む（例：透過スライダやボタン） */
  footer?: React.ReactNode;
};

export default function LayerSwitcher({
  bases, overlays, onChangeBase, onToggleOverlay,
  position = "top-left", topOffset = 12, footer,
}: Props) {
  const anchor: React.CSSProperties = (() => {
    const common: React.CSSProperties = { position: "absolute" };
    switch (position) {
      case "top-left": return { ...common, top: topOffset, left: 12 };
      case "top-right": return { ...common, top: topOffset, right: 12 };
      case "bottom-left": return { ...common, bottom: 12, left: 12 };
      case "bottom-right": return { ...common, bottom: 12, right: 12 };
    }
  })();

  return (
    <div style={{ ...panelStyle, ...anchor }}>
      <div style={sectionStyle}>
        <div style={titleStyle}>背景レイヤ</div>
        {bases.map(b => (
          <label key={b.id} style={rowStyle}>
            <input
              type="radio"
              name="base-layer"
              checked={b.active}
              onChange={() => onChangeBase(b.id)}
            />
            <span>{b.label}</span>
          </label>
        ))}
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>オーバーレイ</div>
        {overlays.map(o => (
          <label key={o.id} style={rowStyle}>
            <input
              type="checkbox"
              checked={o.visible}
              onChange={e => onToggleOverlay(o.id, e.target.checked)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>

      {footer && <div style={{ marginTop: 8 }}>{footer}</div>}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 10,
  minWidth: 220,
  boxShadow: "0 6px 18px rgba(0,0,0,.08)",
  fontSize: 14,
  lineHeight: 1.3,
  zIndex: 1000,
};
const sectionStyle: React.CSSProperties = { marginBottom: 8 };
const titleStyle: React.CSSProperties = { fontWeight: 700, marginBottom: 6 };
const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "3px 0" };
