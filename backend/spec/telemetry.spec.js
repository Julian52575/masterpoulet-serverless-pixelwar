jest.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: jest.fn(() => ({ start: jest.fn(), shutdown: jest.fn().mockResolvedValue() })),
}));
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { startTelemetry } = require("../src/telemetry");

describe("telemetry", () => {
  it("stays off without a collector endpoint", () => {
    expect(startTelemetry({})).toBeNull();
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it("starts the SDK when a collector is configured", () => {
    const sdk = startTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318", OTEL_SERVICE_NAME: "api" });
    expect(sdk.start).toHaveBeenCalled();
    expect(NodeSDK.mock.calls[0][0].serviceName).toBe("api");
  });
});
