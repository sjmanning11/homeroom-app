import { getSupabase, type Card, type FamilyMember } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PRIORITY_ORDER: Record<Card['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PRIORITY_STYLES: Record<Card['priority'], string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const CATEGORY_LABELS: Record<Card['category'], string> = {
  announcement: 'Announcement',
  grade: 'Grade',
  attendance: 'Attendance',
  event: 'Event',
  permission_slip: 'Permission Slip',
  lunch_menu: 'Lunch Menu',
  other: 'Other',
};

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

function CardItem({ card }: { card: Card }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{card.title}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[card.priority]}`}
        >
          {card.priority}
        </span>
      </div>
      <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">
        {CATEGORY_LABELS[card.category]}
        {card.due_date && ` · due ${card.due_date}`}
      </p>
      {card.summary && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {card.summary}
        </p>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const supabase = getSupabase();
  const [membersRes, cardsRes] = await Promise.all([
    supabase.from('homeroom_family_members').select('*').eq('relation', 'kid'),
    supabase.from('homeroom_cards').select('*').is('read_at', null),
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

  const members = membersRes.data as FamilyMember[];
  const cards = cardsRes.data as Card[];

  const groups: { heading: string; cards: Card[] }[] = [
    ...members.map((m) => ({
      heading: m.name,
      cards: sortCards(cards.filter((c) => c.family_member_id === m.id)),
    })),
    {
      heading: 'Whole family',
      cards: sortCards(cards.filter((c) => c.family_member_id === null)),
    },
  ].filter((g) => g.cards.length > 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 pt-8">
      <header>
        <h1 className="text-2xl font-bold">Homeroom</h1>
        <p className="text-sm text-gray-500">Family school dashboard</p>
      </header>
      {groups.length === 0 && (
        <p className="text-sm text-gray-500">No cards yet. All caught up!</p>
      )}
      {groups.map((group) => (
        <section key={group.heading} className="space-y-3">
          <h2 className="text-lg font-semibold">{group.heading}</h2>
          {group.cards.map((card) => (
            <CardItem key={card.id} card={card} />
          ))}
        </section>
      ))}
    </main>
  );
}
