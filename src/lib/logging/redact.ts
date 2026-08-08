const REDACTED = "[REDACTED]";
const REDACTED_DATABASE_URL = "[REDACTED_DATABASE_URL]";
const REDACTED_QUERY = "[REDACTED_QUERY]";

const SECRET_KEY_PATTERN = /(?:authorization|api.?key|auth.?secret|password|secret.?access.?key|token)$/i;
const PROVIDER_BODY_KEY_PATTERN = /^(?:provider|upstream|response|request).?body$/i;
const SENSITIVE_QUERY_KEY_PATTERN = /(?:credential|key|password|secret|sig(?:nature)?|token)/i;

function sanitizeHttpUrl(rawUrl: string) {
  const trailing = rawUrl.match(/[),.;]+$/)?.[0] ?? "";
  const candidate = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
  try {
    const parsed = new URL(candidate);
    const hasSensitiveQuery = [...parsed.searchParams.keys()].some((key) =>
      SENSITIVE_QUERY_KEY_PATTERN.test(key),
    );
    if (!hasSensitiveQuery) return rawUrl;
    return `${parsed.origin}${parsed.pathname}?${REDACTED_QUERY}${trailing}`;
  } catch {
    return rawUrl;
  }
}

export function redactLogString(rawValue: string) {
  return rawValue
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, REDACTED_DATABASE_URL)
    .replace(/\b(authorization\s*:\s*bearer)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(/\b(x-api-key|api-key)\s*:\s*[^\s,;]+/gi, `$1: ${REDACTED}`)
    .replace(/\bbearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:narra_sk_[A-Za-z0-9._-]+|sk-[A-Za-z0-9._-]{8,})\b/g, REDACTED)
    .replace(
      /\b(auth_?secret|password|api_?key|access_?token|refresh_?token)\s*[=:]\s*([^\s,;]+)/gi,
      `$1=${REDACTED}`,
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, sanitizeHttpUrl);
}

function normalizeKey(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, "");
}

function redactUnknown(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") return redactLogString(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (depth >= 8) return "[MaxDepth]";

  if (value instanceof Error) {
    const result: Record<string, unknown> = {
      message: redactLogString(value.message),
      name: value.name,
    };
    if (value.cause !== undefined) {
      result.cause = redactUnknown(value.cause, seen, depth + 1);
    }
    return result;
  }
  if (value instanceof URL) return redactLogString(value.toString());
  if (value instanceof Date) return value.toISOString();

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      SECRET_KEY_PATTERN.test(normalizedKey) ||
      PROVIDER_BODY_KEY_PATTERN.test(normalizedKey)
    ) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactUnknown(item, seen, depth + 1);
  }
  return result;
}

export function redactLogValue(value: unknown) {
  return redactUnknown(value, new WeakSet<object>(), 0);
}

export function stringifyLogRecord(value: unknown) {
  return JSON.stringify(redactLogValue(value));
}

export const LOG_REDACTION_MARKERS = {
  databaseUrl: REDACTED_DATABASE_URL,
  query: REDACTED_QUERY,
  secret: REDACTED,
} as const;
