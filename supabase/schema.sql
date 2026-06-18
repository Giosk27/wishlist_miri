-- Schema Supabase per Wishlist Regalo di Gruppo
-- Esegui questo script nell'SQL Editor di Supabase

-- Prodotti (wishlist)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  image_url TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Gruppi regalo (uno per prodotto)
CREATE TABLE IF NOT EXISTS gift_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchased BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Membri (email protetta — non esposta nella view pubblica)
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES gift_groups(id) ON DELETE CASCADE,
  auth_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  session_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Compatibilità con database già creati
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_members_auth_user ON members(auth_user_id);

-- Profili utente collegati ad auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT DEFAULT '',
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notifiche web/app e annunci
CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_scope TEXT NOT NULL DEFAULT 'all' CHECK (target_scope IN ('all', 'product')),
  target_product_id UUID NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Subscription push PWA
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  auth TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  expiration_time TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- View pubblica: solo nomi, MAI email
CREATE OR REPLACE VIEW members_public AS
  SELECT id, group_id, name, status, created_at
  FROM members;

-- Indici
CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_members_email_hash ON members(email_hash);
CREATE INDEX IF NOT EXISTS idx_groups_product ON gift_groups(product_id);

-- Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Prodotti: lettura pubblica, scrittura aperta (admin protetto lato app)
-- In produzione restringi INSERT/UPDATE/DELETE con Edge Function + service role
DROP POLICY IF EXISTS "products_select" ON products;
DROP POLICY IF EXISTS "products_insert" ON products;
DROP POLICY IF EXISTS "products_update" ON products;
DROP POLICY IF EXISTS "products_delete" ON products;
CREATE POLICY "products_select" ON products FOR SELECT USING (true);
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (true);
CREATE POLICY "products_update" ON products FOR UPDATE USING (true);
CREATE POLICY "products_delete" ON products FOR DELETE USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO anon, authenticated, service_role;

-- Gruppi: lettura e scrittura (validazione lato app)
DROP POLICY IF EXISTS "groups_select" ON gift_groups;
DROP POLICY IF EXISTS "groups_insert" ON gift_groups;
DROP POLICY IF EXISTS "groups_update" ON gift_groups;
CREATE POLICY "groups_select" ON gift_groups FOR SELECT USING (true);
CREATE POLICY "groups_insert" ON gift_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "groups_update" ON gift_groups FOR UPDATE USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON gift_groups TO anon, authenticated, service_role;

-- Membri: insert pubblico, select limitato
DROP POLICY IF EXISTS "members_insert" ON members;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_update" ON members;
DROP POLICY IF EXISTS "members_delete" ON members;
CREATE POLICY "members_insert" ON members FOR INSERT WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "members_select" ON members FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "members_update" ON members FOR UPDATE USING (auth_user_id = auth.uid());
CREATE POLICY "members_delete" ON members FOR DELETE USING (auth_user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON members TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated, service_role;

-- Notifiche: lettura pubblica, inserimento da admin/app
DROP POLICY IF EXISTS "notifications_select" ON app_notifications;
DROP POLICY IF EXISTS "notifications_insert" ON app_notifications;
CREATE POLICY "notifications_select" ON app_notifications FOR SELECT USING (true);
CREATE POLICY "notifications_insert" ON app_notifications FOR INSERT WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON app_notifications TO anon, authenticated, service_role;

-- Push subscriptions: gestite solo da Edge Function
DROP POLICY IF EXISTS "push_subscriptions_select" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_insert" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_update" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_delete" ON push_subscriptions;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO service_role;

-- Storage bucket per immagini prodotti
-- Crea manualmente: Storage > New bucket > "product-images" > Public
-- Policy necessaria per caricare immagini dal frontend (anon client)
DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
CREATE POLICY "product_images_insert" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'product-images');

GRANT SELECT ON members_public TO anon, authenticated, service_role;
