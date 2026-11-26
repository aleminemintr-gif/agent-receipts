// Accounts, API keys and loyalty points.
//
// Points are NOT a token. They are a ledger row on one account:
//  - no transfer endpoint exists, so they cannot be sold or moved
//  - they only buy receipts from this service
//  - first EARLY_LIMIT accounts get EARLY_POINTS once
import crypto from 'node:crypto';
import { sha256 } from './receipt.mjs';

export const EARLY_LIMIT = 10_000;
export const EARLY_POINTS = 25;
export const FREE_PER_DAY = 5;

const today = () => new Date().toISOString().slice(0, 10);

export class Accounts {
  constructor(store, { earlyLimit = EARLY_LIMIT } = {}) {
    this.store = store;
    this.earlyLimit = earlyLimit;
  }
  count() { return Object.keys(this.store.accounts).length; }

  /** Create an account. The raw key is shown once; only its hash is kept. */
  create({ label = '' } = {}) {
    const raw = 'ar_' + crypto.randomBytes(24).toString('base64url');
    const n = this.count();
    const early = n < this.earlyLimit;
    const id = 'acct_' + crypto.randomBytes(6).toString('hex');
    this.store.accounts[sha256(raw)] = {
      id, label: String(label).slice(0, 60), created: new Date().toISOString(),
      early_rank: early ? n + 1 : null,
      points: early ? EARLY_POINTS : 0,
      day: today(), used_today: 0, total_receipts: 0,
    };
    this.store.saveAccounts();
    return { api_key: raw, account: this.publicView(this.store.accounts[sha256(raw)]) };
  }

  get(rawKey) {
    if (!rawKey) return null;
    return this.store.accounts[sha256(rawKey)] || null;
  }

  publicView(a) {
    return {
      id: a.id, label: a.label, early_rank: a.early_rank, points: a.points,
      free_left_today: Math.max(0, FREE_PER_DAY - (a.day === today() ? a.used_today : 0)),
      total_receipts: a.total_receipts,
    };
  }

  /** Charge one receipt: free daily quota first, then 1 point. */
  charge(a) {
    if (a.day !== today()) { a.day = today(); a.used_today = 0; }
    let paid_with;
    if (a.used_today < FREE_PER_DAY) { a.used_today++; paid_with = 'free'; }
    else if (a.points > 0) { a.points--; paid_with = 'point'; }
    else return null;
    a.total_receipts++;
    this.store.saveAccounts();
    return paid_with;
  }
}
