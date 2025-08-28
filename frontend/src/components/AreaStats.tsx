// frontend/src/components/AreaStats.tsx
export default function AreaStats({ count, avgDbh, avgHeight }:{
  count: number; avgDbh: number|null; avgHeight: number|null;
}) {
  return (
    <div className="stats">
      <div>選択本数: <b>{count}</b></div>
      <div>平均DBH: <b>{avgDbh ?? '—'}</b></div>
      <div>平均樹高: <b>{avgHeight ?? '—'}</b></div>
      <style>{`
        .stats{position:absolute;bottom:16px;left:12px;background:#fff;padding:8px 10px;border:1px solid #ddd;border-radius:8px}
      `}</style>
    </div>
  );
}
