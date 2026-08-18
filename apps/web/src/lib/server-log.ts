import { sanitizeLogValue } from "@/lib/log-safety";

type LogLevel = "error" | "info" | "warn";
type LogValue = boolean | number | string | null | undefined;

export function logServerEvent(
  level: LogLevel,
  event: string,
  details: Record<string, LogValue> = {},
) {
  const record: Record<string, boolean | number | string | null> = {
    timestamp: new Date().toISOString(),
    level,
    service: "bytech-project-management",
    event: sanitizeLogValue(event, "event"),
  };

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    record[key] = typeof value === "string" ? sanitizeLogValue(value, key) : value;
  }

  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
}
