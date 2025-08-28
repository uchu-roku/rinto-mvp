// frontend/src/components/Filters.tsx
import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Tree } from '../types/tree';

export default function Filters({ source, onChange }:{
  source: Tree[]; onChange: (rows: Tree[]) => void;
}) {
  const [species, setSpecies] = useState('');
  const [minDbh, setMinDbh] = useState<number | ''>('');
  const [maxDbh, setMaxDbh] = useState<number | ''>('');

  const filtered = useMemo(() => {
    return source.filter(r => {
      const sp = species ? (r.species ?? '').includes(species) : true;
      const min = minDbh !== '' ? (r.dbh ?? 0) >= minDbh : true;
      const max = maxDbh !== '' ? (r.dbh ?? 0) <= maxDbh : true;
      return sp && min && max;
    });
  }, [source, species, minDbh, maxDbh]);

  // 親へ反映
  onChange(filtered);

  const download = () => {
    const rows = filtered.map(r => ({
      id: r.id, lat: r.lat, lng: r.lng, species: r.species ?? '',
      dbh: r.dbh ?? '', height: r.height ?? '', volume: r.volume ?? ''
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'trees.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="filters">
      <input placeholder="樹種" value={species} onChange={e=>setSpecies(e.target.value)} />
      <input placeholder="DBH最小" value={minDbh} onChange={e=>setMinDbh(e.target.value===''?'':Number(e.target.value))} />
      <input placeholder="DBH最大" value={maxDbh} onChange={e=>setMaxDbh(e.target.value===''?'':Number(e.target.value))} />
      <button onClick={download}>CSV出力</button>
      <style>{`
        .filters{position:absolute;top:64px;left:12px;display:flex;gap:8px;background:#fff;padding:8px;border:1px solid #ddd;border-radius:8px}
        .filters input{width:100px}
      `}</style>
    </div>
  );
}
