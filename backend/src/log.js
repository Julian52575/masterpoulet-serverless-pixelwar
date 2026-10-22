const { trace } = require("@opentelemetry/api");

const SERVICE = process.env.OTEL_SERVICE_NAME || "backend";

// One JSON object per line on stdout: the log collector parses it without per-service rules,
// and trace_id links each line to its trace.
function write(level, message, fields = {}, out = process.stdout) {
  const span = trace.getActiveSpan()?.spanContext();
  const entry = { time: new Date().toISOString(), level, service: SERVICE, message, ...fields };
  if (span) Object.assign(entry, { trace_id: span.traceId, span_id: span.spanId });
  if (entry.error instanceof Error) entry.error = entry.error.stack || entry.error.message;
  out.write(`${JSON.stringify(entry)}\n`);
}

const log = {
  info: (message, fields) => write("info", message, fields),
  warn: (message, fields) => write("warn", message, fields),
  error: (message, fields) => write("error", message, fields),
};

module.exports = { log, write };
