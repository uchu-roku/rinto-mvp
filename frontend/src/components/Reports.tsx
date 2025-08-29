// frontend/src/components/Reports.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { auth, db, storage } from "../lib/firebase";
import {
  addDoc, collection, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import {
  ref as sref, uploadBytesResumable, getDownloadURL,
} from "firebase/storage";
import { toast } from "react-hot-toast";

// Leaflet（簡易ルート表示用）
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// ------------- 型 -------------
type LatLng = { lat: number; lng: number; t: number };
type Photo = { name: string; path: string; url: string; size: number; type: string };
type Report = {
  id: string;
  body: string;
  points: LatLng[];
  photos: Photo[];
  created_at?: any;
  started_at?: any;
  ended_at?: any;
  duration_ms?: number | null;
  author?: string | null;
};

// ------------- サブ：ミニ地図 -------------
function MiniRouteMap({ pts }: { pts: LatLng[] }) {
  if (!pts.length) {
    return (
      <div style={{
        height: 180, border: "1px dashed #ddd", borderRadius: 8,
        display: "grid", placeItems: "center", color: "#888"
      }}>
        GPSルートなし
      </div>
    );
  }
  const latArr = pts.map(p => p.lat);
  const lngArr = pts.map(p => p.lng);
  const bounds: any = [[Math.min(...latArr), Math.min(...lngArr)], [Math.max(...latArr), Math.max(...lngArr)]];
  return (
    <div style={{ height: 180, borderRadius: 8, overflow: "hidden", border: "1px solid #eee" }}>
      <MapContainer style={{ height: "100%" }} bounds={bounds} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <Polyline positions={pts.map(p => [p.lat, p.lng]) as any} weight={4} />
      </MapContainer>
    </div>
  );
}

// ------------- 本体 -------------
export default function Reports() {
  // 入力
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [uploadPct, setUploadPct] = useState<number>(0);

  // GPS
  const [watching, setWatching] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const startGPS = () => {
    if (watchIdRef.current != null) return;
    if (!navigator.geolocation) return toast.error("この端末では位置情報が使えません。");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPoints((prev) => [...prev, { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() }]);
      },
      (e) => toast.error("GPSエラー: " + e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    watchIdRef.current = id as any;
    setWatching(true);
    if (!startedAt) setStartedAt(Date.now());
  };

  const stopGPS = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  };

  useEffect(() => () => stopGPS(), []);

  // 下書き自動保存（本文・GPS・開始時刻）
  useEffect(() => {
    const tick = setInterval(() => {
      localStorage.setItem("report_draft", JSON.stringify({ body, points, startedAt }));
    }, 2000);
    return () => clearInterval(tick);
  }, [body, points, startedAt]);

  useEffect(() => {
    const raw = localStorage.getItem("report_draft");
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (typeof d.body === "string") setBody(d.body);
        if (Array.isArray(d.points)) setPoints(d.points);
        if (typeof d.startedAt === "number") setStartedAt(d.startedAt);
      } catch {}
    }
  }, []);

  // 直線合計の距離（km）
  const distanceKm = useMemo(() => {
    if (points.length < 2) return 0;
    const R = 6371e3; const rad = (x: number) => (x * Math.PI) / 180;
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dφ = rad(b.lat - a.lat), dλ = rad(b.lng - a.lng);
      const φ1 = rad(a.lat), φ2 = rad(b.lat);
      const x = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
      sum += 2 * R * Math.asin(Math.sqrt(x));
    }
    return sum / 1000;
  }, [points]);

  // 一覧
  const [items, setItems] = useState<Report[]>([]);
  useEffect(() => {
    // created_at の有無に関係なくクライアント側で並べ替え
    const unsub = onSnapshot(collection(db, "work_reports"), (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));
      setItems(rows);
    });
    return () => unsub();
  }, []);

  // 送信
  const [busy, setBusy] = useState(false);
  const onSubmit = async () => {
    const user = auth.currentUser;
    if (!user) return toast.error("ログインしてください。");
    if (!body.trim() && files.length === 0 && points.length === 0) {
      return toast.error("本文・写真・GPS のいずれかを入力してください。");
    }
    if (!navigator.onLine && files.length > 0) {
      return toast.error("オフライン時は写真付き送信はできません。オンラインで送信してください。");
    }

    try {
      setBusy(true);
      setUploadPct(1);

      // 1) 写真アップロード（Storage）
      const photos: Photo[] = [];
      let done = 0;
      const total = Math.max(1, files.length);

      for (const f of files) {
        const path = `reports/${user.uid}/${Date.now()}_${f.name}`;
        const task = uploadBytesResumable(sref(storage, path), f, { contentType: f.type });
        await new Promise<void>((resolve, reject) => {
          task.on(
            "state_changed",
            (s) => setUploadPct(Math.round(((done + s.bytesTransferred / (s.totalBytes || 1)) / total) * 100)),
            reject,
            async () => {
              const url = await getDownloadURL(task.snapshot.ref);
              photos.push({ name: f.name, path, url, size: f.size, type: f.type });
              done += 1;
              setUploadPct(Math.round((done / total) * 100));
              resolve();
            }
          );
        });
      }

      // 2) Firestore に保存
      const duration = startedAt ? Date.now() - startedAt : null;
      await addDoc(collection(db, "work_reports"), {
        body: body.trim(),
        photos,
        points,
        author: user.uid,
        started_at: startedAt ? new Date(startedAt) : null,
        ended_at: new Date(),
        duration_ms: duration,
        created_at: serverTimestamp(),
      });

      // 3) クリア
      setBody(""); setFiles([]); setPoints([]); setStartedAt(null); setUploadPct(0);
      localStorage.removeItem("report_draft");
      toast.success("送信しました");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>日報</h2>

      {/* 入力カード */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <textarea
          placeholder="本文"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ width: "100%", resize: "vertical", padding: 8 }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <label>
            <span style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: "#fff", cursor: "pointer" }}>
              ファイルの選択
            </span>
            <input
              type="file"
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <span style={{ color: "#666" }}>
            {files.length ? `${files.length} 件選択` : "ファイルが選択されていません"}
          </span>

          {!watching && <button onClick={startGPS}>GPS開始</button>}
          {watching && <button onClick={stopGPS}>GPS停止</button>}
          <span>記録点: {points.length}（約 {distanceKm.toFixed(2)} km）</span>

          {uploadPct > 0 && <span>アップロード: {uploadPct}%</span>}
        </div>

        {points.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <MiniRouteMap pts={points} />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button
            onClick={onSubmit}
            disabled={busy}
            style={{ width: "100%", padding: "10px 0", borderRadius: 8 }}
          >
            {busy ? "送信中..." : "送信"}
          </button>
        </div>
      </div>

      {/* 一覧 */}
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 8px" }}>直近の投稿</h3>
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((r) => (
          <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              {r.created_at?.toDate ? r.created_at.toDate().toLocaleString() : "—"}
            </div>
            <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>
              {r.body || "（本文なし）"}
            </div>

            {/* 写真プレビュー */}
            {r.photos?.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {r.photos.slice(0, 4).map((p, i) => (
                  <img
                    key={i}
                    src={p.url}
                    alt={p.name}
                    style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }}
                  />
                ))}
              </div>
            ) : null}

            {/* ルートプレビュー */}
            {r.points?.length ? (
              <div style={{ marginTop: 8 }}>
                <MiniRouteMap pts={r.points} />
              </div>
            ) : null}

            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
              位置点 {r.points?.length ?? 0}・写真 {r.photos?.length ?? 0}
            </div>
          </div>
        ))}
        {!items.length && <div style={{ color: "#888" }}>まだ投稿がありません</div>}
      </div>
    </div>
  );
}
