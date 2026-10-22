const express = require("express");
const request = require("supertest");
const { registry, httpMetrics } = require("../src/metrics");

describe("metrics", () => {
  it("records request duration by matched route and status", async () => {
    const app = express();
    app.use(httpMetrics);
    app.get("/pixels/:x", (req, res) => res.sendStatus(204));
    await request(app).get("/pixels/7");
    const text = await registry.metrics();
    expect(text).toMatch(/pixelwar_http_request_duration_seconds_count\{method="GET",route="\/pixels\/:x",status="204"\} 1/);
  });
});
