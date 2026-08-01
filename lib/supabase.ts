export type Category =
  | 'announcement'
  | 'grade'
  | 'attendance'
  | 'event'
  | 'permission_slip'
  | 'lunch_menu'
  | 'other';

export type Priority = 'low' | 'medium' | 'high';

export interface FamilyMember {
  id: string;
  name: string;
  relation: 'kid' | 'parent';
}

export interface Card {
  id: string;
  family_member_id: string | null;
  category: Category;
  title: string;
  summary: string | null;
  raw_link: string | null;
  due_date: string | null;
  priority: Priority;
  created_at: string;
  read_at: string | null;
}
