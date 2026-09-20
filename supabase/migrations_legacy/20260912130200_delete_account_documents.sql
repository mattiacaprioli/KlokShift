-- Cancellazione account: portarsi via anche i propri documenti.
--
-- `delete_account` (20260909195210) **non cancella** la riga `profiles`: la
-- trasforma in una lapide (`deleted_at`), perché conversazioni, locali e turni
-- la referenziano. Conseguenza: nessuna cascata scatta mai su una FK che punta a
-- `profiles`, e `staff_documents.uploaded_by` è `on delete set null` proprio per
-- questo.
--
-- Senza questo passaggio, chi cancella l'account lascerebbe nel bucket i file
-- che ha caricato — HACCP, contratti, spesso con nome e codice fiscale. È
-- precisamente la categoria di dato per cui la cancellazione account esiste.
--
-- ⚠️ Si cancellano **solo i documenti caricati da lui**. Quelli che il locale ha
-- caricato sulla scheda restano: sono registri del locale, che di quei dati è
-- titolare autonomo, e spariranno comunque il giorno in cui la scheda viene
-- rimossa. La distinzione la fa `uploaded_by`, che esiste anche per questo.
--
-- ⚠️ Qui spariscono le **righe**, non i file: Postgres non può cancellare da
-- Storage. I blob li rimuove la Edge Function `delete-account`, che ha il client
-- service_role — e li legge **prima** di chiamare questa funzione, perché dopo i
-- path non esistono più.
--
-- Il resto del corpo è identico a 20260909195210: `create or replace` vuole la
-- funzione intera, quindi l'unica differenza è la `delete from
-- public.staff_documents` qui sotto. Cambiare altro da qui è un errore.
create or replace function public.delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_user;
  if not found then
    return;
  end if;

  -- ⟨aggiunta 20260912130200⟩ Vale per entrambi i ruoli: anche un gestore può
  -- aver caricato documenti sulle schede del suo organico.
  delete from public.staff_documents where uploaded_by = p_user;

  if v_role = 'waiter' then
    -- Reputazione, candidature e scheda professionale sono dati personali suoi.
    delete from public.reviews            where waiter_id = p_user;
    delete from public.waiter_experiences where waiter_id = p_user;
    delete from public.waiter_profiles    where id        = p_user;
    delete from public.applications       where waiter_id = p_user;

    -- Inviti mai accettati: via. Collaborazioni attive: si slega l'account ma la
    -- scheda resta, altrimenti il locale perde le ore già lavorate.
    delete from public.staff_members
      where waiter_id = p_user and link_status = 'pending';
    update public.staff_members
      set waiter_id = null
      where waiter_id = p_user;
  else
    -- Il locale sopravvive per non distruggere lo storico altrui, ma va chiuso.
    update public.venues
      set closed_at = now()
      where owner_id = p_user and closed_at is null;

    -- I turni futuri ancora aperti non avrebbero più nessuno a gestirli.
    -- L'update fa scattare notify_on_shift_cancelled, che avvisa assegnati e
    -- candidati accettati: è il comportamento voluto, non un effetto collaterale.
    update public.shifts s
      set status = 'cancelled'
      where s.venue_id in (select v.id from public.venues v where v.owner_id = p_user)
        and s.date >= current_date
        and s.status <> 'cancelled';
  end if;

  -- Comuni a entrambi i ruoli.
  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  -- La lapide: nessun dato personale, ma la riga resta perché conversazioni,
  -- turni e locali la referenziano.
  update public.profiles
    set full_name          = 'Utente eliminato',
        avatar_url         = null,
        phone              = null,
        bio                = null,
        city               = null,
        notification_prefs = '{}'::jsonb,
        deleted_at         = now()
    where id = p_user;
end;
$$;

revoke all on function public.delete_account(uuid) from anon, authenticated, public;
