// functions/src/schemas.ts
import { z } from "zod";

/* -------------------------- 共通ユーティリティ -------------------------- */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const hasCtrl = (s: string) => /[\u0000-\u001f]/.test(s);

// YYYY-MM-DD の実在日チェック（うるう年対応）
const isValidYMD = (s: string) => {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

// 文字列の共通サニタイズ（前後空白除去＋制御文字禁止）
const SafeStr = (min = 1, max = 200) =>
  z
    .string()
    .min(min)
    .max(max)
    .transform((s: string) => s.trim())
    .refine((s: string) => !hasCtrl(s), "制御文字は使用できません");

// 数値の共通（文字列でも受ける）
const Num = z.coerce.number();

/* ---------------------------- GeoJSON 最小型 ---------------------------- */
const Lng = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);
const Position = z.tuple([Lng, Lat]);

export const GeoJSONLineString = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(Position).min(2),
});

const LinearRing = z.array(Position).min(4); // 閉塞性の厳密検証はクライアント側に委譲
export const GeoJSONPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(LinearRing).min(1),
});

export const GeoJSONMultiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(LinearRing).min(1)).min(1),
});

/* ----------------------------- 列挙・表記ゆれ ---------------------------- */
/** 入力側が許可する単位の列挙（"m3" も許容） */
const UnitIn = z.union([
  z.literal("ha"),
  z.literal("m³"),
  z.literal("m3"),
  z.literal("本"),
  z.literal("m"),
]);

/** 変換後（出力）の正規化済み単位 */
const UnitOut = z.union([
  z.literal("ha"),
  z.literal("m³"),
  z.literal("本"),
  z.literal("m"),
]);

const Weather = z.union([
  z.literal("晴"),
  z.literal("曇"),
  z.literal("雨"),
  z.literal("雪"),
  z.literal("その他"),
]);
const Incident = z.union([z.literal("無"), z.literal("軽微"), z.literal("事故")]);

/* ------------------------------- ReportSchema --------------------------- */
/**
 * 日報。既存実装のゆらぎ（unit / output_unit、数値文字列）をサーバ側で吸収し、
 * 正規化して { unit } に統一して返す。
 * ※ 型エラー回避のため、入力 unit/output_unit も列挙（UnitIn）で受ける。
 */
const ReportBase = z
  .object({
    org_id: SafeStr(1, 100),
    work_date: z
      .string()
      .regex(ISO_DATE_RE, "YYYY-MM-DD 形式で指定してください")
      .refine((s: string) => isValidYMD(s), "存在しない日付です"),
    task_code: SafeStr(1, 64),
    output_value: Num.nonnegative(),

    // どちらか必須（出力では unit に統一）
    unit: UnitIn.optional(),
    output_unit: UnitIn.optional(),

    note: SafeStr(0, 1000).optional(),

    // オプション（MVPでは任意）
    worker_id: SafeStr(1, 64).optional(),
    worker_name: SafeStr(1, 100).optional(),
    team: SafeStr(1, 100).optional(),
    site_id: SafeStr(1, 100).optional(),
    stand_id: SafeStr(1, 100).optional(),

    work_time_min: Num.nonnegative().optional(),
    machine_time_min: Num.nonnegative().optional(),
    weather: Weather.optional(),
    incident: Incident.optional(),

    // 写真URLなど（保存しない場合もあるため任意）
    photos: z.array(SafeStr(1, 2048)).max(5).optional(),
  })
  .strict();

export const ReportSchema = ReportBase
  .refine((d) => !!(d.unit || d.output_unit), {
    path: ["unit"],
    message: "unit もしくは output_unit を指定してください",
  })
  .transform((d) => {
    // "m3" を "m³" に正規化し、UnitOut で厳格化
    const candidate = (d.unit ?? d.output_unit)!;
    const normalized = candidate === "m3" ? "m³" : candidate;
    const u = UnitOut.parse(normalized);
    const { unit: _u, output_unit: _ou, ...rest } = d;
    return { ...rest, unit: u };
  });

/* ------------------------------- PlanSchema ----------------------------- */
/**
 * 施業計画。POST 時にも geom 等を任意許容（将来互換）。
 * 期間整合（from <= to）や数値の正規化を追加。
 */
const PlanBase = z
  .object({
    org_id: SafeStr(1, 100),
    name: SafeStr(1, 200),
    period_from: z
      .string()
      .regex(ISO_DATE_RE, "YYYY-MM-DD 形式で指定してください")
      .refine((s: string) => isValidYMD(s), "存在しない日付です"),
    period_to: z
      .string()
      .regex(ISO_DATE_RE, "YYYY-MM-DD 形式で指定してください")
      .refine((s: string) => isValidYMD(s), "存在しない日付です"),

    // 任意（POST/PATCH 共通）
    geom: z.union([GeoJSONPolygon, GeoJSONMultiPolygon]).optional(),
    task_type: SafeStr(1, 64).optional(),
    target_volume: Num.nonnegative().optional(), // m³ など
    status_pct: Num.min(0).max(100).optional(), // PATCH でも使う
    assignee: SafeStr(1, 100).optional(),
  })
  .strict();

export const PlanSchema = PlanBase.refine(
  (d) => new Date(d.period_from) <= new Date(d.period_to),
  { path: ["period_from"], message: "period_from は period_to 以前である必要があります" }
);

/* ------------------------------- TrackSchema ---------------------------- */
/**
 * 軌跡。時間整合（start <= end）の検証と、数値の強制変換を追加。
 */
const TrackBase = z
  .object({
    report_id: SafeStr(1, 128),
    geom: GeoJSONLineString,
    start: z
      .string()
      .refine((s: string) => !Number.isNaN(Date.parse(s)), "ISO日時で指定してください"),
    end: z
      .string()
      .refine((s: string) => !Number.isNaN(Date.parse(s)), "ISO日時で指定してください"),
    length_m: Num.nonnegative(),
  })
  .strict();

export const TrackSchema = TrackBase.refine(
  (d) => new Date(d.start) <= new Date(d.end),
  { path: ["start"], message: "start は end 以前である必要があります" }
);

/* -------------------------- （オプション）Query用 ------------------------ */
/**
 * trees/search のクエリ検証に使えるスキーマ。
 */
const TreesSearchBase = z
  .object({
    species: SafeStr(1, 200).optional(), // カンマ区切り対応（サーバ側で split）
    height_min: Num.min(0).max(100).optional(),
    height_max: Num.min(0).max(100).optional(),
    dbh_min: Num.min(0).max(200).optional(),
    dbh_max: Num.min(0).max(200).optional(),
    limit: Num.min(1).max(2000).optional(),
  })
  .strict();

export const TreesSearchQuerySchema = TreesSearchBase
  .refine(
    (q) =>
      q.height_min != null && q.height_max != null
        ? q.height_min <= q.height_max
        : true,
    { path: ["height_min"], message: "height_min は height_max 以下にしてください" }
  )
  .refine(
    (q) =>
      q.dbh_min != null && q.dbh_max != null
        ? q.dbh_min <= q.dbh_max
        : true,
    { path: ["dbh_min"], message: "dbh_min は dbh_max 以下にしてください" }
  );

/**
 * /plans 一覧の limit など
 */
export const PlansListQuerySchema = z
  .object({
    limit: Num.min(1).max(200).optional(),
  })
  .strict();

/* ------------------------------ 型エクスポート --------------------------- */
export type ReportInput = z.infer<typeof ReportSchema>;
export type PlanInput = z.infer<typeof PlanSchema>;
export type TrackInput = z.infer<typeof TrackSchema>;
