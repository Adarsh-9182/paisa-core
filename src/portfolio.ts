/**
 * Portfolio Engine — deterministic investment & trading ledger.
 *
 * The same invariants as the rest of Paisa, applied to investments:
 *  1. Every trade posts a balanced journal entry (buys move cash into the
 *     Investments asset; sells return cash and realize gain/loss on the P&L).
 *  2. Trades are append-only — corrections are opposite trades, not edits.
 *  3. Quantities are integer ten-thousandths of a unit (4 dp, exact); money
 *     is integer paise. Floats never touch a position.
 *  4. Market value is NEVER guessed: a holding is only valued if a price has
 *     been explicitly marked for it. Unmarked holdings are declared as such.
 *  5. Cost basis is weighted-average, removed proportionally on sale — the
 *     ledger's Investments balance always equals the open cost basis.
 */

import { Paise, ZERO, add, sub, sum, mulRatio, paise, formatINR } from "./money.js";
import { JournalEngine } from "./journal.js";
import { EventBus } from "./events.js";

export type InstrumentKind = "STOCK" | "ETF" | "MUTUAL_FUND" | "FIXED_DEPOSIT" | "GOLD" | "BOND";
export type TradeSide = "BUY" | "SELL";

/** Quantity in ten-thousandths of a unit (4 decimal places), exact. */
export type Qty = bigint;

export class PortfolioError extends Error {
  override name = "PortfolioError";
}

/** Parse "10", "10.5", "0.0042" → Qty (×10⁴). */
export const parseQty = (input: string): Qty => {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(input.trim());
  if (!m) throw new PortfolioError(`Cannot parse quantity: "${input}"`);
  const frac = (m[2] ?? "").padEnd(4, "0");
  return BigInt(m[1]!) * 10_000n + BigInt(frac);
};

/** Format Qty → "10.5" (trailing zeros trimmed, at most 4 dp). */
export const formatQty = (q: Qty): string => {
  const neg = q < 0n ? "-" : "";
  const v = q < 0n ? -q : q;
  const whole = (v / 10_000n).toString();
  const frac = (v % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${neg}${whole}.${frac}` : `${neg}${whole}`;
};

export interface TradeInput {
  readonly symbol: string; // e.g. "NIFTYBEES", "PPFAS-FLEXI", "HDFC-FD-93D"
  readonly name: string; // display name
  readonly kind: InstrumentKind;
  readonly side: TradeSide;
  readonly date: string; // ISO date
  readonly qty: Qty; // ×10⁴, strictly positive
  readonly pricePerUnit: Paise; // paise per whole unit
  readonly fees?: Paise; // brokerage/stamp, defaults to zero
}

export interface Trade {
  readonly id: string;
  readonly orgId: string;
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly side: TradeSide;
  readonly date: string;
  readonly qty: Qty;
  readonly pricePerUnit: Paise;
  readonly fees: Paise;
  /** Cash that moved: cost incl. fees on BUY, net proceeds on SELL. */
  readonly cashAmount: Paise;
  /** Realized gain (+) / loss (−) on SELL; null on BUY. */
  readonly realizedPnl: Paise | null;
  readonly journalEntryId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface PriceMark {
  readonly symbol: string;
  readonly date: string;
  readonly pricePerUnit: Paise;
  readonly source: string; // "manual" | "broker-import" | ...
  readonly markedBy: string;
  readonly markedAt: string;
}

export interface Holding {
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly qty: Qty;
  readonly costBasis: Paise; // open invested amount (incl. buy fees)
  readonly avgCostPerUnit: Paise;
  /** Latest mark on/before asOf — null means "no price marked", never a guess. */
  readonly mark: PriceMark | null;
  readonly marketValue: Paise | null;
  readonly unrealizedPnl: Paise | null;
}

export interface PortfolioSummary {
  readonly asOf: string;
  readonly holdings: readonly Holding[];
  readonly totalCostBasis: Paise;
  /** Market value of the marked holdings only. */
  readonly markedValue: Paise;
  readonly markedCostBasis: Paise;
  readonly unrealizedPnl: Paise; // over marked holdings only
  readonly realizedPnl: Paise; // all sells up to asOf
  readonly unmarkedSymbols: readonly string[]; // declared, not guessed
  /** Allocation by instrument kind, on market value where marked else cost. */
  readonly allocation: readonly { kind: InstrumentKind; value: Paise; pct: number }[];
}

interface Position {
  name: string;
  kind: InstrumentKind;
  qty: Qty;
  costBasis: Paise;
}

export class PortfolioEngine {
  private trades: Trade[] = [];
  private marks: PriceMark[] = [];
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private journal: JournalEngine,
    private bus: EventBus,
  ) {}

  /** Record a trade: validates the position, posts the journal entry, appends. */
  record(input: TradeInput, actor: string): Trade {
    if (input.qty <= 0n) throw new PortfolioError("Trade quantity must be positive");
    if (input.pricePerUnit <= 0n) throw new PortfolioError("Trade price must be positive");
    const fees = input.fees ?? ZERO;
    if (fees < 0n) throw new PortfolioError("Fees cannot be negative");

    const positions = this.replay(input.date);
    const existing = positions.get(input.symbol);
    if (existing && existing.kind !== input.kind)
      throw new PortfolioError(
        `Symbol ${input.symbol} is already held as ${existing.kind}; cannot trade it as ${input.kind}`,
      );
    if (input.side === "SELL") this.assertTimelineFeasible(input.symbol, input.date, input.qty);

    const gross = mulRatio(input.pricePerUnit, input.qty, 10_000n); // qty is ×10⁴
    let cashAmount: Paise;
    let realizedPnl: Paise | null = null;
    let entryId: string;

    if (input.side === "BUY") {
      cashAmount = add(gross, fees); // cost basis includes acquisition fees
      const entry = this.journal.post({
        date: input.date,
        narration: `Buy ${formatQty(input.qty)} ${input.symbol} @ ${formatINR(input.pricePerUnit)}`,
        lines: [
          { accountId: "acc_investments", side: "DEBIT", amount: cashAmount },
          { accountId: "acc_bank", side: "CREDIT", amount: cashAmount },
        ],
        sourceModule: "portfolio",
        referenceId: input.symbol,
        createdBy: actor,
      });
      entryId = entry.id;
    } else {
      if (!existing || existing.qty < input.qty)
        throw new PortfolioError(
          `Cannot sell ${formatQty(input.qty)} ${input.symbol}: holding ${existing ? formatQty(existing.qty) : "0"} on ${input.date}`,
        );
      const costRemoved = mulRatio(existing.costBasis, input.qty, existing.qty); // proportional, exact
      cashAmount = sub(gross, fees); // net proceeds
      if (cashAmount <= 0n) throw new PortfolioError("Sale proceeds must exceed fees");
      realizedPnl = sub(cashAmount, costRemoved);

      const lines =
        realizedPnl > 0n
          ? [
              { accountId: "acc_bank", side: "DEBIT" as const, amount: cashAmount },
              { accountId: "acc_investments", side: "CREDIT" as const, amount: costRemoved },
              { accountId: "acc_realized_gains", side: "CREDIT" as const, amount: realizedPnl },
            ]
          : realizedPnl < 0n
            ? [
                { accountId: "acc_bank", side: "DEBIT" as const, amount: cashAmount },
                { accountId: "acc_realized_losses", side: "DEBIT" as const, amount: paise(-realizedPnl) },
                { accountId: "acc_investments", side: "CREDIT" as const, amount: costRemoved },
              ]
            : [
                { accountId: "acc_bank", side: "DEBIT" as const, amount: cashAmount },
                { accountId: "acc_investments", side: "CREDIT" as const, amount: costRemoved },
              ];
      const entry = this.journal.post({
        date: input.date,
        narration: `Sell ${formatQty(input.qty)} ${input.symbol} @ ${formatINR(input.pricePerUnit)}`,
        lines,
        sourceModule: "portfolio",
        referenceId: input.symbol,
        createdBy: actor,
      });
      entryId = entry.id;
    }

    const trade: Trade = Object.freeze({
      id: `tr_${this.orgId}_${++this.counter}`,
      orgId: this.orgId,
      symbol: input.symbol,
      name: existing?.name ?? input.name,
      kind: input.kind,
      side: input.side,
      date: input.date,
      qty: input.qty,
      pricePerUnit: input.pricePerUnit,
      fees,
      cashAmount,
      realizedPnl,
      journalEntryId: entryId,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    });
    this.trades.push(trade);
    this.bus.emit({
      orgId: this.orgId,
      type: "trade.recorded",
      at: trade.createdAt,
      actor,
      payload: { tradeId: trade.id, symbol: trade.symbol, side: trade.side, cash: formatINR(cashAmount) },
    });
    return trade;
  }

  /** Mark a price observed on a date — the only path to a market value. */
  mark(symbol: string, date: string, pricePerUnit: Paise, actor: string, source = "manual"): PriceMark {
    if (pricePerUnit <= 0n) throw new PortfolioError("Marked price must be positive");
    const m: PriceMark = Object.freeze({
      symbol,
      date,
      pricePerUnit,
      source,
      markedBy: actor,
      markedAt: new Date().toISOString(),
    });
    this.marks.push(m);
    this.bus.emit({
      orgId: this.orgId,
      type: "price.marked",
      at: m.markedAt,
      actor,
      payload: { symbol, date, price: formatINR(pricePerUnit), source },
    });
    return m;
  }

  allTrades(): readonly Trade[] {
    return [...this.trades];
  }

  tradesUpTo(asOf: string): readonly Trade[] {
    return this.trades.filter((t) => t.date <= asOf);
  }

  /** Open positions as of a date, with mark-based valuation where available. */
  holdings(asOf: string): readonly Holding[] {
    const positions = this.replay(asOf);
    const out: Holding[] = [];
    for (const [symbol, p] of positions) {
      if (p.qty <= 0n) continue;
      const mark = this.latestMark(symbol, asOf);
      const marketValue = mark ? mulRatio(mark.pricePerUnit, p.qty, 10_000n) : null;
      out.push({
        symbol,
        name: p.name,
        kind: p.kind,
        qty: p.qty,
        costBasis: p.costBasis,
        avgCostPerUnit: p.qty > 0n ? mulRatio(p.costBasis, 10_000n, p.qty) : ZERO,
        mark,
        marketValue,
        unrealizedPnl: marketValue !== null ? sub(marketValue, p.costBasis) : null,
      });
    }
    return out.sort((a, b) => {
      const av = a.marketValue ?? a.costBasis;
      const bv = b.marketValue ?? b.costBasis;
      return av > bv ? -1 : 1;
    });
  }

  summary(asOf: string): PortfolioSummary {
    const holdings = this.holdings(asOf);
    const marked = holdings.filter((h) => h.marketValue !== null);
    const totalCostBasis = sum(holdings.map((h) => h.costBasis));
    const markedValue = sum(marked.map((h) => h.marketValue!));
    const markedCostBasis = sum(marked.map((h) => h.costBasis));
    const realizedPnl = sum(
      this.tradesUpTo(asOf)
        .filter((t) => t.realizedPnl !== null)
        .map((t) => t.realizedPnl!),
    );

    const byKind = new Map<InstrumentKind, Paise>();
    for (const h of holdings) {
      const v = h.marketValue ?? h.costBasis; // marked value where we have one, cost otherwise
      byKind.set(h.kind, add(byKind.get(h.kind) ?? ZERO, v));
    }
    const totalAlloc = sum([...byKind.values()]);
    const allocation = [...byKind.entries()]
      .map(([kind, value]) => ({
        kind,
        value,
        pct: totalAlloc > 0n ? Number((value * 1000n) / totalAlloc) / 10 : 0,
      }))
      .sort((a, b) => (a.value > b.value ? -1 : 1));

    return {
      asOf,
      holdings,
      totalCostBasis,
      markedValue,
      markedCostBasis,
      unrealizedPnl: sub(markedValue, markedCostBasis),
      realizedPnl,
      unmarkedSymbols: holdings.filter((h) => h.marketValue === null).map((h) => h.symbol),
      allocation,
    };
  }

  /**
   * A sell must leave the WHOLE timeline feasible, not just its own date:
   * backdating a sell between an old buy and a later full sell would drive
   * the position negative when the later sell replays. Walk every trade for
   * the symbol with the candidate inserted (same date-then-insertion order
   * as replay()) and reject if the quantity ever dips below zero.
   */
  private assertTimelineFeasible(symbol: string, date: string, sellQty: Qty): void {
    const events = this.trades
      .filter((t) => t.symbol === symbol)
      .map((t, i) => ({ date: t.date, delta: t.side === "BUY" ? t.qty : -t.qty, seq: i }));
    events.push({ date, delta: -sellQty, seq: events.length }); // candidate applies last on its date
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    let qty: Qty = 0n;
    for (const e of events) {
      qty += e.delta;
      if (qty < 0n)
        throw new PortfolioError(
          `Cannot sell ${formatQty(sellQty)} ${symbol} on ${date}: the position would go negative on ${e.date} once later trades replay`,
        );
    }
  }

  private latestMark(symbol: string, asOf: string): PriceMark | null {
    let best: PriceMark | null = null;
    for (const m of this.marks) {
      if (m.symbol !== symbol || m.date > asOf) continue;
      if (!best || m.date > best.date) best = m;
    }
    return best;
  }

  /** Weighted-average positions from the trade log, on/before asOf. */
  private replay(asOf: string): Map<string, Position> {
    const positions = new Map<string, Position>();
    const cutoff = this.trades.filter((t) => t.date <= asOf);
    // Trades are appended in call order; sort stably by date so backdated entries land correctly.
    const ordered = [...cutoff].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of ordered) {
      const p = positions.get(t.symbol) ?? { name: t.name, kind: t.kind, qty: 0n, costBasis: ZERO };
      if (t.side === "BUY") {
        p.qty += t.qty;
        p.costBasis = add(p.costBasis, t.cashAmount);
      } else {
        const costRemoved = p.qty > 0n ? mulRatio(p.costBasis, t.qty, p.qty) : ZERO;
        p.qty -= t.qty;
        p.costBasis = sub(p.costBasis, costRemoved);
      }
      positions.set(t.symbol, p);
    }
    return positions;
  }
}
