-- Baseline — 1/N: schemi, permessi di default, enum, helper comuni.
--
-- Sostituisce le 99 migration in supabase/migrations_legacy/ (rimosse dalla
-- storia il 2026-09-20, dopo che il DB era ancora solo di test). Il modello di
-- identità è nuovo: vedi supabase/README.md, sezione «Modello».

create extension if not exists pg_net with schema public;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Permessi di default: tutto chiuso, si apre a mano.
-- ---------------------------------------------------------------------------
-- Supabase concede ad anon/authenticated ogni privilegio sulle tabelle nuove e
-- l'EXECUTE a PUBLIC sulle funzioni nuove. Qui si rovescia: una tabella o una
-- funzione senza un GRANT esplicito non è raggiungibile da REST. È la garanzia
-- che «le scritture passano solo dalle RPC» non dipenda dalla memoria di chi
-- scrive la prossima migration.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- Le policy chiamano gli helper di `private` con i privilegi di chi interroga:
-- serve USAGE sullo schema. PostgREST non espone `private`, quindi non sono RPC.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
-- authority = cosa può fare nel workspace; è indipendente dal lavorare o meno
-- (chi lavora ha righe in venue_members, qualunque sia l'authority).
create type public.member_authority as enum ('owner', 'collaborator', 'none');
-- invited = account noto che deve ancora accettare, oppure collaboratore senza
-- account; active = in organico; left = uscito (si ripristina, non si duplica).
create type public.member_status as enum ('invited', 'active', 'left');
create type public.venue_scope as enum ('all', 'selected');

create type public.employment_type as enum ('fisso', 'a_chiamata');
create type public.shift_status as enum ('open', 'closed', 'cancelled');
create type public.assignment_status as enum ('assigned', 'confirmed', 'declined', 'no_show');
create type public.change_request_kind as enum ('substitution', 'hours');
create type public.change_request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type public.absence_kind as enum ('ferie', 'permesso', 'malattia');
create type public.absence_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type public.message_kind as enum (
  'text', 'shift_change_request', 'shift_change_response', 'absence_request', 'absence_response'
);
create type public.notification_type as enum (
  'new_message', 'shift_assigned', 'staff_invite', 'staff_response', 'staff_removed',
  'shift_cancelled', 'shift_updated', 'shift_unassigned', 'shift_change_request',
  'shift_change_response', 'shift_declined', 'staff_linked', 'team_linked', 'team_joined',
  'team_removed', 'absence_request', 'absence_response', 'absence_sick'
);

-- ---------------------------------------------------------------------------
-- Helper comuni
-- ---------------------------------------------------------------------------
create or replace function public.update_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Istante in cui il turno finisce davvero, +1 giorno se scavalca la mezzanotte.
-- Gemello SQL di shiftEndsAt() in src/lib/format.ts: se cambia una, cambiare l'altra.
create or replace function public.shift_ends_at(p_date date, p_start time, p_end time)
returns timestamp language sql immutable set search_path = '' as $$
  select (p_date + p_end)
    + case when p_end <= p_start then interval '1 day' else interval '0 day' end;
$$;

-- Adesso nell'ora del locale. now() è UTC: fra mezzanotte e le 2 sarebbe ancora
-- «ieri», cioè proprio la finestra dei turni notturni.
create or replace function public.local_now()
returns timestamp language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Rome');
$$;

-- Ore fra due orari, gestendo il turno a cavallo della mezzanotte.
-- Gemello SQL di shiftDurationHours() nel client.
create or replace function public.shift_duration_hours(p_start time, p_end time)
returns numeric language sql immutable set search_path = '' as $$
  select (
    case
      when extract(epoch from (p_end - p_start)) <= 0
        then extract(epoch from (p_end - p_start)) + 86400
      else extract(epoch from (p_end - p_start))
    end
  ) / 3600.0;
$$;

grant execute on function
  public.shift_ends_at(date, time, time),
  public.local_now(),
  public.shift_duration_hours(time, time)
to authenticated;
