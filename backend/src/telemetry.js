// Preloaded with `node --require`, so instrumentations patch http, express and amqplib
// before the app requires them. Exporter settings come from the standard OTEL_* variables.
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { HttpInstrumentation } = require("@opentelemetry/instrumentation-http");
const { ExpressInstrumentation } = require("@opentelemetry/instrumentation-express");
const { AmqplibInstrumentation } = require("@opentelemetry/instrumentation-amqplib");
const { PrismaInstrumentation } = require("@prisma/instrumentation");

function startTelemetry(env = process.env) {
  // Tracing stays off unless a collector is configured (tests, bare `npm start`).
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME || "backend",
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      // Probes and scrapes would drown real requests.
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === "/health" }),
      new ExpressInstrumentation(),
      // Propagates the trace context in AMQP headers, linking API and worker spans.
      new AmqplibInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  process.once("SIGTERM", () => sdk.shutdown().catch(() => {}));
  return sdk;
}

if (!process.env.JEST_WORKER_ID) startTelemetry();

module.exports = { startTelemetry };
