-- Support stable newest-first keyset pagination, including equal creation timestamps.
-- Apply during an approved migration window; index creation may lock writes on large tables.
create index applicants_created_id_idx on public.applicants (created_at desc, id desc);
create index leads_created_id_idx on public.leads (created_at desc, id desc);
