// frontend/src/components/map/Legend.tsx
import React from 'react';

export const SPECIES_COLORS: Record<string, string> = {
  'トドマツ': '#386cb0',
  'エゾマツ': '#7fc97f',
  'カラマツ': '#fdb462',
  'ミズナラ': '#bebada',
};

export default function Legend() {
  return (
    <div className="map-legend">
      <div className="legend-title">凡例</div>
      <ul>
        {Object.entries(SPECIES_COLORS).map(([k, v]) => (
          <li key={k}><span style={{ background: v }} />{k}</li>
        ))}
      </ul>
      <style>{`
        .map-legend {
          position:absolute; right:12px; bottom:16px; z-index: 401;
          background:#fff; border:1px solid #e5e7eb; border-radius:10px;
          padding:10px 12px; box-shadow: 0 2px 10px rgba(0,0,0,.08);
          pointer-events:auto;
        }
        .legend-title{font-size:12px; color:#374151; margin-bottom:6px}
        .map-legend ul{list-style:none;margin:0;padding:0}
        .map-legend li{display:flex;align-items:center;gap:8px;font-size:12px;color:#111827}
        .map-legend li+li{margin-top:4px}
        .map-legend li span{display:inline-block;width:14px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.1)}
      `}</style>
    </div>
  );
}
