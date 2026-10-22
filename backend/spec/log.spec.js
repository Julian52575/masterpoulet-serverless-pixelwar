const { trace } = require("@opentelemetry/api");
const { write } = require("../src/log");

const capture = () => {
  const lines = [];
  return { lines, out: { write: (line) => lines.push(JSON.parse(line)) } };
};

describe("log", () => {
  it("writes one JSON line with the service and the given fields", () => {
    const { lines, out } = capture();
    write("info", "draw accepted", { correlation_id: "abc" }, out);
    expect(lines[0]).toMatchObject({ level: "info", service: "backend", message: "draw accepted", correlation_id: "abc" });
    expect(Date.parse(lines[0].time)).not.toBeNaN();
  });

  it("adds the active trace and span ids", () => {
    const span = { spanContext: () => ({ traceId: "t1", spanId: "s1" }) };
    jest.spyOn(trace, "getActiveSpan").mockReturnValue(span);
    const { lines, out } = capture();
    write("warn", "x", {}, out);
    expect(lines[0]).toMatchObject({ trace_id: "t1", span_id: "s1" });
  });

  it("serialises errors with their stack", () => {
    const { lines, out } = capture();
    write("error", "x", { error: new Error("boom") }, out);
    expect(lines[0].error).toContain("boom");
  });
});
