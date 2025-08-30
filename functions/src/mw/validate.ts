// functions/src/mw/validate.ts
import { z } from "zod";
import { Request, Response, NextFunction } from "express";

/**
 * Zod スキーマで req.body を検証・正規化するミドルウェア。
 * transform()/refine() を含む ZodEffects も受けるため、ZodTypeAny で受けます。
 */
export const validateBody =
  (schema: z.ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.body);
      // 後段が正規化済みの値を使えるように上書き
      (req as any).body = parsed;
      next();
    } catch (e: any) {
      const msg =
        e?.issues?.map((i: any) => i.message).join(", ") ??
        e?.message ??
        "invalid request body";
      res.status(400).json({ error: msg });
    }
  };

/**
 * （必要なら）query/params も同様に検証できるヘルパー。
 */
export const validateQuery =
  (schema: z.ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.query);
      (req as any).query = parsed;
      next();
    } catch (e: any) {
      const msg =
        e?.issues?.map((i: any) => i.message).join(", ") ??
        e?.message ??
        "invalid query";
      res.status(400).json({ error: msg });
    }
  };

export const validateParams =
  (schema: z.ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.params);
      (req as any).params = parsed;
      next();
    } catch (e: any) {
      const msg =
        e?.issues?.map((i: any) => i.message).join(", ") ??
        e?.message ??
        "invalid params";
      res.status(400).json({ error: msg });
    }
  };
