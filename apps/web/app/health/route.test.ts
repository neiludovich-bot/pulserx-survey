import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("web health route", () => {
  it("returns a 200 OK payload", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      service: "web"
    });
  });
});
