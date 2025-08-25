import React, { useEffect, useState } from "react";
import axios from "axios";

type Plan = {
  id?: string;
  name: string;
  task_type: string;
  assignee?: string;
  period_planned_start?: string;
  period_planned_end?: string;
  status_pct?: number;
};

export default function Plans(){
  const [items, setItems] = useState<Plan[]>([]);
  const [form, setForm] = useState<Plan>({ name:"", task_type:"" });

  const load = async ()=>{ const { data } = await axios.get("/api/plans"); setItems(data); };
  useEffect(()=>{ load(); }, []);

  const add = async ()=>{ await axios.post("/api/plans", form); setForm({ name:"", task_type:"" }); await load(); };

  return (
    <div style={{padding:16}}>
      <h2>施業計画</h2>
      <div style={{display:"flex", gap:8, marginBottom:12}}>
        <input placeholder="名称" value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/>
        <input placeholder="作業内容" value={form.task_type} onChange={e=>setForm({...form, task_type:e.target.value})}/>
        <input type="number" placeholder="進捗%" value={form.status_pct||""} onChange={e=>setForm({...form, status_pct:Number(e.target.value)})}/>
        <button onClick={add}>追加</button>
      </div>
      <table border={1} cellPadding={6} style={{borderCollapse:"collapse", width:"100%"}}>
        <thead><tr><th>名称</th><th>作業内容</th><th>担当</th><th>予定</th><th>進捗%</th></tr></thead>
        <tbody>
          {items.map(p=> (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.task_type}</td>
              <td>{p.assignee||"-"}</td>
              <td>{p.period_planned_start||""} ~ {p.period_planned_end||""}</td>
              <td style={{textAlign:"right"}}>{p.status_pct??0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
