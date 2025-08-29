// frontend/src/components/Plans.tsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  serverTimestamp, updateDoc
} from "firebase/firestore";

// 既存スキーマに合わせた型（status は任意）
type Plan = {
  id: string;
  name: string;
  task_type: string;
  assignee?: string;
  period_planned_start?: string; // YYYY-MM-DD
  period_planned_end?: string;   // YYYY-MM-DD
  status_pct?: number;           // 0..100
  status?: "計画" | "実施中" | "完了"; // ない場合は pct から推定
  created_at?: any;
};
type ViewMode = "table" | "kanban" | "gantt";

// util
const clamp = (n: number, a = 0, b = 100) => Math.min(b, Math.max(a, n));
const fmt = (s?: string) => (s || "—");
const day = (s: string) => new Date(s + "T00:00:00");
const toYMD = (d: Date) => d.toISOString().slice(0, 10);
const inferStatus = (p: Plan): Plan["status"] =>
  p.status || ((p.status_pct ?? 0) >= 100 ? "完了" : (p.status_pct ?? 0) > 0 ? "実施中" : "計画");

// ================== 本体 ==================
export default function Plans() {
  const [view, setView] = useState<ViewMode>("table");
  const [items, setItems] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);

  // 追加フォーム（既存フィールド名）
  const [f, setF] = useState<Partial<Plan>>({
    name: "", task_type: "", assignee: "", period_planned_start: "", period_planned_end: "", status_pct: 0, status: "計画"
  });

  // Firestore購読（created_at の有無に関わらずクライアント側で並べ替え）
  useEffect(() => {
    const refCol = collection(db, "plans");
    const unsub = onSnapshot(refCol, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));
      setItems(rows);
    });
    return () => unsub();
  }, []);

  const add = async () => {
    if (!f.name?.trim() || !f.task_type?.trim()) return alert("名称と作業内容は必須です");
    setBusy(true);
    try {
      await addDoc(collection(db, "plans"), {
        name: f.name?.trim(),
        task_type: f.task_type?.trim(),
        assignee: f.assignee || "",
        period_planned_start: f.period_planned_start || "",
        period_planned_end: f.period_planned_end || "",
        status_pct: clamp(Number(f.status_pct ?? 0)),
        status: (f.status as any) || "計画",
        created_at: serverTimestamp(),
      });
      setF({ name: "", task_type: "", assignee: "", period_planned_start: "", period_planned_end: "", status_pct: 0, status: "計画" });
    } catch (e: any) {
      alert("保存に失敗しました: " + (e?.message || e));
      console.error(e);
    } finally { setBusy(false); }
  };

  const update = (id: string, patch: Partial<Plan>) =>
    updateDoc(doc(db, "plans", id), patch as any);

  const remove = async (id: string) => {
    if (confirm("削除しますか？")) await deleteDoc(doc(db, "plans", id));
  };

  // 絞り込み
  const [qtext, setQtext] = useState("");
  const [qstatus, setQstatus] = useState<"" | NonNullable<Plan["status"]>>("");
  const [qowner, setQowner] = useState("");
  const owners = useMemo(() => Array.from(new Set(items.map(i => i.assignee).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (qtext && !(i.name + (i.task_type || "")).includes(qtext)) return false;
      if (qstatus && inferStatus(i) !== qstatus) return false;
      if (qowner && i.assignee !== qowner) return false;
      return true;
    });
  }, [items, qtext, qstatus, qowner]);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>施業計画</h2>

      {/* 追加フォーム */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 1fr 1fr 120px 92px", gap: 8, marginBottom: 12 }}>
        <input placeholder="名称" value={f.name || ""} onChange={e => setF(s => ({ ...s, name: e.target.value }))} />
        <input placeholder="作業内容" value={f.task_type || ""} onChange={e => setF(s => ({ ...s, task_type: e.target.value }))} />
        <input placeholder="担当" value={f.assignee || ""} onChange={e => setF(s => ({ ...s, assignee: e.target.value }))} />
        <input type="date" value={f.period_planned_start || ""} onChange={e => setF(s => ({ ...s, period_planned_start: e.target.value }))} />
        <input type="date" value={f.period_planned_end || ""} onChange={e => setF(s => ({ ...s, period_planned_end: e.target.value }))} />
        <input type="number" min={0} max={100} value={f.status_pct ?? 0}
               onChange={e => setF(s => ({ ...s, status_pct: clamp(Number(e.target.value)) }))} />
        <button onClick={add} disabled={busy}>追加</button>
      </div>

      {/* フィルタ & ビュー切替 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input placeholder="キーワード検索" value={qtext} onChange={e => setQtext(e.target.value)} style={{ width: 280 }} />
        <select value={qstatus} onChange={e => setQstatus(e.target.value as any)}>
          <option value="">すべての状態</option>
          <option value="計画">計画</option>
          <option value="実施中">実施中</option>
          <option value="完了">完了</option>
        </select>
        <select value={qowner} onChange={e => setQowner(e.target.value)}>
          <option value="">すべての担当</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => setView("table")} disabled={view === "table"}>表</button>
          <button onClick={() => setView("kanban")} disabled={view === "kanban"}>カンバン</button>
          <button onClick={() => setView("gantt")} disabled={view === "gantt"}>ミニガント</button>
        </div>
      </div>

      {view === "table" && <TableView rows={filtered} onUpdate={update} onRemove={remove} />}
      {view === "kanban" && <KanbanView rows={filtered} onUpdate={update} />}
      {view === "gantt" && <GanttMini rows={filtered} />}
    </div>
  );
}

// ===== Table View =====
function TableView({ rows, onUpdate, onRemove }:
  { rows: Plan[]; onUpdate: (id: string, patch: Partial<Plan>) => any; onRemove: (id: string) => any; }) {

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Plan>>({});

  const startEdit = (r: Plan) => { setEditing(r.id); setDraft(r); };
  const cancel = () => { setEditing(null); setDraft({}); };
  const save = async () => { if (!editing) return; await onUpdate(editing, draft); cancel(); };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 1fr 1fr 160px 72px", background: "#fafafa", padding: "10px 12px", fontWeight: 600 }}>
        <div>名称</div><div>作業内容</div><div>担当</div><div>開始</div><div>終了</div><div>進捗%</div><div>操作</div>
      </div>
      {rows.map(r => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 1fr 1fr 160px 72px", padding: "8px 12px", borderTop: "1px solid #eee", alignItems: "center" }}>
          {editing === r.id ? (
            <>
              <input value={draft.name || ""} onChange={e => setDraft(s => ({ ...s, name: e.target.value }))} />
              <input value={draft.task_type || ""} onChange={e => setDraft(s => ({ ...s, task_type: e.target.value }))} />
              <input value={draft.assignee || ""} onChange={e => setDraft(s => ({ ...s, assignee: e.target.value }))} />
              <input type="date" value={draft.period_planned_start || ""} onChange={e => setDraft(s => ({ ...s, period_planned_start: e.target.value }))} />
              <input type="date" value={draft.period_planned_end || ""} onChange={e => setDraft(s => ({ ...s, period_planned_end: e.target.value }))} />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="range" min={0} max={100} value={draft.status_pct ?? 0}
                       onChange={e => setDraft(s => ({ ...s, status_pct: clamp(Number(e.target.value)) }))} />
                <select value={draft.status || inferStatus(r)} onChange={e => setDraft(s => ({ ...s, status: e.target.value as any }))}>
                  <option value="計画">計画</option><option value="実施中">実施中</option><option value="完了">完了</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={save}>保存</button>
                <button onClick={cancel}>取消</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>{r.name || "—"}</div>
              <div>{r.task_type || "—"}</div>
              <div>{r.assignee || "—"}</div>
              <div>{fmt(r.period_planned_start)}</div>
              <div>{fmt(r.period_planned_end)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 80 }}>
                  <input
                    type="range" min={0} max={100} value={r.status_pct ?? 0}
                    onChange={e => onUpdate(r.id, { status_pct: clamp(Number(e.target.value)) })}
                  />
                </div>
                <select value={inferStatus(r)} onChange={e => onUpdate(r.id, { status: e.target.value as any })}>
                  <option value="計画">計画</option><option value="実施中">実施中</option><option value="完了">完了</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => startEdit(r)}>編集</button>
                <button onClick={() => onRemove(r.id)}>削除</button>
              </div>
            </>
          )}
        </div>
      ))}
      {rows.length === 0 && <div style={{ padding: 16, color: "#888" }}>データがありません</div>}
    </div>
  );
}

// ===== Kanban View =====
function KanbanView({ rows, onUpdate }: { rows: Plan[]; onUpdate: (id: string, patch: Partial<Plan>) => any; }) {
  const cols: NonNullable<Plan["status"]>[] = ["計画", "実施中", "完了"];

  const move = (r: Plan, dir: -1 | 1) => {
    const idx = cols.indexOf(inferStatus(r));
    const next = cols[Math.min(cols.length - 1, Math.max(0, idx + dir))];
    const patch: Partial<Plan> = { status: next };
    // 状態変更時に status_pct を補正
    if (next === "計画") patch.status_pct = 0;
    if (next === "完了") patch.status_pct = 100;
    if (next === "実施中" && (!r.status_pct || r.status_pct === 0 || r.status_pct === 100)) patch.status_pct = 50;
    onUpdate(r.id, patch);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {cols.map(col => (
        <div key={col} style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, minHeight: 240 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{col}</div>
          {rows.filter(r => inferStatus(r) === col).map(r => (
            <div key={r.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: "#555" }}>{r.task_type}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{r.assignee || "—"}</span>
                <span style={{ fontSize: 12 }}>{fmt(r.period_planned_start)} → {fmt(r.period_planned_end)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {col !== "計画" && <button onClick={() => move(r, -1)}>◀</button>}
                {col !== "完了" && <button onClick={() => move(r, +1)}>▶</button>}
                <input
                  type="range" min={0} max={100} value={r.status_pct ?? 0}
                  onChange={e => onUpdate(r.id, { status_pct: clamp(Number(e.target.value)) })}
                  style={{ flex: 1 }}
                />
                <span style={{ width: 36, textAlign: "right" }}>{r.status_pct ?? 0}%</span>
              </div>
            </div>
          ))}
          {rows.filter(r => inferStatus(r) === col).length === 0 && (
            <div style={{ color: "#888", fontSize: 12 }}>カードなし</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ===== Mini Gantt =====
function GanttMini({ rows }: { rows: Plan[] }) {
  if (rows.length === 0) return <div style={{ color: "#888" }}>データがありません</div>;
  const d = (s?: string) => (s ? day(s) : new Date());
  const minStart = rows.reduce<Date>(
    (a, r) => (r.period_planned_start ? (d(r.period_planned_start) < a ? d(r.period_planned_start) : a) : a),
    d(rows[0].period_planned_start)
  );
  const maxEnd = rows.reduce<Date>(
    (a, r) => (r.period_planned_end ? (d(r.period_planned_end) > a ? d(r.period_planned_end) : a) : a),
    d(rows[0].period_planned_end || toYMD(new Date()))
  );
  // 期間を週グリッドに丸め
  const startWeek = new Date(minStart); startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const endWeek = new Date(maxEnd); endWeek.setDate(endWeek.getDate() + (6 - endWeek.getDay()));
  const weeks: Date[] = []; for (let x = new Date(startWeek); x <= endWeek; x.setDate(x.getDate() + 7)) weeks.push(new Date(x));

  const colOf = (s: string) => Math.max(1, Math.floor((day(s).getTime() - startWeek.getTime()) / (7 * 86400000)) + 1);
  const spanOf = (s: string, e: string) => Math.max(1, colOf(e) - colOf(s) + 1);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
      {/* ヘッダ：週 */}
      <div style={{ display: "grid", gridTemplateColumns: `240px repeat(${weeks.length}, 1fr)`, background: "#fafafa", borderBottom: "1px solid #eee" }}>
        <div style={{ padding: 8, fontWeight: 600 }}>案件</div>
        {weeks.map((w, i) => (
          <div key={i} style={{ padding: 8, fontSize: 12, borderLeft: "1px solid #eee" }}>
            {toYMD(w).slice(5)}週
          </div>
        ))}
      </div>

      {/* 本体 */}
      {rows.map(r => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: `240px repeat(${weeks.length}, 1fr)`, alignItems: "center", borderTop: "1px solid #f1f1f1" }}>
          <div style={{ padding: 8 }}>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div style={{ fontSize: 12, color: "#666" }}>{r.assignee || "—"} / {fmt(r.period_planned_start)}→{fmt(r.period_planned_end)}</div>
          </div>
          <div style={{ gridColumn: `${colOf(r.period_planned_start || toYMD(new Date())) + 1} / span ${spanOf(r.period_planned_start || toYMD(new Date()), r.period_planned_end || r.period_planned_start || toYMD(new Date()))}`, height: 10, background: "#cdeae0", borderRadius: 6, marginRight: 6 }} />
        </div>
      ))}
    </div>
  );
}
