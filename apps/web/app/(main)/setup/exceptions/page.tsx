import { runAssessment } from '../../../../lib/state';
import { deleteException, upsertExceptionAction } from '../../../../lib/actions';
import { draftException } from '../../../../lib/ai-actions';
import { DraftException } from '../../../../components/DraftException';

export const dynamic = 'force-dynamic';

export default async function ExceptionsPage() {
  const snap = await runAssessment();
  const now = Date.parse(snap.evaluatedAt);
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Policy exceptions</h1>
      <p className="text-sm text-gray-600">
        A commercial exception changes expected behavior — it requires reason, owner and expiry.
        Changes re-run the assessment.
      </p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">id</th>
            <th className="py-1 pr-3">account</th>
            <th className="py-1 pr-3">capability</th>
            <th className="py-1 pr-3">expected</th>
            <th className="py-1 pr-3">reason</th>
            <th className="py-1 pr-3">owner</th>
            <th className="py-1 pr-3">expires</th>
            <th className="py-1 pr-3">status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {snap.exceptions.map((e) => {
            const active = Date.parse(e.expiresAt) > now;
            return (
              <tr key={e.id} className="border-b">
                <td className="py-1 pr-3 font-mono text-xs">{e.id}</td>
                <td className="py-1 pr-3 font-mono text-xs">{e.accountId}</td>
                <td className="py-1 pr-3 font-mono text-xs">{e.capability}</td>
                <td className="py-1 pr-3">{String(e.expected)}</td>
                <td className="py-1 pr-3 text-xs">{e.reason}</td>
                <td className="py-1 pr-3 text-xs">{e.owner}</td>
                <td className="py-1 pr-3 font-mono text-xs">{e.expiresAt}</td>
                <td className="py-1 pr-3">{active ? 'active' : 'expired'}</td>
                <td className="py-1">
                  <form
                    action={async () => {
                      'use server';
                      await deleteException(e.id);
                    }}
                  >
                    <button className="text-xs text-red-600">delete</button>
                  </form>
                </td>
              </tr>
            );
          })}
          {snap.exceptions.length === 0 && (
            <tr><td colSpan={9} className="py-4 text-center text-gray-500">no exceptions</td></tr>
          )}
        </tbody>
      </table>
      <DraftException
        capabilities={snap.policy.capabilities}
        draftAction={draftException}
        saveAction={upsertExceptionAction}
      />
    </main>
  );
}
