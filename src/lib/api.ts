import type {
  Product,
  GiftGroup,
  Member,
  PublicGroupView,
  JoinResult,
  AppNotification,
} from '../types';
import {
  hashEmail,
  generateToken,
  sanitizePublicName,
  toPublicMember,
  calculatePricePerPerson,
  getAdminSessionToken,
} from './security';
import { isSupabaseConfigured, supabase, STORAGE_BUCKET } from './supabase';
import { sendAdminAnnouncementEmail, sendGroupUpdateEmail, getMyGroupUrl } from './email';

const LS_KEY = 'wishlist_data_v1';

interface LocalData {
  products: Product[];
  groups: GiftGroup[];
  members: Member[];
  notifications: AppNotification[];
}

function loadLocal(): LocalData {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return { products: [], groups: [], members: [], notifications: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalData>;
    return {
      products: parsed.products ?? [],
      groups: parsed.groups ?? [],
      members: parsed.members ?? [],
      notifications: parsed.notifications ?? [],
    };
  } catch {
    return { products: [], groups: [], members: [], notifications: [] };
  }
}

function saveLocal(data: LocalData): void {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function uuid(): string {
  return crypto.randomUUID();
}

function buildPublicGroupViews(
  products: Product[],
  groups: GiftGroup[],
  members: Member[],
): PublicGroupView[] {
  return groups.map((group) => {
    const product = products.find((p) => p.id === group.product_id)!;
    const groupMembers = members.filter((m) => m.group_id === group.id);
    const approved = groupMembers.filter((m) => m.status === 'approved');
    return {
      group,
      product,
      members: groupMembers.map(toPublicMember),
      pricePerPerson: calculatePricePerPerson(product.price, approved.length),
    };
  });
}

export type AnnouncementScope = 'all' | 'product';

export interface AdminMemberRecord {
  id: string;
  group_id: string;
  product_id: string | null;
  product_name: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  status: string;
  created_at: string;
}

export interface AdminBroadcastOptions {
  scope: AnnouncementScope;
  productId: string | null;
  subject: string;
  body: string;
  sendEmail: boolean;
  sendApp: boolean;
}

async function localGetAnnouncementRecipients(scope: AnnouncementScope, productId?: string): Promise<string[]> {
  const data = loadLocal();
  const groupIds = scope === 'product'
    ? new Set(data.groups.filter((group) => group.product_id === productId).map((group) => group.id))
    : null;

  return Array.from(
    new Set(
      data.members
        .filter((member) => member.status === 'approved')
        .filter((member) => (groupIds ? groupIds.has(member.group_id) : true))
        .map((member) => member.email),
    ),
  );
}

async function sendAnnouncementToRecipients(
  recipients: string[],
  subject: string,
  html: string,
): Promise<number> {
  let sent = 0;
  for (const recipient of recipients) {
    await sendAdminAnnouncementEmail({ to: recipient, subject, html });
    sent += 1;
  }
  return sent;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAnnouncementHtml(subject: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #4c1d95;">
      <h2 style="margin: 0 0 16px;">${escapeHtml(subject)}</h2>
      <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
    </div>
  `;
}

async function localStoreNotification(options: {
  scope: AnnouncementScope;
  productId: string | null;
  subject: string;
  body: string;
}): Promise<void> {
  const data = loadLocal();
  data.notifications.unshift({
    id: uuid(),
    title: options.subject,
    body: options.body,
    target_scope: options.scope,
    target_product_id: options.productId,
    created_at: new Date().toISOString(),
  });
  data.notifications = data.notifications.slice(0, 20);
  saveLocal(data);
}

async function localSendAdminBroadcast(options: AdminBroadcastOptions): Promise<{ emailCount: number; appCount: number }> {
  const emailCount = options.sendEmail
    ? await sendAnnouncementToRecipients(
        await localGetAnnouncementRecipients(options.scope, options.productId ?? undefined),
        options.subject,
        buildAnnouncementHtml(options.subject, options.body),
      )
    : 0;

  const appCount = options.sendApp ? 1 : 0;
  if (options.sendApp) {
    await localStoreNotification({
      scope: options.scope,
      productId: options.productId,
      subject: options.subject,
      body: options.body,
    });
  }

  return { emailCount, appCount };
}

// ─── Local storage implementation ───────────────────────────────────────────

async function localGetProducts(): Promise<Product[]> {
  return loadLocal().products.sort((a, b) => a.name.localeCompare(b.name));
}

async function localGetPublicGroups(): Promise<PublicGroupView[]> {
  const data = loadLocal();
  return buildPublicGroupViews(data.products, data.groups, data.members);
}

async function localGetNotifications(scope: AnnouncementScope, productId?: string | null): Promise<AppNotification[]> {
  const data = loadLocal();
  return data.notifications
    .filter((notification) => scope === 'all' || notification.target_product_id === productId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function localGetProduct(id: string): Promise<Product | null> {
  return loadLocal().products.find((p) => p.id === id) ?? null;
}

async function localJoinOrCreateGroup(params: {
  productId: string;
  groupId?: string;
  name: string;
  email: string;
  authUserId?: string | null;
}): Promise<JoinResult> {
  const data = loadLocal();
  const emailHash = await hashEmail(params.email);
  const existing = data.members.find((m) => m.email_hash === emailHash);

  if (existing) {
    throw new Error('Sei già iscritto a un gruppo. Puoi cambiarlo dalla pagina "Il mio gruppo".');
  }

  const product = data.products.find((p) => p.id === params.productId);
  if (!product) throw new Error('Prodotto non trovato');

  let group: GiftGroup;
  let isNewGroup = false;

  if (params.groupId) {
    group = data.groups.find((g) => g.id === params.groupId)!;
    if (!group) throw new Error('Gruppo non trovato');
  } else {
    const existingGroup = data.groups.find((g) => g.product_id === params.productId);
    if (existingGroup) {
      group = existingGroup;
    } else {
      group = {
        id: uuid(),
        product_id: params.productId,
        purchased: false,
        created_at: new Date().toISOString(),
      };
      data.groups.push(group);
      isNewGroup = true;
    }
  }

  const member: Member = {
    id: uuid(),
    group_id: group.id,
    auth_user_id: params.authUserId ?? null,
    name: sanitizePublicName(params.name),
    email: params.email.trim().toLowerCase(),
    email_hash: emailHash,
    status: 'approved',
    session_token: generateToken(),
    created_at: new Date().toISOString(),
  };
  data.members.push(member);
  saveLocal(data);

  try {
    const approvedMembers = data.members.filter((m) => m.group_id === group.id && m.status === 'approved');
    const names = approvedMembers.map((m) => m.name);
    const pricePerPerson = calculatePricePerPerson(product.price, approvedMembers.length) ?? product.price;
    for (const currentMember of approvedMembers) {
      await sendGroupUpdateEmail({
        to: currentMember.email,
        memberName: currentMember.name,
        product,
        groupMemberNames: names,
        pricePerPerson,
        myGroupUrl: getMyGroupUrl(),
      });
    }
  } catch (error) {
    data.members = data.members.filter((m) => m.id !== member.id);
    if (isNewGroup) {
      data.groups = data.groups.filter((g) => g.id !== group.id);
    }
    saveLocal(data);
    throw error;
  }

  const approvedCount = data.members.filter((m) => m.group_id === group.id && m.status === 'approved').length;
  const pricePerPerson = calculatePricePerPerson(product.price, approvedCount) ?? product.price;

  return { member, isNewGroup, pricePerPerson };
}

async function localLoginMember(email: string): Promise<Member | null> {
  const emailHash = await hashEmail(email);
  return loadLocal().members.find((m) => m.email_hash === emailHash && m.status === 'approved') ?? null;
}

async function localGetMemberForAuthUser(authUserId: string): Promise<Member | null> {
  return loadLocal().members.find((m) => m.auth_user_id === authUserId) ?? null;
}

async function localGetMemberGroupView(memberId: string): Promise<PublicGroupView | null> {
  const data = loadLocal();
  const member = data.members.find((m) => m.id === memberId);
  if (!member) return null;
  const views = buildPublicGroupViews(data.products, data.groups, data.members);
  return views.find((v) => v.group.id === member.group_id) ?? null;
}

async function localChangeGroup(memberId: string, newGroupId: string | null, productId: string): Promise<JoinResult> {
  const data = loadLocal();
  const member = data.members.find((m) => m.id === memberId);
  if (!member) throw new Error('Membro non trovato');

  data.members = data.members.filter((m) => m.id !== memberId);
  saveLocal(data);

  try {
    return await localJoinOrCreateGroup({
      productId,
      groupId: newGroupId ?? undefined,
      name: member.name,
      email: member.email,
      authUserId: member.auth_user_id ?? null,
    });
  } catch (error) {
    const restoredData = loadLocal();
    restoredData.members.push(member);
    saveLocal(restoredData);
    throw error;
  }
}

async function localLeaveGroup(memberId: string): Promise<boolean> {
  const data = loadLocal();
  const member = data.members.find((m) => m.id === memberId);
  if (!member) return false;
  const groupId = member.group_id;
  data.members = data.members.filter((m) => m.id !== memberId);
  if (!data.members.some((m) => m.group_id === groupId)) {
    data.groups = data.groups.filter((g) => g.id !== groupId);
  }
  saveLocal(data);
  return true;
}

async function localSetPurchased(groupId: string, sessionToken: string, purchased: boolean): Promise<boolean> {
  const data = loadLocal();
  const member = data.members.find((m) => m.group_id === groupId && m.session_token === sessionToken);
  if (!member || member.status !== 'approved') return false;
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return false;
  group.purchased = purchased;
  saveLocal(data);
  return true;
}

async function localSaveProduct(product: Omit<Product, 'id' | 'created_at'>, id?: string): Promise<Product> {
  const data = loadLocal();
  if (id) {
    const idx = data.products.findIndex((p) => p.id === id);
    if (idx >= 0) {
      data.products[idx] = { ...data.products[idx], ...product };
      saveLocal(data);
      return data.products[idx];
    }
  }
  const newProduct: Product = { ...product, id: uuid(), created_at: new Date().toISOString() };
  data.products.push(newProduct);
  saveLocal(data);
  return newProduct;
}

async function localDeleteProduct(id: string): Promise<void> {
  const data = loadLocal();
  data.products = data.products.filter((p) => p.id !== id);
  data.groups = data.groups.filter((g) => g.product_id !== id);
  const groupIds = new Set(data.groups.map((g) => g.id));
  data.members = data.members.filter((m) => groupIds.has(m.group_id));
  saveLocal(data);
}

async function localClearAllGroupData(): Promise<void> {
  const data = loadLocal();
  data.groups = [];
  data.members = [];
  saveLocal(data);
}

async function localClearGroupDataForProduct(productId: string): Promise<void> {
  const data = loadLocal();
  const groupIds = new Set(data.groups.filter((group) => group.product_id === productId).map((group) => group.id));
  data.groups = data.groups.filter((group) => group.product_id !== productId);
  data.members = data.members.filter((member) => !groupIds.has(member.group_id));
  saveLocal(data);
}

// ─── Supabase implementation ────────────────────────────────────────────────

async function sbGetProducts(): Promise<Product[]> {
  const { data, error } = await supabase!.from('products').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

async function sbGetPublicGroups(): Promise<PublicGroupView[]> {
  const { data: groups, error: gErr } = await supabase!.from('gift_groups').select('*');
  if (gErr) throw gErr;
  const { data: products, error: pErr } = await supabase!.from('products').select('*');
  if (pErr) throw pErr;
  const { data: members, error: mErr } = await supabase!.from('members_public').select('*');
  if (mErr) throw mErr;

  const productMap = new Map((products ?? []).map((p) => [p.id, p]));
  const membersByGroup = new Map<string, typeof members>();
  for (const m of members ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }

  return (groups ?? []).map((group) => {
    const product = productMap.get(group.product_id)!;
    const groupMembers = membersByGroup.get(group.id) ?? [];
    const approved = groupMembers.filter((m) => m.status === 'approved');
    return {
      group,
      product,
      members: groupMembers.map(toPublicMember),
      pricePerPerson: calculatePricePerPerson(product.price, approved.length),
    };
  });
}

async function sbGetProduct(id: string): Promise<Product | null> {
  const { data, error } = await supabase!.from('products').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function sbJoinOrCreateGroup(params: {
  productId: string;
  groupId?: string;
  name: string;
  email: string;
  authUserId?: string | null;
}): Promise<JoinResult> {
  const emailHash = await hashEmail(params.email);

  const { data: existing } = await supabase!
    .from('members')
    .select('id')
    .eq('email_hash', emailHash)
    .maybeSingle();

  if (existing) {
    throw new Error('Sei già iscritto a un gruppo. Puoi cambiarlo dalla pagina "Il mio gruppo".');
  }

  const product = await sbGetProduct(params.productId);
  if (!product) throw new Error('Prodotto non trovato');

  let groupId = params.groupId;
  let isNewGroup = false;

  if (groupId) {
  } else {
    const { data: existingGroup, error: existingError } = await supabase!
      .from('gift_groups')
      .select('*')
      .eq('product_id', params.productId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingGroup) {
      groupId = existingGroup.id;
    } else {
      const { data: newGroup, error } = await supabase!
        .from('gift_groups')
        .insert({ product_id: params.productId, purchased: false })
        .select()
        .single();
      if (error) throw error;
      groupId = newGroup.id;
      isNewGroup = true;
    }
  }

  const memberPayload = {
    group_id: groupId,
    auth_user_id: params.authUserId ?? null,
    name: sanitizePublicName(params.name),
    email: params.email.trim().toLowerCase(),
    email_hash: emailHash,
    status: 'approved',
    session_token: generateToken(),
  };

  const { data: member, error: mErr } = await supabase!
    .from('members')
    .insert(memberPayload)
    .select()
    .single();
  if (mErr) throw mErr;

  const { data: allMembers } = await supabase!.from('members').select('*').eq('group_id', groupId);

  try {
    const approvedMembers = (allMembers ?? []).filter((m) => m.status === 'approved');
    const names = approvedMembers.map((m) => m.name);
    const pricePerPerson = calculatePricePerPerson(product.price, approvedMembers.length) ?? product.price;
    for (const currentMember of approvedMembers) {
      await sendGroupUpdateEmail({
        to: currentMember.email,
        memberName: currentMember.name,
        product,
        groupMemberNames: names,
        pricePerPerson,
        myGroupUrl: getMyGroupUrl(),
      });
    }
  } catch (error) {
    await supabase!.from('members').delete().eq('id', member.id);
    if (isNewGroup) {
      await supabase!.from('gift_groups').delete().eq('id', groupId!);
    }
    throw error;
  }

  const approvedCount = (allMembers ?? []).filter((m) => m.status === 'approved').length;
  const pricePerPerson = calculatePricePerPerson(product.price, approvedCount) ?? product.price;

  return { member, isNewGroup, pricePerPerson };
}

async function sbLoginMember(email: string): Promise<Member | null> {
  const emailHash = await hashEmail(email);
  const { data } = await supabase!
    .from('members')
    .select('*')
    .eq('email_hash', emailHash)
    .eq('status', 'approved')
    .maybeSingle();
  return data;
}

async function sbGetMemberForAuthUser(authUserId: string): Promise<Member | null> {
  const { data } = await supabase!
    .from('members')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  return data;
}

async function sbGetMemberGroupView(memberId: string): Promise<PublicGroupView | null> {
  const { data: member } = await supabase!.from('members').select('group_id').eq('id', memberId).maybeSingle();
  if (!member) return null;
  const views = await sbGetPublicGroups();
  return views.find((v) => v.group.id === member.group_id) ?? null;
}

async function sbChangeGroup(memberId: string, newGroupId: string | null, productId: string): Promise<JoinResult> {
  const { data: member } = await supabase!.from('members').select('*').eq('id', memberId).single();
  if (!member) throw new Error('Membro non trovato');
  await supabase!.from('members').delete().eq('id', memberId);
  try {
    return await sbJoinOrCreateGroup({
      productId,
      groupId: newGroupId ?? undefined,
      name: member.name,
      email: member.email,
      authUserId: member.auth_user_id ?? null,
    });
  } catch (error) {
    await supabase!.from('members').insert(member);
    throw error;
  }
}

async function sbLeaveGroup(memberId: string): Promise<boolean> {
  const { data: member } = await supabase!.from('members').select('*').eq('id', memberId).single();
  if (!member) return false;
  const groupId = member.group_id;
  await supabase!.from('members').delete().eq('id', memberId);
  const { data: remaining } = await supabase!.from('members').select('id').eq('group_id', groupId);
  if ((remaining ?? []).length === 0) {
    await supabase!.from('gift_groups').delete().eq('id', groupId);
  }
  return true;
}

async function sbClearAllGroupData(): Promise<void> {
  await supabase!.from('members').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase!.from('gift_groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

async function sbClearGroupDataForProduct(productId: string): Promise<void> {
  const { data: groups, error } = await supabase!.from('gift_groups').select('id').eq('product_id', productId);
  if (error) throw error;
  const groupIds = (groups ?? []).map((group) => group.id);
  if (groupIds.length > 0) {
    await supabase!.from('members').delete().in('group_id', groupIds);
    await supabase!.from('gift_groups').delete().eq('product_id', productId);
  }
}

async function sbSetPurchased(groupId: string, sessionToken: string, purchased: boolean): Promise<boolean> {
  const { data: member } = await supabase!
    .from('members')
    .select('id, status')
    .eq('group_id', groupId)
    .eq('session_token', sessionToken)
    .maybeSingle();
  if (!member || member.status !== 'approved') return false;
  const { error } = await supabase!.from('gift_groups').update({ purchased }).eq('id', groupId);
  return !error;
}

async function sbSaveProduct(product: Omit<Product, 'id' | 'created_at'>, id?: string): Promise<Product> {
  if (id) {
    const { data, error } = await supabase!.from('products').update(product).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase!.from('products').insert(product).select().single();
  if (error) throw error;
  return data;
}

async function sbDeleteProduct(id: string): Promise<void> {
  const { error } = await supabase!.from('products').delete().eq('id', id);
  if (error) throw error;
}

async function sbUploadImage(file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${uuid()}.${ext}`;
  const { error } = await supabase!.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase!.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function sbGetNotifications(scope: AnnouncementScope, productId?: string | null): Promise<AppNotification[]> {
  const { data, error } = await supabase!.from('app_notifications').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).filter((notification) => scope === 'all' || notification.target_product_id === productId);
}

async function sbSendAdminBroadcast(options: AdminBroadcastOptions): Promise<{ emailCount: number; appCount: number }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const token = getAdminSessionToken();
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    throw new Error('Admin authentication missing.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/admin-broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'x-client-info': 'wishlist-site',
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Admin broadcast failed: ${response.status} ${details}`);
  }

  return response.json() as Promise<{ emailCount: number; appCount: number }>;
}

async function sbGetAdminMembers(): Promise<AdminMemberRecord[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const token = getAdminSessionToken();
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    throw new Error('Admin authentication missing.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/admin-members`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'x-client-info': 'wishlist-site',
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Admin members fetch failed: ${response.status} ${details}`);
  }

  const data = await response.json() as { members: AdminMemberRecord[] };
  return data.members ?? [];
}

async function sbDeleteAdminMembers(memberIds: string[]): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const token = getAdminSessionToken();
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    throw new Error('Admin authentication missing.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/admin-members`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'x-client-info': 'wishlist-site',
    },
    body: JSON.stringify({ memberIds }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Admin members delete failed: ${response.status} ${details}`);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const useSupabase = isSupabaseConfigured;

export async function getProducts(): Promise<Product[]> {
  return useSupabase ? sbGetProducts() : localGetProducts();
}

export async function getPublicGroups(): Promise<PublicGroupView[]> {
  return useSupabase ? sbGetPublicGroups() : localGetPublicGroups();
}

export async function getProduct(id: string): Promise<Product | null> {
  return useSupabase ? sbGetProduct(id) : localGetProduct(id);
}

export async function getAppNotifications(scope: AnnouncementScope, productId: string | null = null): Promise<AppNotification[]> {
  return useSupabase ? sbGetNotifications(scope, productId) : localGetNotifications(scope, productId);
}

export async function joinOrCreateGroup(params: {
  productId: string;
  groupId?: string;
  name: string;
  email: string;
  authUserId?: string | null;
}): Promise<JoinResult> {
  return useSupabase ? sbJoinOrCreateGroup(params) : localJoinOrCreateGroup(params);
}

export async function loginMember(email: string): Promise<Member | null> {
  return useSupabase ? sbLoginMember(email) : localLoginMember(email);
}

export async function getMemberForAuthUser(authUserId: string): Promise<Member | null> {
  return useSupabase ? sbGetMemberForAuthUser(authUserId) : localGetMemberForAuthUser(authUserId);
}

export async function getMemberGroupView(memberId: string): Promise<PublicGroupView | null> {
  return useSupabase ? sbGetMemberGroupView(memberId) : localGetMemberGroupView(memberId);
}

export async function changeGroup(
  memberId: string,
  newGroupId: string | null,
  productId: string,
): Promise<JoinResult> {
  const result = useSupabase
    ? await sbChangeGroup(memberId, newGroupId, productId)
    : await localChangeGroup(memberId, newGroupId, productId);
  return result;
}

export async function leaveGroup(memberId: string): Promise<boolean> {
  return useSupabase ? sbLeaveGroup(memberId) : localLeaveGroup(memberId);
}

export async function clearAllGroupData(): Promise<void> {
  return useSupabase ? sbClearAllGroupData() : localClearAllGroupData();
}

export async function clearGroupDataForProduct(productId: string): Promise<void> {
  return useSupabase ? sbClearGroupDataForProduct(productId) : localClearGroupDataForProduct(productId);
}

export async function sendAdminAnnouncement(
  options: AdminBroadcastOptions,
): Promise<{ emailCount: number; appCount: number }> {
  return useSupabase
    ? sbSendAdminBroadcast(options)
    : localSendAdminBroadcast(options);
}

export async function getAdminMembers(): Promise<AdminMemberRecord[]> {
  return useSupabase ? sbGetAdminMembers() : [];
}

export async function deleteAdminMembers(memberIds: string[]): Promise<void> {
  if (!useSupabase) return;
  return sbDeleteAdminMembers(memberIds);
}

export async function setPurchased(groupId: string, sessionToken: string, purchased: boolean): Promise<boolean> {
  return useSupabase ? sbSetPurchased(groupId, sessionToken, purchased) : localSetPurchased(groupId, sessionToken, purchased);
}

export async function saveProduct(product: Omit<Product, 'id' | 'created_at'>, id?: string): Promise<Product> {
  return useSupabase ? sbSaveProduct(product, id) : localSaveProduct(product, id);
}

export async function deleteProduct(id: string): Promise<void> {
  return useSupabase ? sbDeleteProduct(id) : localDeleteProduct(id);
}

export async function uploadProductImage(file: File): Promise<string> {
  if (useSupabase) return sbUploadImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function getGroupsForProduct(productId: string, groups: PublicGroupView[]): PublicGroupView[] {
  return groups.filter((g) => g.product.id === productId);
}
