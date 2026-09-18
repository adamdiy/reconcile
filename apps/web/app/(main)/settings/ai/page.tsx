import { describeProvider } from '@reconcile/ai';
import { requireSession } from '../../../../lib/auth';
import { testProvider } from '../../../../lib/ai-actions';
import { TestProviderButton } from '../../../../components/TestProviderButton';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const session = await requireSession();
  const info = describeProvider();
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">AI provider</h1>
      <p className="text-sm text-gray-600">
        Advisory-only: AI output never changes reconciliation results or authorizes access.
      </p>
      <div className="mt-4 rounded border p-4 text-sm">
        <p>
          Provider: <strong>{info.name}</strong> — model:{' '}
          <span className="font-mono">{info.model}</span> — status:{' '}
          <strong>{info.configured ? 'configured' : 'not configured (stub)'}</strong>
        </p>
        {info.name === 'stub' && (
          <p className="mt-1 text-xs text-amber-700">
            Stub provider active — canned deterministic suggestions only.
          </p>
        )}
        <div className="mt-3 text-xs text-gray-500">
          <p>Set <code>RECONCILE_AI_PROVIDER</code> = <code>openai</code> | <code>anthropic</code>, plus:</p>
          <ul className="ml-4 list-inside list-disc">
            <li><code>OPENAI_API_KEY</code>, <code>OPENAI_BASE_URL</code>, <code>OPENAI_MODEL</code></li>
            <li><code>ANTHROPIC_API_KEY</code>, <code>ANTHROPIC_MODEL</code></li>
          </ul>
        </div>
        {session.role === 'admin' && (
          <TestProviderButton action={testProvider} />
        )}
      </div>
    </main>
  );
}
