import { NextRequest } from 'next/server';
import { AppInventorySchema } from '@reconcile/domain';
import { handleIngest } from '../../../../lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handleIngest(req, 'app', AppInventorySchema);
}
