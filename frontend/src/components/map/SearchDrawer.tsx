import React, { useEffect, useMemo, useState } from 'react';


return (
<div style={{ position: 'absolute', right: 12, top: 12, zIndex: 400, width: 300 }}>
<div style={{ background: 'white', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #eee' }}>
<div style={{ fontWeight: 600 }}>検索 & CSV</div>
<button onClick={() => setOpen(o => !o)}>{open ? '閉じる' : '開く'}</button>
</div>
{open && (
<div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
<div>
<div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>樹種</div>
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
{SPECIES.map(sp => {
const active = filters.species?.includes(sp);
return (
<button key={sp}
onClick={() => setFilters(f => ({ ...f, species: active ? (f.species || []).filter(x => x !== sp) : [ ...(f.species || []), sp ] }))}
style={{ padding: '4px 8px', borderRadius: 999, border: '1px solid #ccc', background: active ? '#2F6D3A' : '#fff', color: active ? '#fff' : '#333' }}>
{sp}
</button>
);
})}
</div>
</div>


<div>
<label style={{ display: 'block', fontSize: 12, color: '#666' }}>樹高 (m)</label>
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
<input type="number" style={{ width: 80 }} value={filters.heightMin ?? ''}
onChange={e => setFilters(f => ({ ...f, heightMin: Number(e.target.value) }))} />
<span>〜</span>
<input type="number" style={{ width: 80 }} value={filters.heightMax ?? ''}
onChange={e => setFilters(f => ({ ...f, heightMax: Number(e.target.value) }))} />
</div>
</div>


<div>
<label style={{ display: 'block', fontSize: 12, color: '#666' }}>胸高直径 (cm)</label>
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
<input type="number" style={{ width: 80 }} value={filters.dbhMin ?? ''}
onChange={e => setFilters(f => ({ ...f, dbhMin: Number(e.target.value) }))} />
<span>〜</span>
<input type="number" style={{ width: 80 }} value={filters.dbhMax ?? ''}
onChange={e => setFilters(f => ({ ...f, dbhMax: Number(e.target.value) }))} />
</div>
</div>


<div style={{ display: 'flex', gap: 8 }}>
<button onClick={() => setFilters({})}>クリア</button>
<button onClick={savePreset}>保存（最近5件）</button>
<button onClick={exportCSV} disabled={!hits.length}>CSV出力（{hits.length}件）</button>
</div>
</div>
)}
</div>
</div>
);
}
