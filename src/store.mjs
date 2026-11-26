// Tiny file-backed store. Fine for a free-tier prototype (one instance).
// Swap for SQLite/D1 when you need more than one process.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.receiptsFile = path.join(dir, 'receipts.jsonl');
    this.accountsFile = path.join(dir, 'accounts.json');
    this.receipts = new Map();
    this.lastId = null;
    this.accounts = fs.existsSync(this.accountsFile) ? JSON.parse(fs.readFileSync(this.accountsFile, 'utf8')) : {};
    if (fs.existsSync(this.receiptsFile)) {
      for (const line of fs.readFileSync(this.receiptsFile, 'utf8').split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        this.receipts.set(r.id, r);
        this.lastId = r.id;
      }
    }
  }
  addReceipt(r) {
    fs.appendFileSync(this.receiptsFile, JSON.stringify(r) + '\n');
    this.receipts.set(r.id, r);
    this.lastId = r.id;
  }
  saveAccounts() {
    const tmp = this.accountsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.accounts, null, 2));
    fs.renameSync(tmp, this.accountsFile);
  }
}
