type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const SENSITIVE_KEYS = new Set([
  'patient',
  'patient_name',
  'patient_id',
  'phone',
  'email',
  'address',
  'dob',
  'ssn',
  'insurance',
  'medical',
  'notes',
  'content',
  'text',
  'message',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeLogPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogPayload(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'error' && isPlainObject(childValue)) {
      sanitized[key] = childValue;
      continue;
    }

    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }

    if (typeof childValue === 'string' && childValue.length > 500) {
      sanitized[key] = `${childValue.slice(0, 500)}…`;
      continue;
    }

    sanitized[key] = sanitizeLogPayload(childValue);
  }

  return sanitized;
}

export function logEvent(event: string, context: LogContext = {}, level: LogLevel = 'info') {
  const safeContext = sanitizeLogPayload(context) as LogContext;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeContext,
  };

  const message = JSON.stringify(entry);

  if (level === 'error') {
    console.error(message);
    return;
  }

  if (level === 'warn') {
    console.warn(message);
    return;
  }

  console.info(message);
}
