'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function setCardRead(cardId: string, read: boolean) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('homeroom_cards')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', cardId);
  if (error) throw new Error(error.message);
}
