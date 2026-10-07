import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicAuthConfig } from "./config";

export async function createDreamServerAuthClient() {
  const config = publicAuthConfig();
  if (!config) return null;
  const jar = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Server components may read but cannot always write cookies.
        }
      }
    }
  });
}

export async function currentUserId() {
  const client = await createDreamServerAuthClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}
