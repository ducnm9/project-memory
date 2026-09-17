import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";

describe("buildApp", () => {
  it("assembles an app that serves health routes", async () => {
    const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("wires the error handler for unknown errors", async () => {
    const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
    app.get("/boom", async () => {
      throw new Error("should not leak");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
