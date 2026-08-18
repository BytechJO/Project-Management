const sensitiveKeyPattern = /(authorization|cookie|password|passwd|secret|token|api[-_]?key)/i;
const sensitiveAssignmentPattern = /\b(password|passwd|secret|token|authorization|cookie|api[-_]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const credentialUrlPattern = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+(@)/gi;

export function sanitizeLogValue(value: string, key = "value") {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";

  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(credentialUrlPattern, "$1[REDACTED]$2")
    .replace(sensitiveAssignmentPattern, "$1=[REDACTED]")
    .slice(0, 1_000);
}

export function errorLogMessage(error: unknown) {
  if (error instanceof Error) return sanitizeLogValue(error.message, "errorMessage");
  return sanitizeLogValue(String(error), "errorMessage");
}
