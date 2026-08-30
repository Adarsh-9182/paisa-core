/**
 * The demo company, expressed as commands.
 *
 * Every line here goes through the command registry, so the seed is written
 * to the action log exactly once and replayed thereafter. A second server
 * instance rebuilds these books rather than creating a second copy of them.
 *
 * Nimbus Labs Pvt Ltd: six months of trading, two revenue contracts, a
 * recurring vendor that skipped June, and a June close still open with two
 * genuine blockers.
 */

import { parseINR } from "../dist/src/index.js";

export const AS_OF = "2026-07-02";
export const PERIOD_FROM = "2026-01-01";
const ACTOR = "adarsh";
const CONTROLLER = "priya";

const addDays = (iso, days) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const lastDay = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * @param exec  (type, payload, actor?) => Promise<result>
 * @param rt    the PaisaRuntime, for the few reads the seed needs to make
 *              a decision (which flux lines need explaining, what the bank
 *              balance is on a reconciliation date)
 */
export const seedAll = async (exec, rt) => {
  const { org, erp } = rt;

  const post = (date, narration, drId, crId, amt, sourceModule = "manual") =>
    exec("journal.post", {
      date,
      narration,
      lines: [
        { accountId: drId, side: "DEBIT", amount: parseINR(amt) },
        { accountId: crId, side: "CREDIT", amount: parseINR(amt) },
      ],
      sourceModule,
    });

  const invoice = async (number, customer, issueDate, dueDate, amountINR, payDate) => {
    const inv = await exec("invoice.create", {
      input: {
        number,
        customer,
        issueDate,
        dueDate,
        lines: [{ description: "Product subscription & services", amount: parseINR(amountINR), gstRatePct: 18 }],
      },
    });
    await exec("invoice.send", { invoiceId: inv.id });
    if (payDate) await exec("invoice.payment", { invoiceId: inv.id, date: payDate, amount: inv.total });
    return inv;
  };

  /* ---------------- core trading history ---------------- */

  await post("2026-01-01", "Founder capital infusion", "acc_bank", "acc_capital", "45,00,000");

  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, "0");
    await post(`2026-${mm}-01`, "Payroll", "acc_salary", "acc_bank", "3,20,000");
    await post(`2026-${mm}-05`, "Office rent", "acc_rent", "acc_bank", "80,000");
    await post(`2026-${mm}-12`, "GST input credit on vendor bills", "acc_gst_itc", "acc_bank", "35,000", "banking");
    if (m >= 2) await post(`2026-${mm}-20`, "GST payment (GSTR-3B)", "acc_gst_payable", "acc_bank", "1,03,600", "banking");

    await exec("banking.importStatement", {
      lines: [
        { date: `2026-${mm}-03`, description: "AWS subscription", amount: parseINR("-42,000"), reference: `aws-${mm}` },
        { date: `2026-${mm}-04`, description: "Slack subscription", amount: parseINR("-8,500"), reference: `slack-${mm}` },
        { date: `2026-${mm}-04`, description: "Figma annual plan (monthly)", amount: parseINR("-6,200"), reference: `figma-${mm}` },
        { date: `2026-${mm}-06`, description: "Notion workspace", amount: parseINR("-4,100"), reference: `notion-${mm}` },
        { date: `2026-${mm}-06`, description: "GitHub team plan", amount: parseINR("-9,300"), reference: `github-${mm}` },
        { date: `2026-${mm}-10`, description: "LinkedIn ads campaign", amount: parseINR("-45,000"), reference: `li-${mm}` },
        { date: `2026-${mm}-15`, description: "Airtel business broadband", amount: parseINR("-5,500"), reference: `airtel-${mm}` },
      ],
    });

    // Meridian's May invoice stays unpaid, so there is a real overdue item.
    const meridianPaid = m === 5 ? null : `2026-${mm}-22`;
    await invoice(`INV-2026-${mm}A`, "Meridian Retail", `2026-${mm}-03`, addDays(`2026-${mm}-03`, 38), "4,50,000", meridianPaid);
    await invoice(`INV-2026-${mm}B`, "Kite Analytics", `2026-${mm}-08`, addDays(`2026-${mm}-08`, 30), "3,20,000", `2026-${mm}-26`);
  }

  await invoice("INV-2026-06C", "BlueOrbit Systems", "2026-06-24", "2026-07-24", "2,80,000", null);
  await post("2026-07-01", "Payroll", "acc_salary", "acc_bank", "3,20,000");
  await invoice("INV-2026-07A", "Kite Analytics", "2026-07-01", "2026-07-31", "3,20,000", null);
  await invoice("INV-2026-07B", "BlueOrbit Systems", "2026-07-01", "2026-07-31", "2,80,000", null);

  // Two lines the categoriser cannot place — they wait for a human.
  await exec("banking.importStatement", {
    lines: [
      { date: "2026-06-28", description: "IMPS 4032 Chai Point", amount: parseINR("-1,250"), reference: "imps-4032" },
      { date: "2026-06-30", description: "UPI transfer to Rahul", amount: parseINR("-3,400"), reference: "upi-rahul" },
    ],
  });

  await exec("recommendations.generate", { asOf: AS_OF, periodFrom: PERIOD_FROM });

  /* ---------------- revenue contracts, via the CRM connector ---------------- */

  await exec("connector.register", { source: "salesforce", kind: "CRM" });
  await exec("connector.register", { source: "stripe", kind: "BILLING" });

  const sync = await exec("connector.syncCrmDeals", {
    source: "salesforce",
    deals: [
      {
        externalId: "0061",
        name: "Acme — Platform + onboarding",
        accountName: "Acme Pvt Ltd",
        closeDate: "2025-12-20",
        amount: parseINR("36,00,000"),
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        billingFrequency: "QUARTERLY",
        lineItems: [
          { description: "Platform subscription", ssp: parseINR("36,00,000"), method: "RATABLE_MONTHLY" },
          { description: "Onboarding & implementation", ssp: parseINR("4,00,000"), method: "POINT_IN_TIME", endDate: null },
        ],
      },
      {
        externalId: "0074",
        name: "Globex — Growth plan",
        accountName: "Globex Ltd",
        closeDate: "2026-02-10",
        amount: parseINR("18,00,000"),
        startDate: "2026-03-01",
        endDate: "2027-02-28",
        billingFrequency: "MONTHLY",
      },
    ],
  });
  for (const id of sync.created) await exec("contract.activate", { contractId: id }, CONTROLLER);

  await exec("revrec.billDue", { asOf: "2026-06-30", gstRatePct: 18 });
  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    await exec("revrec.recognize", { period: p });
  }

  /* ---------------- payables: a vendor that skipped June ---------------- */

  for (const mm of ["01", "02", "03", "04", "05"]) {
    const bill = await exec("bill.create", {
      input: {
        number: `AWS-2026-${mm}`,
        vendor: "AWS India",
        billDate: `2026-${mm}-05`,
        dueDate: `2026-${mm}-25`,
        lines: [{ description: "Cloud hosting", amount: parseINR("1,20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
      },
    });
    await exec("bill.submit", { billId: bill.id });
    await exec("bill.approve", { billId: bill.id }, CONTROLLER);
    if (mm !== "05") await exec("bill.payment", { billId: bill.id, date: `2026-${mm}-25`, amount: parseINR("1,41,600") });
  }

  /* ---------------- schedules ---------------- */

  await exec("schedule.addPrepaid", {
    input: {
      description: "Annual D&O insurance",
      total: parseINR("2,40,000"),
      startPeriod: "2026-01",
      endPeriod: "2026-12",
      expenseAccountId: "acc_professional",
      fundingAccountId: "acc_bank",
    },
  });
  await exec("schedule.addAsset", {
    input: {
      name: "Engineering laptops",
      cost: parseINR("12,00,000"),
      salvageValue: parseINR("1,20,000"),
      inServicePeriod: "2026-01",
      usefulLifeMonths: 36,
      assetAccountId: "acc_equipment",
      fundingAccountId: "acc_bank",
    },
  });
  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    await exec("schedule.runAmortization", { period: p });
    await exec("schedule.runDepreciation", { period: p });
  }

  /* ---------------- close January through May ---------------- */

  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    const asOf = lastDay(p);
    const bal = org.ledger.balance("acc_bank", asOf);
    const rec = await exec("reconciliation.reconcile", {
      input: {
        accountId: "acc_bank",
        asOf,
        statementClosingBalance: bal,
        bookBalance: bal,
        statementLines: [],
        bookEntries: [],
      },
    }, CONTROLLER);
    await exec("reconciliation.complete", { reconciliationId: rec.id }, CONTROLLER);

    for (const f of erp.close.flux(p)) {
      if (f.needsExplanation && !f.explanation) {
        await exec("close.explain", {
          period: p,
          accountId: f.accountId,
          explanation: "Reviewed with the controller — expected movement",
        }, CONTROLLER);
      }
    }
    await exec("close.run", { period: p }, CONTROLLER);
    try {
      await exec("close.lock", { period: p }, CONTROLLER);
    } catch {
      // A period that genuinely cannot close stays open — that is the honest
      // state, and the checklist will say why.
    }
  }

  /* ---------------- June: exceptions raised, close still open ---------------- */

  await exec("agents.scan", { period: "2026-06" });
  await exec("close.run", { period: "2026-06" }, CONTROLLER);
};
