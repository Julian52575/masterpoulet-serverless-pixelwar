const { trace, context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, TraceFlags, isSpanContextValid } = require("@opentelemetry/api");
const { W3CTraceContextPropagator } = require("@opentelemetry/core");
const { AsyncLocalStorageContextManager } = require("@opentelemetry/context-async-hooks");
const { BasicTracerProvider, BatchSpanProcessor, TraceIdRatioBasedSampler } = require("@opentelemetry/sdk-trace-base");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const TRACER = "pixelwar";
const EXPORT_TIMEOUT_MS = 1500;
const TELEMETRY_URL = "https://telemetry.googleapis.com/v1/traces";
const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const INTERNAL_HOSTS = ["metadata.google.internal", "169.254.169.254"];

let provider = null;

function tracingEnabled(env) {
  if (env.TRACING_ENABLED === undefined || env.TRACING_ENABLED === "") return Boolean(env.K_SERVICE);
  return env.TRACING_ENABLED === "true";
}

function sampleRatio(value) {
  if (value === undefined || value === "") return 1;
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}

const projectOf = (env) => env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || "";

function cloudExporter() {
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM });
  return new OTLPTraceExporter({
    url: TELEMETRY_URL,
    timeoutMillis: EXPORT_TIMEOUT_MS,
    headers: async () => Object.fromEntries(new Headers(await (await auth.getClient()).getRequestHeaders()))
  });
}

function traceFetchCalls() {
  const { UndiciInstrumentation } = require("@opentelemetry/instrumentation-undici");
  return new UndiciInstrumentation({
    requireParentforSpans: true,
    ignoreRequestHook: (request) => INTERNAL_HOSTS.some((host) => String(request.origin).includes(host))
  });
}

function startTracing({ service, env = process.env, exporter = null } = {}) {
  if (provider) return provider;

  const project = projectOf(env);
  const enabled = tracingEnabled(env) && Boolean(project);
  if (tracingEnabled(env) && !project) {
    console.error(JSON.stringify({ severity: "WARNING", message: "tracing disabled: GOOGLE_CLOUD_PROJECT is not set", function: service }));
  }
  const exporters = [exporter, enabled ? cloudExporter() : null].filter(Boolean);

  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": service, ...(project ? { "gcp.project_id": project } : {}) }),
    sampler: new TraceIdRatioBasedSampler(sampleRatio(env.TRACE_SAMPLE_RATIO)),
    spanProcessors: exporters.map((target) => new BatchSpanProcessor(target, { exportTimeoutMillis: EXPORT_TIMEOUT_MS }))
  });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  if (enabled) traceFetchCalls();

  return provider;
}

async function flushTraces() {
  if (!provider) return;
  try {
    await provider.forceFlush();
  } catch (error) {
    console.error(JSON.stringify({ severity: "WARNING", message: "could not export traces", error: String(error?.message ?? error) }));
  }
}

function cleanAttributes(attributes = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === "") continue;
    clean[key] = typeof value === "number" || typeof value === "boolean" ? value : String(value);
  }
  return clean;
}

function inSpan(name, { kind = SpanKind.INTERNAL, parent = null, attributes = {} } = {}, fn) {
  const parentContext = parent ? propagation.extract(ROOT_CONTEXT, parent) : context.active();
  return trace.getTracer(TRACER).startActiveSpan(name, { kind, attributes: cleanAttributes(attributes) }, parentContext, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

function recordStatus(span, statusCode) {
  span.setAttribute("http.response.status_code", statusCode);
  if (statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
}

function annotate(attributes) {
  trace.getActiveSpan()?.setAttributes(cleanAttributes(attributes));
}

function traceContext() {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

function traceFields(env = process.env) {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};

  const fields = { trace_id: spanContext.traceId, span_id: spanContext.spanId };
  const project = projectOf(env);
  if (!project) return fields;

  return {
    ...fields,
    "logging.googleapis.com/trace": `projects/${project}/traces/${spanContext.traceId}`,
    "logging.googleapis.com/spanId": spanContext.spanId,
    "logging.googleapis.com/trace_sampled": (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED
  };
}

module.exports = {
  startTracing,
  flushTraces,
  inSpan,
  recordStatus,
  annotate,
  traceContext,
  traceFields,
  tracingEnabled,
  sampleRatio,
  SpanKind
};
