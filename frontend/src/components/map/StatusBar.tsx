import React, { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';


export default function StatusBar() {
const map = useMap();
const [latlng, setLatlng] = useState<{lat:number; lng:number}>({ lat: 0, lng: 0 });
const [zoom, setZoom] = useState(map.getZoom());
const [online, setOnline] = useState<boolean>(navigator.onLine);
const [layers, setLayers] = useState<number>(0);


useEffect(() => {
const onMove = (e: any) => setLatlng(map.mouseEventToLatLng(e.originalEvent));
const onZoom = () => setZoom(map.getZoom());
const onLayerAdd = () => setLayers(countLayers());
const onLayerRemove = () => setLayers(countLayers());


(map.getContainer() as HTMLElement).addEventListener('mousemove', onMove as any);
map.on('zoomend', onZoom);
map.on('layeradd', onLayerAdd);
map.on('layerremove', onLayerRemove);


const onl = () => setOnline(true); const off = () => setOnline(false);
window.addEventListener('online', onl); window.addEventListener('offline', off);


setLayers(countLayers());


return () => {
(map.getContainer() as HTMLElement).removeEventListener('mousemove', onMove as any);
map.off('zoomend', onZoom);
map.off('layeradd', onLayerAdd);
map.off('layerremove', onLayerRemove);
window.removeEventListener('online', onl); window.removeEventListener('offline', off);
};
}, [map]);


return (
<div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, background: 'rgba(255,255,255,0.9)', borderTop: '1px solid #ddd', display:'flex', alignItems:'center', gap: 16, padding: '0 12px', zIndex: 300 }}>
<span>📍 {latlng.lat.toFixed(5)}, {latlng.lng.toFixed(5)}</span>
<span>🔎 z{zoom}</span>
<span>🧩 {layers} layers</span>
<span>● {online ? 'オンライン' : 'オフライン'}</span>
</div>
);


function countLayers(): number {
// base + overlays
let c = 0; map.eachLayer(() => c++); return c;
}
}
