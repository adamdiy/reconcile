import { readFileSync, writeFileSync } from 'node:fs';
import { CollectorConfigSchema, collect } from '../index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  if (configIdx < 0 || !args[configIdx + 1]) {
    console.error('usage: reconcile-collect --config collector.json [--out file | --push]');
    process.exit(2);
  }
  const config = CollectorConfigSchema.parse(
    JSON.parse(readFileSync(args[configIdx + 1], 'utf8')),
  );
  const inventory = await collect(config);

  const outIdx = args.indexOf('--out');
  if (outIdx >= 0) {
    writeFileSync(args[outIdx + 1], JSON.stringify(inventory, null, 2));
    console.log(`wrote ${inventory.accounts.length} accounts to ${args[outIdx + 1]}`);
    return;
  }
  if (args.includes('--push')) {
    const base = process.env.RECONCILE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/ingest/app`, {
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
    return;
  }
  console.log(JSON.stringify(inventory, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
