import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.logLevel).toBe("info");
  });

  it("reads and coerces provided values", () => {
    const cfg = loadConfig({ PORT: "8080", NODE_ENV: "production", LOG_LEVEL: "debug" });
    expect(cfg.port).toBe(8080);
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("debug");
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("fails fast on non-numeric PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });

  it("fails fast on out-of-enum NODE_ENV", () => {
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
