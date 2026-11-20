import { z } from "zod";

export const timestampSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const subjectSchema = z.string().min(1).max(512);
