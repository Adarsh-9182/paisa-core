import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAaProvider } from "@/lib/account-aggregator";
import { connectAccounts } from "@/lib/aa-ingest";
import { AA_REF_COOKIE } from "../connect/route";

/**
 * Redirect-mode return: the AA (Setu) sends the user back here after they
 * approve/reject the consent. We poll the consent to ACTIVE, pull the data,
 * import it, and land the user back on Money.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/money?aa=${status}`, origin));
    res.cookies.set(AA_REF_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const jar = await cookies();
  const ref = jar.get(AA_REF_COOKIE)?.value;
  if (!ref) return back("expired");

  const aa = getAaProvider();
  try {
    let status = await aa.consentStatus(ref);
    for (let i = 0; i < 3 && status === "PENDING"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      status = await aa.consentStatus(ref);
    }
    if (status !== "ACTIVE") return back(status.toLowerCase());

    const accounts = await aa.fetchData(ref);
    if (accounts.length === 0) return back("nodata");
    await connectAccounts(ref, "", "Bank", accounts);
    return back("connected");
  } catch {
    return back("failed");
  }
}
