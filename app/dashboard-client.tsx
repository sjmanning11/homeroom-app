'use client';

import { useMemo, useRef, useState } from 'react';
import type { Card, Category, FamilyMember } from '@/lib/supabase';
import { setCardRead } from './actions';

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

const CATEGORY_LABELS: Record<Category, string> = {
  announcement: 'Announcement',
  grade: 'Grade',
  attendance: 'Attendance',
  event: 'Event',
  permission_slip: 'Permission Slip',
  lunch_menu: 'Lunch Menu',
  other: 'Other',
};

const SWIPE_DISMISS_PX = 90;

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

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }`}
    >
      {label}
    </button>
  );
}

function CardItem({
  card,
  showRead,
  onToggleRead,
}: {
  card: Card;
  showRead: boolean;
  onToggleRead: (card: Card, read: boolean) => void;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isRead = card.read_at !== null;

  const dismiss = (dir: 1 | -1) => {
    setLeaving(true);
    setDx(dir * window.innerWidth);
    setTimeout(() => onToggleRead(card, true), 200);
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{ maxHeight: leaving ? 0 : undefined, transition: 'max-height 200ms ease-out' }}
    >
      {!isRead && (
        <div className="absolute inset-0 flex items-center justify-between rounded-xl bg-emerald-500/90 px-4 text-sm font-medium text-white">
          <span>Done</span>
          <span>Done</span>
        </div>
      )}
      <div
        className={`relative rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 ${
          isRead ? 'opacity-60' : ''
        }`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: touchStart.current ? 'none' : 'transform 200ms ease-out',
        }}
        onTouchStart={(e) => {
          if (isRead) return;
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const moveX = e.touches[0].clientX - touchStart.current.x;
          const moveY = e.touches[0].clientY - touchStart.current.y;
          // Vertical scroll wins; only swipe when clearly horizontal
          if (Math.abs(moveX) > Math.abs(moveY)) setDx(moveX);
        }}
        onTouchEnd={() => {
          touchStart.current = null;
          if (Math.abs(dx) > SWIPE_DISMISS_PX) dismiss(dx > 0 ? 1 : -1);
          else setDx(0);
        }}
      >
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
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{card.summary}</p>
        )}
        <div className="mt-3 flex gap-4">
          {card.raw_link && (
            <a
              href={card.raw_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 dark:text-blue-400"
            >
              Open email
            </a>
          )}
          <button
            onClick={() => (isRead ? onToggleRead(card, false) : dismiss(1))}
            className="text-xs font-medium text-gray-500"
          >
            {isRead ? 'Mark unread' : showRead ? 'Mark read' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardClient({
  members,
  initialCards,
}: {
  members: FamilyMember[];
  initialCards: Card[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [kidFilter, setKidFilter] = useState<string | 'all' | 'family'>('all');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'all'>('all');
  const [showRead, setShowRead] = useState(false);

  const usedCategories = useMemo(
    () => [...new Set(cards.map((c) => c.category))].sort(),
    [cards]
  );

  const toggleRead = (card: Card, read: boolean) => {
    // Optimistic update; revert on failure
    const prev = card.read_at;
    setCards((cs) =>
      cs.map((c) =>
        c.id === card.id ? { ...c, read_at: read ? new Date().toISOString() : null } : c
      )
    );
    setCardRead(card.id, read).catch(() => {
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, read_at: prev } : c)));
    });
  };

  const visible = cards.filter(
    (c) =>
      (showRead || c.read_at === null) &&
      (categoryFilter === 'all' || c.category === categoryFilter) &&
      (kidFilter === 'all' ||
        (kidFilter === 'family' ? c.family_member_id === null : c.family_member_id === kidFilter))
  );

  const groups = [
    ...members.map((m) => ({
      heading: m.name,
      cards: sortCards(visible.filter((c) => c.family_member_id === m.id)),
    })),
    {
      heading: 'Whole family',
      cards: sortCards(visible.filter((c) => c.family_member_id === null)),
    },
  ].filter((g) => g.cards.length > 0);

  const unreadCount = cards.filter((c) => c.read_at === null).length;

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip label="All" active={kidFilter === 'all'} onClick={() => setKidFilter('all')} />
        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.name}
            active={kidFilter === m.id}
            onClick={() => setKidFilter(m.id)}
          />
        ))}
        <Chip
          label="Family"
          active={kidFilter === 'family'}
          onClick={() => setKidFilter('family')}
        />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          label="Every type"
          active={categoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
        />
        {usedCategories.map((cat) => (
          <Chip
            key={cat}
            label={CATEGORY_LABELS[cat]}
            active={categoryFilter === cat}
            onClick={() => setCategoryFilter(cat)}
          />
        ))}
        <Chip
          label={showRead ? 'Hide read' : 'Show read'}
          active={showRead}
          onClick={() => setShowRead((v) => !v)}
        />
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-gray-500">
          {unreadCount === 0 && !showRead
            ? 'All caught up!'
            : 'Nothing matches these filters.'}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.heading} className="space-y-3">
          <h2 className="text-lg font-semibold">{group.heading}</h2>
          {group.cards.map((card) => (
            <CardItem key={card.id} card={card} showRead={showRead} onToggleRead={toggleRead} />
          ))}
        </section>
      ))}
    </>
  );
}
