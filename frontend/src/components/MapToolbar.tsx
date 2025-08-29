// frontend/src/components/MapToolbar.tsx
import React from 'react';

type Props = {
  count: number;
  onAggregate: () => void;
  onExportCsv: () => void;
  onOpenFilters: () => void;
};

export default function MapToolbar({ count, onAggregate, onExportCsv, onOpenFilters }: Props) {
  return (
    <div className="map-toolbar">
      <div>表示本数: {count}</div>
      <div className="btns">
        <button onClick={onAggregate}>現在範囲で集計</button>
        <button onClick={onExportCsv}>CSV出力</button>
        <button onClick={onOpenFilters}>🔍 条件</button>
      </div>
      <style>{`
        .map-toolbar{
          position:absolute; left:12px; top:12px; z-index: 402;
          display:flex; gap:12px; align-items:center;
          background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:8px 10px;
          box-shadow:0 3px 12px rgba(0,0,0,.08); pointer-events:auto;
        }
        .map-toolbar .btns{display:flex; gap:8px}
        .map-toolbar button{
          border:1px solid #d1d5db; background:#fff; border-radius:10px; padding:6px 10px; cursor:pointer;
        }
        .map-toolbar button:hover{background:#f9fafb}
      `}</style>
    </div>
  );
}
