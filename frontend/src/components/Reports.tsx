// frontend/src/components/Reports.tsx
import React, { useState } from "react";
import { auth, storage } from "../lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { submitReport } from "../lib/outbox";
import { toast } from "react-hot-toast";

export default function Reports() {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<GeolocationPosition[]>([]);
  const [watchId, setWatchId] = useState<number | null>(null);

  const startGPS = () => {
    if (watchId != null) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setTrack((prev) => [...prev, p]),
      (e) => toast.error(e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    setWatchId(id);
  };

  const stopGPS = () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
  };

  const onSubmit = async () => {
    const user = auth.currentUser;
    if (!user) return toast.error("ログインしてください。");
    if (!text && !photo) return toast.error("本文または写真のいずれかは必要です。");

    setBusy(true);
    try {
      // オフライン時の写真は未対応（MVP）。安全のため弾く。
      if (!navigator.onLine && photo) {
        toast.error("オフラインでは写真付き送信は保存できません。オンラインで送信してください。");
        return;
      }

      // 写真があればオンラインで先にアップロード
      let photoUrl: string | null = null;
      if (photo && navigator.onLine) {
        const path = `reports/${user.uid}/${Date.now()}_${photo.name}`;
        const r = ref(storage, path);
        await uploadBytes(r, photo);
        photoUrl = await getDownloadURL(r);
      }

      // 軌跡をGeoJSONに変換
      const features = track.map((p) => ({
        type: "Feature",
        properties: {
          ts: p.timestamp,
          acc: p.coords.accuracy ?? null,
          alt: p.coords.altitude ?? null,
        },
        geometry: { type: "Point", coordinates: [p.coords.longitude, p.coords.latitude] },
      }));

      const payload = {
        text,
        photoUrl, // null可
        track: { type: "FeatureCollection", features },
      };

      const result = await submitReport(payload);
      if (result === "sent") {
        toast.success("送信しました");
      } else {
        toast.info("オフラインのため端末に保存しました。オンライン復帰後に自動送信します。");
      }

      setText(""); setPhoto(null); setTrack([]);
    } catch (e: any) {
      toast.error(e?.message ?? "送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>日報</h2>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <textarea placeholder="本文" value={text} onChange={(e) => setText(e.target.value)} rows={5} />
        <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={startGPS} disabled={watchId != null}>GPS開始</button>
          <button onClick={stopGPS} disabled={watchId == null}>GPS停止</button>
          <span>記録点: {track.length}</span>
        </div>
        <button onClick={onSubmit} disabled={busy}>{busy ? "送信中..." : "送信"}</button>
      </div>
    </div>
  );
}
