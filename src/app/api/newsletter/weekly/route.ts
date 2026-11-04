import { NextRequest, NextResponse } from "next/server";
import {
  buildWeeklyNewsletterDigest,
  dispatchWeeklyNewsletterIssue,
} from "@/lib/email/newsletter";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/newsletter/weekly
 * - When invoked by Vercel Cron (`vercel-cron` User-Agent, `x-vercel-cron`, or `?dispatch=true`),
 *   dispatches the Weekly Newsletter Issue to all confirmed subscribers.
 * - Otherwise returns a preview of the curated Weekly Digest across the 4 sections.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAgent = (request.headers.get("user-agent") ?? "").toLowerCase();
    const isVercelCron =
      userAgent.includes("vercel-cron") ||
      request.headers.get("x-vercel-cron") !== null;
    const hasCronSecret = Boolean(
      process.env.CRON_SECRET &&
        (request.headers.get("authorization") ===
          `Bearer ${process.env.CRON_SECRET}` ||
          searchParams.get("key") === process.env.CRON_SECRET)
    );
    const hasDispatchQuery = searchParams.get("dispatch") === "true";

    const isCron = isVercelCron || hasCronSecret || hasDispatchQuery;

    // If this serverless instance has no DATABASE_URL configured, proxy to backend
    if (!process.env.DATABASE_URL) {
      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.BACKEND_URL ||
        "https://pull-ia-back.vercel.app";

      const targetUrl = new URL(`${backendUrl}/api/newsletter/weekly`);
      if (isCron) targetUrl.searchParams.set("dispatch", "true");

      const proxyRes = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "vercel-cron/1.0",
          ...(process.env.CRON_SECRET
            ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
            : {}),
        },
      });
      const proxyData = await proxyRes.json();
      return NextResponse.json(proxyData, {
        status: proxyRes.status,
        headers: CORS_HEADERS,
      });
    }

    if (isCron) {
      const result = await dispatchWeeklyNewsletterIssue();
      return NextResponse.json(
        {
          success: true,
          cronTriggered: true,
          message: `Boletín semanal enviado automáticamente (${result.articlesCount} noticias clave para ${result.subscribersCount} suscriptores activos).`,
          ...result,
        },
        { headers: CORS_HEADERS }
      );
    }

    const digest = await buildWeeklyNewsletterDigest();
    return NextResponse.json(
      {
        success: true,
        digest,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Newsletter Weekly GET] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "No se pudo procesar el boletín semanal.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /api/newsletter/weekly
 * Dispatches the Weekly Newsletter Issue to all confirmed subscribers.
 */
export async function POST(request: NextRequest) {
  try {
    // If this serverless instance has no DATABASE_URL configured, proxy to backend
    if (!process.env.DATABASE_URL) {
      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.BACKEND_URL ||
        "https://pull-ia-back.vercel.app";

      const proxyRes = await fetch(`${backendUrl}/api/newsletter/weekly`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.CRON_SECRET
            ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
            : {}),
        },
      });
      const proxyData = await proxyRes.json();
      return NextResponse.json(proxyData, {
        status: proxyRes.status,
        headers: CORS_HEADERS,
      });
    }

    const result = await dispatchWeeklyNewsletterIssue();
    return NextResponse.json(
      {
        success: true,
        message: `Boletín semanal generado con ${result.articlesCount} noticias clave para ${result.subscribersCount} suscriptores activos.`,
        ...result,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Newsletter Weekly POST] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "No se pudo procesar el envío del boletín semanal.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
