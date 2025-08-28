import React from 'react';
import type { MapLayer } from '../../types/map';


type Props = {
layers: MapLayer[];
onToggle: (id: string, visible: boolean) => void;
onOpacity: (id: string, opacity: number) => void;
onMove: (id: string, dir: 'up' | 'down') => void;
};


export default function LayerManager({ layers, onToggle, onOpacity, onMove }: Props) {
const groups: Record<string, MapLayer[]> = { '基図': [], 'ラスタ': [], 'ベクタ': [] };
for (const l of layers) groups[l.group].push(l);


return (
<div style={{ width: 280, padding: 12 }}>
<h3 style={{ fontWeight: 600, marginBottom: 8 }}>レイヤ</h3>
{Object.entries(groups).map(([group, arr]) => (
<div key={group} style={{ marginBottom: 12 }}>
<div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{group}</div>
<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
{arr.map(l => (
<div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
<input type="checkbox" checked={l.visible} onChange={e => onToggle(l.id, e.target.checked)} />
<div style={{ flex: 1 }}>{l.name}</div>
<button title="上へ" onClick={() => onMove(l.id, 'up')}>↑</button>
<button title="下へ" onClick={() => onMove(l.id, 'down')}>↓</button>
</div>
))}
</div>
{arr.map(l => (
<div key={l.id+':op'} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24 }}>
<input type="range" min={0} max={1} step={0.05} value={l.opacity}
onChange={e => onOpacity(l.id, Number(e.target.value))} />
<span style={{ width: 36, textAlign: 'right' }}>{Math.round(l.opacity * 100)}%</span>
</div>
))}
</div>
))}
</div>
);
}
