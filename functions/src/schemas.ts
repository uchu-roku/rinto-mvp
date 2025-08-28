import { z } from 'zod';

export const ReportSchema = z.object({
  org_id: z.string().min(1),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  task_code: z.string().min(1),
  output_value: z.number().nonnegative(),
  unit: z.string().min(1),
  note: z.string().max(1000).optional(),
}).strict();

export const PlanSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
