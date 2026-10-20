-- Voce 4: quota documenti. Misurata dallo Storage, blocca solo i nuovi
-- caricamenti, rispetta il limite concesso dal fondatore.
begin;

do $$
declare
  w1 uuid := tests.id('W1'); emp uuid := tests.id('M_Emp'); q jsonb;
begin
  perform tests.logout();
  insert into storage.objects (bucket_id, name, metadata) values
    ('staff-documents', emp || '/contratto.pdf', '{"size":1048576}'),
    ('staff-documents', emp || '/senza-misura.pdf', '{}'),
    ('staff-documents', tests.id('M_Emp_W2') || '/altra-azienda.pdf', '{"size":2147483648}');

  perform tests.login('Ow');
  q := public.get_member_document_quota(emp);
  perform tests.eq((q ->> 'used_bytes')::bigint, 1048576::bigint, 'conta i file veri dell''azienda, non quelli di altre');
  perform tests.eq((q ->> 'limit_bytes')::bigint, 2147483648::bigint, 'limite base di 2 GiB');
  perform tests.eq(private.can_upload_member_documents(emp), true, 'sotto il limite si carica');

  perform tests.login('Emp');
  perform tests.eq((public.get_member_document_quota(emp) ->> 'used_bytes')::bigint, 1048576::bigint,
    'il professionista vede lo spazio dei propri documenti');
  perform tests.login('Co');
  perform tests.raises(format('select public.get_member_document_quota(%L)', emp), 'not_allowed',
    'senza permesso sui documenti niente spazio');

  -- Quota piena: un file da 2 GiB nella stessa azienda.
  perform tests.logout();
  insert into storage.objects (bucket_id, name, metadata)
  values ('staff-documents', tests.id('M_Emp2') || '/grande.pdf', '{"size":2147483648}');
  perform tests.login('Ow');
  perform tests.eq(private.can_upload_member_documents(emp), false, 'a quota piena niente nuovi file');
  perform tests.eq(private.can_access_member_documents(emp), true, 'ma i documenti restano leggibili');

  -- Il fondatore concede 4 GiB con la gratuità: si torna a caricare.
  perform tests.logout();
  update public.workspace_access_periods set document_limit_bytes = 4294967296 where workspace_id = w1;
  perform tests.login('Ow');
  perform tests.eq((public.get_member_document_quota(emp) ->> 'limit_bytes')::bigint, 4294967296::bigint,
    'vale il limite concesso');
  perform tests.eq(private.can_upload_member_documents(emp), true, 'e sotto quel limite si carica');
  perform tests.logout();
end $$;

rollback;
select 'document quota: ok' as result;
