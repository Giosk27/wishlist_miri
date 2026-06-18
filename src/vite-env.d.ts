/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ADMIN_PASSWORD: string;
  readonly VITE_BASE_PATH: string;
  readonly VITE_SITE_URL: string;
  readonly VITE_EMAIL_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
