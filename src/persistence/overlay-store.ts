/**
 * A seed kept in memory, and only what happens after it in the shared log.
 *
 * A public demo gives every visitor their own copy of the same seeded
 * company. Kept only in memory, that copy lives on one server instance, and
 * a serverless platform sends the visitor's next request wherever it likes:
 * they confirm a bank line, and on the next click it is back in the queue.
 * Writing the whole seed to the shared log for every visitor would fix that
 * by storing a hundred-odd identical rows per visit, most of them for
 * visitors who never change anything.
 *
 * This store splits the difference. Until `seal()`, appends go to a private
 * in-memory log: the seed, which every instance rebuilds identically because
 * entity ids come from the organization id and a counter. After `seal()`,
 * appends go to the shared log, so a visitor's own actions reach every
 * instance, and replay applies them on top of that instance's seed in order.
 *
 * Shared-log sequence numbers are lifted by OFFSET so they always sort after
 * the seed, whatever values the database's sequence has reached.
 */

import type { Action } from "./commands.js";
import { ActionStore, LoggedAction, MemoryActionStore } from "./store.js";

export class SeedOverlayStore implements ActionStore {
  /** Above any seed; far below Number.MAX_SAFE_INTEGER minus a database sequence. */
  static readonly OFFSET = 1_000_000_000;

  readonly mode: ActionStore["mode"];
  private readonly seed = new MemoryActionStore();
  private sealed = false;

  constructor(private readonly shared: ActionStore) {
    this.mode = shared.mode;
  }

  /** The seed is complete; from here on actions are shared. */
  seal(): void {
    this.sealed = true;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  async append(orgId: string, action: Action): Promise<LoggedAction> {
    if (!this.sealed) {
      const logged = await this.seed.append(orgId, action);
      if (logged.seq >= SeedOverlayStore.OFFSET) throw new Error("Seed is too large for the overlay store");
      return logged;
    }
    return this.lift(await this.shared.append(orgId, action));
  }

  async after(orgId: string, seq: number): Promise<readonly LoggedAction[]> {
    const fromSeed = seq < SeedOverlayStore.OFFSET ? await this.seed.after(orgId, seq) : [];
    // Before sealing, the shared log is invisible. An instance opening a
    // returning visitor's books must build the seed first; applying their
    // later actions to empty books would fail, or worse, half succeed.
    if (!this.sealed) return fromSeed;
    const sharedSeq = Math.max(0, seq - SeedOverlayStore.OFFSET);
    const fromShared = (await this.shared.after(orgId, sharedSeq)).map((l) => this.lift(l));
    return [...fromSeed, ...fromShared];
  }

  async latestSeq(orgId: string): Promise<number> {
    const shared = this.sealed ? await this.shared.latestSeq(orgId) : 0;
    return shared > 0 ? SeedOverlayStore.OFFSET + shared : this.seed.latestSeq(orgId);
  }

  ready(): Promise<void> {
    return this.shared.ready();
  }

  /** Every instance seeds its own memory, so the claim is local. */
  claimSeed(orgId: string): Promise<boolean> {
    return this.seed.claimSeed(orgId);
  }

  private lift(l: LoggedAction): LoggedAction {
    return { ...l, seq: SeedOverlayStore.OFFSET + l.seq };
  }
}
