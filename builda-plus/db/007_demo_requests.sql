-- "Book a demo" requests from the public landing page. Not firm data: there is no organisation yet,
-- so no org_id and no row-level security. Only JADA staff read them, through the app.
create table demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 200),
  firm_name text not null check (length(firm_name) between 2 and 160),
  role text not null check (role in ('owner_director', 'operations', 'adviser', 'compliance', 'other')),
  firm_size text not null check (firm_size in ('1-5', '6-20', '21-50', '51-200', '200+')),
  message text check (message is null or length(message) <= 1500),
  created_at timestamptz not null default now()
);
create index demo_requests_created_at on demo_requests (created_at desc);
grant insert, select on demo_requests to builda_app;
