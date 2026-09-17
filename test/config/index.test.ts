import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";

describe("loadConfig", () => {
  it("applies defaults when env has only required vars", () => {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm" });
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.mongodbUri).toBe("mongodb://localhost:27017");
    expect(cfg.mongodbDbName).toBe("pm");
  });

  it("fails fast when MONGODB_URI is missing", () => {
    expect(() => loadConfig({ MONGODB_DB_NAME: "pm" })).toThrow(/MONGODB_URI/);
  });

  it("fails fast when MONGODB_DB_NAME is missing", () => {
    expect(() => loadConfig({ MONGODB_URI: "mongodb://localhost:27017" })).toThrow(/MONGODB_DB_NAME/);
  });

  it("fails fast when MONGODB_URI is empty", () => {
    expect(() => loadConfig({ MONGODB_URI: "", MONGODB_DB_NAME: "pm" })).toThrow(/MONGODB_URI/);
  });

  it("reads and coerces provided values", () => {
    const cfg = loadConfig({
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "pm",
      PORT: "8080",
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("debug");
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm" });
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("fails fast on non-numeric PORT", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", PORT: "abc" }),
    ).toThrow(/PORT/);
  });

  it("fails fast on out-of-enum NODE_ENV", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", NODE_ENV: "staging" }),
    ).toThrow(/NODE_ENV/);
  });

  it("fails fast on invalid LOG_LEVEL", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", LOG_LEVEL: "verbose" }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("fails fast on empty HOST", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", HOST: "" }),
    ).toThrow(/HOST/);
  });
});
