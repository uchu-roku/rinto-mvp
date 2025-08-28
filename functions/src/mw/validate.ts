import { ZodSchema } from 'zod';

export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  (req: any, res: any, next: any) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', detail: parsed.error.flatten() });
    }
    req.body = parsed.data;
    next();
  };
