/**
 * PULL-IA / SoftStack — Weekly Newsletter Curator & HTML Generator
 *
 * Selects the highest-impact articles of the week across the 4 core sections
 * (Inteligencia Artificial, Ingeniería, Modelos, Empleabilidad) and builds
 * a structured executive digest in Spanish.
 */

import prisma from "@/lib/db/prisma";
import { ArticleStatus, Category } from "@/types";
import { sendNewsletterEmail } from "@/lib/email/sender";

export interface DigestArticle {
  id: string;
  titleEs: string;
  summaryEs: string;
  category: string;
  keyPoints: string[];
  sourceName: string;
  url: string;
  relevanceScore: number;
  publishedAt: string;
}

export interface WeeklyDigest {
  titleEs: string;
  weekLabel: string;
  totalSelected: number;
  sections: {
    AI: DigestArticle[];
    ENGINEERING: DigestArticle[];
    MODELS: DigestArticle[];
    EMPLOYABILITY: DigestArticle[];
  };
  flatArticles: DigestArticle[];
}

const SECTION_LABELS: Record<string, string> = {
  AI: "🧠 Inteligencia Artificial & Agentes",
  ENGINEERING: "🛠️ Ingeniería, Arquitectura & Ciberseguridad",
  MODELS: "⚡ Modelos Fundacionales & Benchmarks",
  EMPLOYABILITY: "💼 Empleabilidad, Salarios & Mercado Tech",
};

/**
 * Curates the top most relevant articles from the last 7 days (fallback 30 days)
 * balanced across the 4 technical sections.
 */
export async function buildWeeklyNewsletterDigest(
  allowedCategories?: string[]
): Promise<WeeklyDigest> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let rawArticles = await prisma.article.findMany({
    where: {
      status: ArticleStatus.PUBLISHED,
      summary: { isNot: null },
      OR: [
        { publishedAt: { gte: sevenDaysAgo } },
        { aiModelSpec: { isNot: null } },
      ],
    },
    include: {
      source: { select: { name: true } },
      summary: true,
      aiModelSpec: true,
    },
    orderBy: [
      { summary: { finalScore: "desc" } },
      { publishedAt: "desc" },
    ],
    take: 60,
  });

  if (rawArticles.length < 4) {
    rawArticles = await prisma.article.findMany({
      where: {
        status: ArticleStatus.PUBLISHED,
        summary: { isNot: null },
        publishedAt: { gte: thirtyDaysAgo },
      },
      include: {
        source: { select: { name: true } },
        summary: true,
        aiModelSpec: true,
      },
      orderBy: [
        { summary: { finalScore: "desc" } },
        { publishedAt: "desc" },
      ],
      take: 60,
    });
  }

  const sections: WeeklyDigest["sections"] = {
    AI: [],
    ENGINEERING: [],
    MODELS: [],
    EMPLOYABILITY: [],
  };

  for (const a of rawArticles) {
    if (!a.summary) continue;

    let cat = a.aiModelSpec ? "MODELS" : (a.summary.category as string);
    if (cat === "PROGRAMMING") cat = "ENGINEERING";
    if (!["AI", "ENGINEERING", "MODELS", "EMPLOYABILITY"].includes(cat)) {
      cat = "ENGINEERING";
    }

    if (
      allowedCategories &&
      allowedCategories.length > 0 &&
      !allowedCategories.includes(cat)
    ) {
      continue;
    }

    const bucket = sections[cat as keyof WeeklyDigest["sections"]];
    if (bucket.length < 2) {
      bucket.push({
        id: a.id,
        titleEs: a.summary.titleEs,
        summaryEs: a.summary.summaryEs,
        category: cat,
        keyPoints: a.summary.keyPoints.slice(0, 3),
        sourceName: a.source.name,
        url: a.url,
        relevanceScore: a.summary.relevanceScore,
        publishedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
      });
    }
  }

  const flatArticles = [
    ...sections.AI,
    ...sections.MODELS,
    ...sections.ENGINEERING,
    ...sections.EMPLOYABILITY,
  ];

  const now = new Date();
  const weekLabel = now.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return {
    titleEs: `Boletín Semanal SoftStack • Deplhoy (${weekLabel})`,
    weekLabel,
    totalSelected: flatArticles.length,
    sections,
    flatArticles,
  };
}

/**
 * Builds the executive HTML email for the Weekly Digest.
 */
export function buildWeeklyNewsletterHtml(
  digest: WeeklyDigest,
  unsubscribeUrl: string
): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://deplhoy-zeta.vercel.app";

  const renderSection = (key: keyof WeeklyDigest["sections"]) => {
    const items = digest.sections[key];
    if (!items || items.length === 0) return "";

    const cardsHtml = items
      .map((item) => {
        const firstParagraph = item.summaryEs.split("\n\n")[0] || item.summaryEs;
        const pointsHtml = item.keyPoints
          .map(
            (pt) =>
              `<li style="margin-bottom: 6px; color: #cbd5e1; font-size: 13px;">${pt}</li>`
          )
          .join("");

        return `
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
          <div style="font-size: 11px; color: #818cf8; font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">
            ${item.sourceName} • Relevancia ${Math.round(item.relevanceScore * 100)}%
          </div>
          <h3 style="margin: 0 0 10px; font-size: 17px; color: #ffffff; line-height: 1.4;">
            ${item.titleEs}
          </h3>
          <p style="margin: 0 0 12px; font-size: 14px; color: #a1a1aa; line-height: 1.6;">
            ${firstParagraph}
          </p>
          ${
            pointsHtml
              ? `<ul style="margin: 0 0 14px; padding-left: 18px;">${pointsHtml}</ul>`
              : ""
          }
          <a href="${item.url}" style="color: #6366f1; font-size: 13px; font-weight: 600; text-decoration: none;">
            Leer fuente oficial →
          </a>
        </div>`;
      })
      .join("");

    return `
      <div style="margin-bottom: 28px;">
        <h2 style="font-size: 15px; font-weight: 800; color: #e4e4e7; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin: 0 0 14px;">
          ${SECTION_LABELS[key]}
        </h2>
        ${cardsHtml}
      </div>`;
  };

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${digest.titleEs}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 32px 16px;">
  <div style="max-width: 640px; margin: 0 auto; background: #09090b;">
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #09090b 100%); border: 1px solid #312e81; border-radius: 16px; padding: 28px; margin-bottom: 24px; text-align: center;">
      <span style="display: inline-block; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 999px; margin-bottom: 12px;">
        SOFTSTACK • DEPLHOY WEEKLY
      </span>
      <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 900; color: #ffffff;">
        Resumen Ejecutivo de la Semana
      </h1>
      <p style="margin: 0; font-size: 13px; color: #a1a1aa;">
        Edición del ${digest.weekLabel} • Las ${digest.totalSelected} noticias tecnológicas de mayor impacto
      </p>
    </div>

    ${renderSection("AI")}
    ${renderSection("MODELS")}
    ${renderSection("ENGINEERING")}
    ${renderSection("EMPLOYABILITY")}

    <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #27272a;">
      <a href="${siteUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: 700; font-size: 14px; margin-bottom: 16px;">
        Explorar todas las noticias en Deplhoy →
      </a>
      <p style="font-size: 12px; color: #71717a; margin: 12px 0 0;">
        Recibes este correo porque te suscribiste al boletín semanal de SoftStack en Deplhoy.<br/>
        <a href="${unsubscribeUrl}" style="color: #71717a; text-decoration: underline;">Cancelar suscripción</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Creates a NewsletterIssue record and sends the weekly digest to all active subscribers.
 */
export async function dispatchWeeklyNewsletterIssue(): Promise<{
  issueId: string;
  articlesCount: number;
  subscribersCount: number;
  sentCount: number;
}> {
  const digest = await buildWeeklyNewsletterDigest();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://deplhoy-zeta.vercel.app";

  const issue = await prisma.newsletterIssue.create({
    data: {
      titleEs: digest.titleEs,
      titleEn: `SoftStack Weekly Digest (${digest.weekLabel})`,
      articleIds: digest.flatArticles.map((a) => a.id),
      status: "SENT",
      sentAt: new Date(),
    },
  });

  const subscribers = await prisma.subscriber.findMany({
    where: {
      unsubscribedAt: null,
      status: { not: "UNSUBSCRIBED" },
    },
  });

  let sentCount = 0;
  for (const sub of subscribers) {
    try {
      const subDigest = await buildWeeklyNewsletterDigest(sub.interests);
      const unsubUrl = `${appUrl}/api/subscribe?unsubscribe=${sub.unsubscribeToken}`;
      const html = buildWeeklyNewsletterHtml(subDigest, unsubUrl);

      await sendNewsletterEmail(sub.email, sub.unsubscribeToken, html, subDigest.titleEs);

      await prisma.newsletterSend.create({
        data: {
          subscriberId: sub.id,
          issueId: issue.id,
          status: "SENT",
          sentAt: new Date(),
        },
      });
      sentCount++;
    } catch (err) {
      console.warn(`[Newsletter] Could not send to ${sub.email}:`, err);
    }
  }

  return {
    issueId: issue.id,
    articlesCount: digest.totalSelected,
    subscribersCount: subscribers.length,
    sentCount,
  };
}
