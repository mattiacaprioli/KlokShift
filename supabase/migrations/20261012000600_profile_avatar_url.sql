-- Foto profilo: solo URL pubblici del bucket avatars nel percorso della persona.
-- I valori precedenti non vengono riscritti; i client filtrano anche quelli.
create function private.check_avatar_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avatar_url is not null and new.avatar_url !~ (
    '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
    || new.id::text || '/[^/?#]+$'
  ) then
    raise exception 'invalid_avatar_url' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_avatar_url() from public, anon, authenticated;

create trigger profiles_check_avatar_url
before insert or update of avatar_url on public.profiles
for each row execute function private.check_avatar_url();
