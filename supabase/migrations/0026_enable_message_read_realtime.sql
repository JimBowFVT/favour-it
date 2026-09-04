do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_reads'
  ) then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
end $$;
