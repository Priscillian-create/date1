import { createBrowserClient } from "@supabase/ssr";

const fallbackSupabaseUrl = "https://jjatrpcodmoiedthvxvh.supabase.co";
const fallbackSupabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqYXRycGNvZG1vaWVkdGh2eHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODY0OTAsImV4cCI6MjA5OTQ2MjQ5MH0.jaVHWz4QUQqJZrWmklGEBJCBFedXo3C55CY66zGC5tg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fallbackSupabaseUrl;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  fallbackSupabaseKey;

export const createClient = () => createBrowserClient(supabaseUrl!, supabaseKey!);
