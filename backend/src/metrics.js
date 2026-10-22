const client = require("prom-client");

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: "pixelwar_http_request_duration_seconds",
  help: "API request duration (the proxy acknowledgement time)",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const commands = new client.Counter({
  name: "pixelwar_commands_total",
  help: "Commands handled by the worker (the invocations), by outcome",
  labelNames: ["type", "outcome"],
  registers: [registry],
});

const commandDuration = new client.Histogram({
  name: "pixelwar_command_duration_seconds",
  help: "Worker processing time per command",
  labelNames: ["type"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// RabbitMQ exposes depth but not message age, so the worker measures how long each command waited.
const commandWait = new client.Histogram({
  name: "pixelwar_command_queue_wait_seconds",
  help: "Time a command spent in the queue before the worker picked it up",
  labelNames: ["type"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

// Uses the matched route, not the URL, to keep label cardinality bounded.
function httpMetrics(req, res, next) {
  const end = httpDuration.startTimer({ method: req.method });
  res.on("finish", () => end({ route: req.route?.path ?? "unmatched", status: res.statusCode }));
  next();
}

module.exports = { registry, httpMetrics, commands, commandDuration, commandWait };
