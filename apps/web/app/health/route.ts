import { healthResponseSchema } from "@interview/schemas";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    healthResponseSchema.parse({
      status: "ok",
      service: "web",
      timestamp: new Date().toISOString()
    })
  );
}
