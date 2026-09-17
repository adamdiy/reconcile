import { login } from '../../../lib/auth-actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1 className="mb-6 text-lg font-semibold">Reconcile — sign in</h1>
      <form action={login} className="space-y-3">
        <input
          name="email"
          type="email"
          required
          placeholder="email"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="password"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-blue-600 py-2 text-sm text-white">Sign in</button>
      </form>
    </main>
  );
}
