import React from "react";

export type TreeProps = {
  tree_id?: string | number;
  species?: string;
  height_m?: number | null;
  dbh_cm?: number | null;     // Diameter at Breast Height
  volume_m3?: number | null;
  lon?: number | null;
  lat?: number | null;
};

type Props = { data: TreeProps };

export default function TreePopup({ data }: Props) {
  const num = (v: number | null | undefined, d = 2) =>
    (v ?? null) === null ? "—" : Number(v).toFixed(d);

  return (
    <div style={card}>
      <div style={title}>単木情報</div>
      <table style={tbl}>
        <tbody>
          <Tr k="ID" v={data.tree_id ?? "—"} />
          <Tr k="樹種" v={data.species ?? "—"} />
          <Tr k="樹高 (m)" v={num(data.height_m, 2)} />
          <Tr k="直径 DBH (cm)" v={num(data.dbh_cm, 1)} />
          <Tr k="材積 (m³)" v={num(data.volume_m3, 3)} />
          <Tr k="位置 [Lon,Lat]" v={
            (data.lon && data.lat) ? `${num(data.lon, 6)}, ${num(data.lat, 6)}` : "—"
          } />
        </tbody>
      </table>
    </div>
  );
}

function Tr({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <tr>
      <th style={th}>{k}</th>
      <td style={td}>{v}</td>
    </tr>
  );
}

const card: React.CSSProperties = { minWidth: 220, fontSize: 13 };
const title: React.CSSProperties = { fontWeight: 700, marginBottom: 6 };
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
const th: React.CSSProperties = { textAlign: "left", color: "#6b7280", padding: "3px 4px", width: 110 };
const td: React.CSSProperties = { textAlign: "right", padding: "3px 4px" };
