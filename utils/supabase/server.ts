import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const fallbackSupabaseUrl = "https://jjatrpcodmoiedthvxvh.supabase.co";
const fallbackSupabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqYXRycGNvZG1vaWVkdGh2eHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODY0OTAsImV4cCI6MjA5OTQ2MjQ5MH0.jaVHWz4QUQqJZrWmklGEBJCBFedXo3C55CY66zGC5tg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fallbackSupabaseUrl;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  fallbackSupabaseKey;

export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) => {
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies directly; middleware refreshes sessions.
        }
      },
    },
  });
};
