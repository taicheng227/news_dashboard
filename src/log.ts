export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  runId?: string | number | null;
  sourceSlug?: string | null;
  itemId?: string | number | null;
  [key: string]: unknown;
}

export function logEvent(
  level: LogLevel,
  operation: string,
  message: string,
  context: LogContext = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    operation,
    ...context,
    message,
  };
  const output = JSON.stringify(record);
  if (level === "error" || level === "warn") console.error(output);
  else console.log(output);
}
