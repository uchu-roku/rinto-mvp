import React from 'react';


type LegendItem = { color: string; label: string };


type Props = {
open?: boolean;
items: LegendItem[];
onToggle?: () => void;
};


export default function LegendDock({ open = true, items, onToggle }: Props) {
return (
<div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 500 }}>
<div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.2)', padding: 8, minWidth: 160 }}>
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
<div style={{ fontWeight: 600 }}>凡例</div>
<button onClick={onToggle} style={{ fontSize: 12 }}>{open ? '─' : '＋'}</button>
</div>
{open && (
<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
{items.map((it, i) => (
<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
<span style={{ width: 16, height: 12, background: it.color, border: '1px solid #999' }} />
<span style={{ fontSize: 13 }}>{it.label}</span>
</div>
))}
</div>
)}
</div>
</div>
);
}
