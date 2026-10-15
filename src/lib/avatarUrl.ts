/** Foto e loghi caricati nel bucket avatars del progetto, senza URL esterni. */
export function isStorageAvatarUrl(url: string | null | undefined): url is string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  return !!base && !!url && url.startsWith(`${base}/storage/v1/object/public/avatars/`);
}
