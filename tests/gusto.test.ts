/**
 * Gusto payroll connector — mapping and transport.
 *
 * The mapping half is pure, so the processed, money and currency rules are
 * checked against fixtures. The transport half is checked with an injected
 * fetch, so request shape and error handling are covered without a token or
 * a network.
 */

import { describe, it, expect } from "vitest";
import {
  mapPayroll,
  mapPayrolls,
  fetchPayrolls,
  fetchPayrollRuns,
  GustoError,
  type GustoPayroll,
} from "../src/erp/gusto.js";

const payroll = (over: Partial<GustoPayroll> = {}): GustoPayroll => ({
  payroll_uuid: "pay_1",
  check_date: "2026-07-31",
  processed: true,
  totals: { gross_pay: "18450.75", net_pay: "14200.50", employer_taxes: "1320.25" },
  employee_compensations: [
    { employee_uuid: "e1", gross_pay: "9225.50" },
    { employee_uuid: "e2", gross_pay: "9225.25" },
  ],
  ...over,
});

const ok = (p: GustoPayroll) => {
  const r = mapPayroll(p);
  if (!("run" in r)) throw new Error(`expected a run, got ${JSON.stringify(r)}`);
  return r.run;
};

describe("mapPayroll — money", () => {
  it("converts decimal totals to paise exactly, without float drift", () => {
    const run = ok(payroll());
    expect(run.grossPay).toBe(1_845_075n);
    expect(run.netPay).toBe(1_420_050n);
    expect(run.employerTaxes).toBe(132_025n);
  });

  it("defaults employer taxes to zero rather than guessing", () => {
    expect(ok(payroll({ totals: { gross_pay: "100.00", net_pay: "80.00" } })).employerTaxes).toBe(0n);
  });

  it("rejects a non-numeric total", () => {
    expect(mapPayroll(payroll({ totals: { gross_pay: "N/A", net_pay: "80.00" } }))).toMatchObject({
      rejected: { reason: /decimal/ },
    });
  });

  it("rejects missing gross or net totals", () => {
    expect(mapPayroll(payroll({ totals: { net_pay: "80.00" } }))).toMatchObject({
      rejected: { reason: /gross_pay/ },
    });
    expect(mapPayroll(payroll({ totals: { gross_pay: "80.00" } }))).toMatchObject({
      rejected: { reason: /net_pay/ },
    });
  });
});

describe("mapPayroll — totals that disagree", () => {
  it("rejects net pay above gross pay", () => {
    expect(mapPayroll(payroll({ totals: { gross_pay: "100.00", net_pay: "120.00" } }))).toMatchObject({
      rejected: { reason: /exceeds gross/ },
    });
  });

  it("rejects a non-positive gross", () => {
    expect(mapPayroll(payroll({ totals: { gross_pay: "0.00", net_pay: "0.00" } }))).toMatchObject({
      rejected: { reason: /gross pay must be positive/ },
    });
  });

  it("rejects negative employer taxes", () => {
    expect(
      mapPayroll(payroll({ totals: { gross_pay: "100.00", net_pay: "80.00", employer_taxes: "-5.00" } })),
    ).toMatchObject({ rejected: { reason: /employer taxes/ } });
  });
});

describe("mapPayroll — processed", () => {
  it("withholds an unprocessed payroll rather than dropping it", () => {
    expect(mapPayroll(payroll({ processed: false }))).toMatchObject({
      withheld: { externalId: "pay_1", reason: /not processed/ },
    });
  });
});

describe("mapPayroll — currency", () => {
  it("rejects a USD run by name instead of converting it", () => {
    expect(mapPayroll(payroll({ currency: "USD" }))).toMatchObject({ rejected: { reason: /USD/ } });
  });
});

describe("mapPayroll — headcount", () => {
  it("counts only employees actually paid", () => {
    expect(ok(payroll()).headcount).toBe(2);
  });

  it("skips excluded and zero-pay rows", () => {
    const run = ok(
      payroll({
        employee_compensations: [
          { employee_uuid: "e1", gross_pay: "100.00" },
          { employee_uuid: "e2", gross_pay: "0.00" },
          { employee_uuid: "e3", gross_pay: "100.00", excluded: true },
          { employee_uuid: "e4" },
        ],
      }),
    );
    expect(run.headcount).toBe(1);
  });

  it("does not double-count a repeated employee", () => {
    const run = ok(
      payroll({
        employee_compensations: [
          { employee_uuid: "e1", gross_pay: "50.00" },
          { employee_uuid: "e1", gross_pay: "50.00" },
        ],
      }),
    );
    expect(run.headcount).toBe(1);
  });
});

describe("mapPayroll — identity", () => {
  it("namespaces the id so it cannot collide with another connector's", () => {
    expect(ok(payroll()).externalId).toBe("gusto:pay_1");
  });

  it("rejects an unusable check date", () => {
    expect(mapPayroll(payroll({ check_date: "31/07/2026" }))).toMatchObject({ rejected: { reason: /check_date/ } });
  });

  it("rejects a payroll with no id", () => {
    expect(mapPayroll(payroll({ payroll_uuid: "" }))).toMatchObject({ rejected: { reason: /payroll_uuid/ } });
  });
});

describe("mapPayrolls", () => {
  it("separates runs, rejections and withholdings", () => {
    const out = mapPayrolls([
      payroll({ payroll_uuid: "a" }),
      payroll({ payroll_uuid: "b", processed: false }),
      payroll({ payroll_uuid: "c", currency: "USD" }),
    ]);
    expect(out.runs.map((r) => r.externalId)).toEqual(["gusto:a"]);
    expect(out.withheld.map((w) => w.externalId)).toEqual(["b"]);
    expect(out.rejected.map((r) => r.externalId)).toEqual(["c"]);
  });
});

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const creds = {
  accessToken: "tok",
  companyId: "co_1",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
} as const;

const jsonResponse = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } });

describe("fetchPayrolls — guards", () => {
  it("refuses to run against Gusto production", async () => {
    await expect(fetchPayrolls({ ...creds, environment: "production" })).rejects.toThrow(GustoError);
  });

  it("requires a token and a company id", async () => {
    await expect(fetchPayrolls({ ...creds, accessToken: "" })).rejects.toThrow(/access token/);
    await expect(fetchPayrolls({ ...creds, companyId: "" })).rejects.toThrow(/company id/);
  });

  it("rejects a malformed date and a backwards range", async () => {
    await expect(fetchPayrolls({ ...creds, startDate: "July 1" })).rejects.toThrow(/startDate/);
    await expect(fetchPayrolls({ ...creds, startDate: "2026-08-01" })).rejects.toThrow(/after endDate/);
  });
});

describe("fetchPayrolls — request", () => {
  it("asks Gusto only for processed payrolls in the range", async () => {
    let seen = "";
    const fetchImpl = (async (url: string) => {
      seen = String(url);
      return jsonResponse([payroll()]);
    }) as unknown as typeof fetch;

    await fetchPayrolls({ ...creds, fetchImpl });
    expect(seen).toContain("/v1/companies/co_1/payrolls");
    expect(seen).toContain("processing_statuses=processed");
    expect(seen).toContain("start_date=2026-07-01");
    expect(seen).toContain("end_date=2026-07-31");
  });

  it("accepts both a bare array and a wrapped page", async () => {
    const bare = (async () => jsonResponse([payroll()])) as unknown as typeof fetch;
    const wrapped = (async () => jsonResponse({ payrolls: [payroll()] })) as unknown as typeof fetch;
    expect(await fetchPayrolls({ ...creds, fetchImpl: bare })).toHaveLength(1);
    expect(await fetchPayrolls({ ...creds, fetchImpl: wrapped })).toHaveLength(1);
  });
});

describe("fetchPayrolls — errors", () => {
  it("quotes Gusto's own message, not the request", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "the access token is expired" }, { status: 401 })) as unknown as typeof fetch;
    await expect(fetchPayrolls({ ...creds, fetchImpl })).rejects.toThrow(/401: the access token is expired/);
  });

  it("never puts the token in the error text", async () => {
    const fetchImpl = (async () => jsonResponse({ message: "boom" }, { status: 500 })) as unknown as typeof fetch;
    await expect(fetchPayrolls({ ...creds, accessToken: "tok-super-secret", fetchImpl })).rejects.not.toThrow(
      /tok-super-secret/,
    );
  });

  it("survives a non-JSON error body", async () => {
    const fetchImpl = (async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchPayrolls({ ...creds, fetchImpl })).rejects.toThrow(/502/);
  });
});

describe("fetchPayrollRuns", () => {
  it("fetches and maps in one call", async () => {
    const fetchImpl = (async () =>
      jsonResponse([payroll({ payroll_uuid: "a" }), payroll({ payroll_uuid: "b", processed: false })])) as unknown as typeof fetch;

    const out = await fetchPayrollRuns({ ...creds, fetchImpl });
    expect(out.runs).toHaveLength(1);
    expect(out.withheld).toHaveLength(1);
  });
});
