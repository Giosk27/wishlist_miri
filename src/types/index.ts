export type MemberStatus = 'pending' | 'approved';

export interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description: string;
  created_at: string;
}

export interface GiftGroup {
  id: string;
  product_id: string;
  purchased: boolean;
  created_at: string;
}

export interface Member {
  id: string;
  group_id: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  email_hash: string;
  status: MemberStatus;
  session_token: string;
  created_at: string;
}

/** Dati pubblici — senza email */
export interface PublicMember {
  id: string;
  name: string;
  status: MemberStatus;
}

export interface PublicGroupView {
  group: GiftGroup;
  product: Product;
  members: PublicMember[];
  pricePerPerson: number | null;
}

export interface MemberSession {
  memberId: string;
  groupId: string;
  name: string;
  email: string;
  sessionToken: string;
}

export interface JoinResult {
  member: Member;
  isNewGroup: boolean;
  pricePerPerson: number;
  warning?: string | null;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  target_scope: 'all' | 'product';
  target_product_id: string | null;
  created_at: string;
}
