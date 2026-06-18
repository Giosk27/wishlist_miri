import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Product, GiftGroup, Member } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export type DbProduct = Product;
export type DbGroup = GiftGroup;
export type DbMember = Member;

export const STORAGE_BUCKET = 'product-images';
