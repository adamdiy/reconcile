import { writeFileSync } from 'node:fs';
import { createStripeConnector } from '../index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const connector = createStripeConnector();
  const inventory = await connector.collect();

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(inventory, null, 2));
    console.log(`wrote ${inventory.subscriptions.length} subscriptions, ${inventory.customers.length} customers to ${outFile}`);
    return;
  }

  const base = process.env.RECONCILE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/ingest/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.RECONCILE_INGEST_TOKEN ?? ''}`,
    },
    body: JSON.stringify(inventory),
  });
  if (!res.ok) {
    console.error(`ingest failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
