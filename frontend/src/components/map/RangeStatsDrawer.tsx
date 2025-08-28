import React, { useEffect, useMemo, useRef, useState } from 'react';
const latlngs = (layer as any).getLatLngs();
poly = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs) as L.LatLng[];
} else if ((layer as any).getBounds) {
const b = (layer as any).getBounds() as L.LatLngBounds;
poly = [b.getSouthWest(), L.latLng(b.getSouthWest().lat, b.getNorthEast().lng), b.getNorthEast(), L.latLng(b.getNorthEast().lat, b.getSouthWest().lng)];
}
const picked = allPoints.filter(p => pointInPolygon({ lat: p.lat, lng: p.lng }, poly));
const count = picked.length;
const heightAvg = avg(picked.map(p => p.height));
const dbhAvg = avg(picked.map(p => p.dbh));
const volumeTotal = sum(picked.map(p => p.volume));
setStats({ count, heightAvg, dbhAvg, volumeTotal });
};
map.on(L.Draw.Event.CREATED as any, onCreated);
return () => { map.off(L.Draw.Event.CREATED as any, onCreated); };
}, [map, allPoints]);


return (
<div style={{ position: 'absolute', left: 12, top: 12, zIndex: 400, width: 280 }}>
<div style={{ background: 'white', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #eee' }}>
<div style={{ fontWeight: 600 }}>任意範囲集計</div>
<button onClick={() => setOpen(o => !o)}>{open ? '閉じる' : '開く'}</button>
</div>
{open && (
<div style={{ padding: 12 }}>
<div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>左の描画ツール（四角/円/多角形）で範囲を作図してください。</div>
{stats ? (
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
<Stat label="本数" value={stats.count} />
<Stat label="平均樹高(m)" value={fmt(stats.heightAvg)} />
<Stat label="平均DBH(cm)" value={fmt(stats.dbhAvg)} />
<Stat label="総材積(m³)" value={fmt(stats.volumeTotal)} />
</div>
) : (
<div style={{ color: '#888' }}>図形作成後に統計が表示されます。</div>
)}
</div>
)}
</div>
</div>
);
}


function Stat({ label, value }: {label:string; value:string|number}) {
return (
<div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
<div style={{ fontSize: 11, color: '#666' }}>{label}</div>
<div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
</div>
);
}


function avg(arr: (number|undefined)[]) { const nums = arr.filter((n): n is number => typeof n === 'number'); return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0; }
function sum(arr: (number|undefined)[]) { const nums = arr.filter((n): n is number => typeof n === 'number'); return nums.reduce((a,b)=>a+b,0); }
function fmt(n: number) { return Number.isFinite(n) ? (Math.round(n*100)/100).toFixed(2) : '-'; }
