'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const callbackError = searchParams.get('error');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Homeroom</h1>
        <p className="text-sm text-gray-500">Sign in with the family email</p>
      </header>

      {status === 'sent' ? (
        <p className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          Magic link sent to {email}. Open it on this phone.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="family@example.com"
            className="w-full rounded-xl border border-gray-300 p-3 text-base dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}

      {(status === 'error' || callbackError) && (
        <p className="text-sm text-red-500">
          {errorMsg ?? 'Sign-in link failed or expired. Try again.'}
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
