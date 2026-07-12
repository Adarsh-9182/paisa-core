import { NextResponse } from "next/server";
import { getAaProvider, fipName } from "@/lib/account-aggregator";
import { consentWindow } from "@/lib/aa-ingest";
import { AS_OF } from "@/lib/engine";

export const AA_REF_COOKIE = "paisa_aa_ref";

const refCookie = () =>
  ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 900 }) as const;

/** GET → provider mode + the list of banks (empty in redirect mode). */
export async function GET() {
  const aa = getAaProvider();
  return NextResponse.json({ sandbox: aa.sandbox, provider: aa.name, mode: aa.mode, fips: aa.listFips() });
}

/**
 * POST — begin a consent.
 *  • inapp (sandbox): { fipId } → returns the consent artefact to review in-app.
 *  • redirect (Setu):  { vua? }  → returns { redirect } to hand off to the AA.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { fipId?: string; vua?: string };
  const aa = getAaProvider();
  const window = consentWindow(AS_OF);

  if (aa.mode === "redirect") {
    try {
      const origin = new URL(request.url).origin;
      const { ref, redirectUrl, consent } = await aa.createConsent({
        vua: body.vua,
        window,
        redirectUrl: `${origin}/api/aa/callback`,
      });
      const res = NextResponse.json({ redirect: redirectUrl, consent });
      res.cookies.set(AA_REF_COOKIE, ref, refCookie());
      return res;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Consent failed" }, { status: 400 });
    }
  }

  // in-app (sandbox)
  if (!body.fipId) return NextResponse.json({ error: "fipId required" }, { status: 400 });
  if (!aa.listFips().some((f) => f.fipId === body.fipId)) {
    return NextResponse.json({ error: "Unknown bank" }, { status: 400 });
  }
  const { ref, consent } = await aa.createConsent({ fipId: body.fipId, window });
  return NextResponse.json({ handle: ref, consent, fipId: body.fipId, fipName: fipName(body.fipId), sandbox: aa.sandbox });
}
