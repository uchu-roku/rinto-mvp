import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L, { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";

function TreesLayer(){
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [count, setCount] = useState(0);

  const reload = async () => {
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const { data } = await axios.get(`/api/trees/search`, { params: { bbox } });
    if (layerRef.current) map.removeLayer(layerRef.current);
    const lyr = L.geoJSON(data, {
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 4, color: "#0a7" }),
      onEachFeature: (f, layer) => {
        const p:any = f.properties;
        layer.bindPopup(`ID: ${p.tree_id}<br/>樹高: ${p.height_m}m<br/>DBH: ${p.dbh_cm}cm<br/>材積: ${p.volume_m3}m³<br/>樹種: ${p.species}`);
      }
    }).addTo(map);
    layerRef.current = lyr;
    setCount((data.features||[]).length);
  };

  useEffect(()=>{
    reload();
    map.on("moveend", reload);
    return ()=> { map.off("moveend", reload); if(layerRef.current) map.removeLayer(layerRef.current); };
  }, []);

  return (
    <div style={{position:"absolute", top:8, left:8, background:"#fff", padding:8, borderRadius:6, boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
      <div>表示本数: {count}</div>
      <button onClick={async ()=>{
        const b = map.getBounds();
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        const { data } = await axios.post(`/api/trees/stats`, { bbox });
        alert(`本数:${data.count}\n平均樹高:${data.avg_height.toFixed(2)}m\n平均DBH:${data.avg_dbh.toFixed(1)}cm\n総材積:${data.sum_volume.toFixed(2)}m³`);
      }}>現在範囲で集計</button>
    </div>
  );
}

export default function MapView(){
  const initial: LatLngBoundsExpression = [[41.7, 140.6],[41.9, 140.9]]; // 例：道南
  return (
    <div style={{height:"100%"}}>
      <MapContainer bounds={initial} style={{height:"100%"}}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap"/>
        <TreesLayer />
      </MapContainer>
    </div>
  );
}
