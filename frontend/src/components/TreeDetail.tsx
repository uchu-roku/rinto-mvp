// frontend/src/components/TreeDetail.tsx
import { Tree } from '../types/tree';

export default function TreeDetail({ tree, onClose }:{ tree: Tree|null; onClose: () => void }) {
  if (!tree) return null;
  return (
    <aside className="panel">
      <div className="panel-h">
        <b>単木詳細</b>
        <button onClick={onClose}>×</button>
      </div>
      <div className="panel-b">
        <dl>
          <dt>ID</dt><dd>{tree.id}</dd>
          <dt>樹種</dt><dd>{tree.species ?? '—'}</dd>
          <dt>胸高直径(DBH)</dt><dd>{tree.dbh ?? '—'}</dd>
          <dt>樹高</dt><dd>{tree.height ?? '—'}</dd>
          <dt>材積</dt><dd>{tree.volume ?? '—'}</dd>
          <dt>緯度</dt><dd>{tree.lat}</dd>
          <dt>経度</dt><dd>{tree.lng}</dd>
        </dl>
      </div>
      <style>{`
        .panel{position:absolute;top:64px;right:12px;width:300px;background:#fff;border:1px solid #ddd;
               border-radius:10px;box-shadow:0 10px 20px rgba(0,0,0,.08);overflow:hidden;}
        .panel-h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #eee}
        .panel-b{padding:12px}
        dl{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;margin:0}
        dt{color:#555} dd{margin:0}
      `}</style>
    </aside>
  );
}
