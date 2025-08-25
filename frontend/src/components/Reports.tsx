import React, { useState } from "react";
import { auth, storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import axios from "axios";

export default function Reports(){
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File|null>(null);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<GeolocationPosition[] >([]);
  const [watchId, setWatchId] = useState<number| null>(null);

  const startGPS = ()=>{
    if (watchId != null) return;
    const id = navigator.geolocation.watchPosition(
      p => setTrack(prev=>[...prev,p]),
      console.error,
      { enableHighAccuracy:true, maximumAge:5000, timeout:10000 }
    );
    setWatchId(id);
  };
  const stopGPS = ()=>{ if (watchId!=null) navigator.geolocation.clearWatch(watchId); setWatchId(null); };

  const submit = async ()=>{
    setBusy(true);
    try{
      let photoUrl: string | undefined;
      const uid = auth.currentUser!.uid;
      if (photo) {
        const r = ref(storage, `reports/${uid}/${Date.now()}_${photo.name}`);
        await uploadBytes(r, photo);
        photoUrl = await getDownloadURL(r);
      }
      const features = [{
        type: "Feature",
        geometry: { type: "LineString", coordinates: track.map(p=>[p.coords.longitude, p.coords.latitude]) },
        properties: { start: track[0]?.timestamp, end: track.at(-1)?.timestamp }
      }];
      await axios.post("/api/reports", {
        uid, text, photoUrl, track: { type:"FeatureCollection", features }
      });
      setText(""); setPhoto(null); setTrack([]);
      alert("送信しました");
    }catch(e:any){ alert(e.message); }
    finally{ setBusy(false); }
  };

  return (
    <div style={{padding:16}}>
      <h2>日報</h2>
      <div style={{display:"grid", gap:8, maxWidth:720}}>
        <textarea placeholder="本文" value={text} onChange={e=>setText(e.target.value)} rows={5}/>
        <input type="file" accept="image/*" onChange={e=>setPhoto(e.target.files?.[0]||null)}/>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <button onClick={startGPS} disabled={watchId!=null}>GPS開始</button>
          <button onClick={stopGPS} disabled={watchId==null}>GPS停止</button>
          <span>位置点数: {track.length}</span>
        </div>
        <button onClick={submit} disabled={busy}>送信</button>
      </div>
    </div>
  );
}
