import React from "react";

type Props = {
  value: number; // 0..1
  onChange: (v: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
};

export default function OpacitySlider({
  value, onChange, label = "透過", min = 0, max = 1, step = 0.01,
}: Props) {
  return (
    <div style={wrap}>
      <label style={lab}>
        {label}: <b>{Math.round(value * 100)}%</b>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: 160 }}
      />
    </div>
  );
}

const wrap: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
const lab: React.CSSProperties = { fontSize: 12, color: "#374151" };
