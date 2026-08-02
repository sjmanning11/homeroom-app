import { redirect } from 'next/navigation';
import type { Card, FamilyMember } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import DashboardClient from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [membersRes, cardsRes] = await Promise.all([
    supabase.from('homeroom_family_members').select('*').eq('relation', 'kid'),
    supabase
      .from('homeroom_cards')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (membersRes.error || cardsRes.error) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-red-500">
          Failed to load dashboard: {(membersRes.error ?? cardsRes.error)?.message}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 pt-8">
      <header>
        <h1 className="text-2xl font-bold">Homeroom</h1>
        <p className="text-sm text-gray-500">Family school dashboard</p>
      </header>
      <DashboardClient
        members={membersRes.data as FamilyMember[]}
        initialCards={cardsRes.data as Card[]}
      />
    </main>
  );
}
