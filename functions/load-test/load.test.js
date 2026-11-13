const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { execFile } = require("node:child_process");
const path = require("node:path");
const {
  parseOptions,
  planDraw,
  sendDraw,
  runLoad,
  percentile,
  summarize,
  report,
  loggingFilter,
  correlationIdOf,
  newRunId,
  UsageError
} = require("./load");

const ENV = { PIXELWAR_TOKENS: "token-a, token-b" };
const URL_ARGS = ["--url", "https://gateway.example/api/"];
const CORRELATION_ID = /^[A-Za-z0-9_-]{8,64}$/;

describe("parseOptions", () => {
  test("uses the defaults and reads the tokens from the environment", () => {
    const options = parseOptions(URL_ARGS, ENV);
    assert.equal(options.url, "https://gateway.example/api");
    assert.deepEqual(options.tokens, ["token-a", "token-b"]);
    assert.equal(options.route, "pixel");
    assert.equal(options.requests, 200);
    assert.equal(options.concurrency, 20);
    assert.equal(options.rate, 0);
  });

  test("reads every option", () => {
    const options = parseOptions(
      [...URL_ARGS, "--requests", "50", "--concurrency", "5", "--rate", "10", "--route", "brush", "--size", "8", "--x", "100", "--y", "200", "--width", "64", "--timeout", "3"],
      ENV
    );
    assert.deepEqual(
      { ...options, tokens: undefined, url: undefined },
      { tokens: undefined, url: undefined, route: "brush", requests: 50, concurrency: 5, rate: 10, size: 8, x: 100, y: 200, width: 64, timeout: 3 }
    );
  });

  test("returns help without asking for anything else", () => {
    assert.deepEqual(parseOptions(["--help"], {}), { help: true });
  });

  const refused = [
    ["no url", [], ENV, /--url is required/],
    ["no token", URL_ARGS, {}, /PIXELWAR_TOKENS/],
    ["blank tokens", URL_ARGS, { PIXELWAR_TOKENS: " , " }, /PIXELWAR_TOKENS/],
    ["plain http to a remote host", ["--url", "http://gateway.example/api"], ENV, /https/],
    ["not a url", ["--url", "gateway"], ENV, /full URL/],
    ["unknown option", [...URL_ARGS, "--token", "x"], ENV, /unknown option/],
    ["missing value", [...URL_ARGS, "--requests"], ENV, /needs a value/],
    ["stray argument", [...URL_ARGS, "50"], ENV, /unexpected argument/],
    ["bad route", [...URL_ARGS, "--route", "line"], ENV, /pixel or brush/],
    ["brush too big", [...URL_ARGS, "--size", "17"], ENV, /--size/],
    ["zero requests", [...URL_ARGS, "--requests", "0"], ENV, /--requests/],
    ["decimal concurrency", [...URL_ARGS, "--concurrency", "1.5"], ENV, /--concurrency/],
    ["zone outside the grid", [...URL_ARGS, "--x", "9990", "--width", "20"], ENV, /--width/]
  ];
  for (const [name, argv, env, message] of refused) {
    test(`refuses ${name}`, () => {
      assert.throws(() => parseOptions(argv, env), (error) => error instanceof UsageError && message.test(error.message));
    });
  }

  test("allows plain http only for a local function", () => {
    assert.equal(parseOptions(["--url", "http://localhost:8080"], ENV).url, "http://localhost:8080");
  });
});

describe("planDraw", () => {
  const options = parseOptions([...URL_ARGS, "--x", "100", "--y", "200", "--width", "10"], ENV);

  test("draws a pixel inside the zone with a valid color", () => {
    for (const value of [0, 0.5, 0.9999]) {
      const draw = planDraw(0, options, () => value);
      assert.equal(draw.url, "https://gateway.example/api/pixels");
      assert.ok(draw.body.x >= 100 && draw.body.x < 110);
      assert.ok(draw.body.y >= 200 && draw.body.y < 210);
      assert.match(draw.body.color, /^#[0-9a-f]{6}$/);
      assert.equal(draw.body.size, undefined);
    }
  });

  test("spreads the draws over the users in turn", () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => planDraw(i, options).token), ["token-a", "token-b", "token-a", "token-b"]);
  });

  test("sends the brush size on the brush route", () => {
    const brush = parseOptions([...URL_ARGS, "--route", "brush", "--size", "8"], ENV);
    const draw = planDraw(0, brush);
    assert.equal(draw.url, "https://gateway.example/api/brush");
    assert.equal(draw.body.size, 8);
  });
});

describe("correlation ids", () => {
  test("are accepted by web-proxy and share the run prefix", () => {
    const runId = newRunId();
    assert.match(runId, /^[0-9a-f]{8}$/);
    for (const index of [0, 999999]) assert.match(correlationIdOf(runId, index), CORRELATION_ID);
    assert.equal(loggingFilter("ab12cd34"), 'jsonPayload.correlation_id=~"^load-ab12cd34-"');
  });
});

describe("sendDraw", () => {
  const draw = { url: "https://gateway.example/api/pixels", token: "token-a", body: { x: 1, y: 2, color: "#ff0000" } };
  const clock = () => {
    let t = 0;
    return () => (t += 25);
  };

  test("posts the draw with the token and the correlation id", async () => {
    let seen;
    const fetch = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
    };
    const result = await sendDraw(draw, "load-ab12cd34-0", { fetch, timeoutSeconds: 5, now: clock() });
    assert.deepEqual(result, { status: 202, ms: 25, accepted: 1 });
    assert.equal(seen.url, draw.url);
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.authorization, "Bearer token-a");
    assert.equal(seen.init.headers["x-correlation-id"], "load-ab12cd34-0");
    assert.deepEqual(JSON.parse(seen.init.body), draw.body);
  });

  test("keeps a refused status and counts no pixel", async () => {
    const fetch = async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    assert.deepEqual(await sendDraw(draw, "load-x-0000", { fetch, timeoutSeconds: 5, now: clock() }), { status: 429, ms: 25, accepted: 0 });
  });

  test("survives a body that is not JSON", async () => {
    const fetch = async () => new Response("<html>", { status: 502 });
    assert.equal((await sendDraw(draw, "load-x-0000", { fetch, timeoutSeconds: 5 })).status, 502);
  });

  test("tells a timeout from a network error", async () => {
    const timeout = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal((await sendDraw(draw, "load-x-0000", { fetch: timeout, timeoutSeconds: 5 })).status, "timeout");
    assert.equal((await sendDraw(draw, "load-x-0000", { fetch: down, timeoutSeconds: 5 })).status, "network");
  });
});

describe("runLoad", () => {
  test("sends every draw once and never more than the concurrency at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const sent = [];
    const send = async (index) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      sent.push(index);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { status: 202, ms: index, accepted: 1 };
    };
    const { results } = await runLoad({ requests: 25, concurrency: 4, send });
    assert.equal(most, 4);
    assert.deepEqual([...sent].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
    assert.deepEqual(results.map((r) => r.ms), Array.from({ length: 25 }, (_, i) => i));
  });

  test("starts draw n no earlier than n / rate seconds", async () => {
    let t = 0;
    const waits = [];
    const sleep = async (ms) => {
      waits.push(ms);
      t += ms;
    };
    const { elapsedMs } = await runLoad({
      requests: 4,
      concurrency: 1,
      rate: 2,
      now: () => t,
      sleep,
      send: async () => ({ status: 202, ms: 0, accepted: 1 })
    });
    assert.deepEqual(waits, [500, 500, 500]);
    assert.equal(elapsedMs, 1500);
  });

  test("does not open more lanes than there are draws", async () => {
    let calls = 0;
    await runLoad({ requests: 2, concurrency: 50, send: async () => ({ status: 202, ms: 1, accepted: 1, n: ++calls }) });
    assert.equal(calls, 2);
  });
});

describe("summarize", () => {
  test("uses the nearest-rank percentile", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile(sorted, 95), 95);
    assert.equal(percentile(sorted, 99), 99);
    assert.equal(percentile([7], 99), 7);
    assert.equal(percentile([], 50), 0);
  });

  test("counts statuses, pixels and throughput", () => {
    const results = [
      { status: 202, ms: 40, accepted: 1 },
      { status: 202, ms: 10, accepted: 16 },
      { status: 429, ms: 30, accepted: 0 },
      { status: "timeout", ms: 20, accepted: 0 }
    ];
    const summary = summarize(results, 2000);
    assert.equal(summary.total, 4);
    assert.equal(summary.queued, 2);
    assert.equal(summary.pixels, 17);
    assert.deepEqual(summary.byStatus, { 202: 2, 429: 1, timeout: 1 });
    assert.equal(summary.perSecond, 2);
    assert.deepEqual(summary.latency, { p50: 20, p95: 40, p99: 40, max: 40 });

    const text = report(summary, "ab12cd34");
    assert.match(text, /202: 2, 429: 1, timeout: 1/);
    assert.match(text, /p50 20 ms, p95 40 ms/);
    assert.match(text, /\^load-ab12cd34-/);
  });
});

describe("against a local HTTP server", () => {
  async function serve(statusOf) {
    const seen = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
      const status = statusOf(seen.length);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(status === 202 ? { accepted: 1 } : { error: "no" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { seen, server, url: `http://127.0.0.1:${server.address().port}/api` };
  }

  function runCli(args, env) {
    return new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, "burst.js"), ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr })
      );
    });
  }

  test("the command sends the burst and prints the report", async () => {
    const { seen, server, url } = await serve((n) => (n % 5 === 0 ? 429 : 202));
    try {
      const { code, stdout } = await runCli(["--url", url, "--requests", "20", "--concurrency", "4"], { PIXELWAR_TOKENS: "tok-1,tok-2" });
      assert.equal(code, 0);
      assert.equal(seen.length, 20);
      assert.ok(seen.every((r) => r.path === "/api/pixels"));
      assert.deepEqual(new Set(seen.map((r) => r.headers.authorization)), new Set(["Bearer tok-1", "Bearer tok-2"]));
      const runId = /run id:\s+([0-9a-f]{8})/.exec(stdout)[1];
      assert.ok(seen.every((r) => r.headers["x-correlation-id"].startsWith(`load-${runId}-`)));
      assert.match(stdout, /queued \(202\):\s+16, 16 pixels accepted/);
      assert.match(stdout, /429: 4/);
      assert.ok(!stdout.includes("tok-1"));
    } finally {
      server.close();
    }
  });

  test("the command fails when nothing was queued", async () => {
    const { server, url } = await serve(() => 401);
    try {
      const { code, stdout } = await runCli(["--url", url, "--requests", "3"], { PIXELWAR_TOKENS: "bad" });
      assert.equal(code, 1);
      assert.match(stdout, /401: 3/);
    } finally {
      server.close();
    }
  });

  test("the command explains a usage mistake", async () => {
    const { code, stderr } = await runCli(["--url", "https://gateway.example/api"], { PIXELWAR_TOKENS: "" });
    assert.equal(code, 2);
    assert.match(stderr, /PIXELWAR_TOKENS/);
    assert.match(stderr, /Usage:/);
  });
});
