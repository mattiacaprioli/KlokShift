-- Il glossario del 30/10 (docs/GLOSSARIO.md) nei testi che scrive il database:
-- notifiche ed errori sollevati dalle RPC. «Organico» diventa «team»,
-- «professionista» diventa «dipendente», «operatività» sparisce.
--
-- Riscrittura dinamica, come 20260917100000_rename_locale_to_sede (legacy): le
-- funzioni coinvolte sono state ridefinite da migration diverse e ricopiarle
-- qui vorrebbe dire duplicare centinaia di righe con il rischio di riportare
-- indietro una correzione. Si toccano **solo** le frasi elencate;
-- `pg_get_functiondef` + `CREATE OR REPLACE` conserva oid, SECURITY DEFINER,
-- search_path e trigger agganciati. Le ACL le conserva il replace stesso.
--
-- Si cercano le funzioni per contenuto e non per nome, in public e private:
-- una frase che resta in giro è un errore di copy, non di sicurezza, e la
-- verifica in fondo fa fallire la migration se ne sopravvive una.
do $mig$
declare
  r record;
  src text;
  pair text[];
  -- In ordine: le forme più lunghe prima di quelle che contengono.
  pairs constant text[][] := array[
    array[' ti ha aggiunto al suo organico.', ' ti ha aggiunto al suo team.'],
    array['Non fai più parte dell''''organico di ', 'Non fai più parte del team di '],
    array['Non fai parte dell''''organico di questa azienda', 'Non fai parte del team di questa azienda'],
    array[' ha lasciato l''''organico.', ' ha lasciato il team.'],
    array['''Un professionista ha lasciato la sede''', '''Un dipendente ha lasciato la sede'''],
    array['''Un professionista ha lasciato''', '''Un dipendente ha lasciato il team'''],
    array['''Un professionista''', '''Un dipendente'''],
    array['L''''operatività è terminata. ', 'L''''azienda non è più attiva. ']
  ];
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and (p.prosrc like '%organico%' or p.prosrc like '%professionista%'
           or p.prosrc like '%operatività%')
  loop
    src := pg_get_functiondef(r.oid);
    foreach pair slice 1 in array pairs loop
      src := replace(src, pair[1], pair[2]);
    end loop;
    execute src;
  end loop;

  -- Nessuna delle frasi vecchie deve sopravvivere in un testo (i commenti SQL
  -- dentro i corpi possono ancora dire «organico»: non arrivano all'utente).
  perform 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.prosrc like '%''Un professionista%'
         or p.prosrc like '%organico di %'
         or p.prosrc like '%al suo organico%'
         or p.prosrc like '%l''''organico.%'
         or p.prosrc like '%operatività è terminata%');
  if found then
    raise exception 'glossary_copy: è rimasta una frase da riscrivere';
  end if;
end
$mig$;
