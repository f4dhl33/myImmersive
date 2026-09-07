-- =====================================================================
-- WebXR PdP Builder — Setup Supabase (Jadual + Storan + Security Rules)
-- Jalankan skrip ni SEKALI SAHAJA dalam Supabase Dashboard > SQL Editor
-- =====================================================================

-- 1. JADUAL PROJECTS
create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null default 'Projek Tanpa Nama',
    data jsonb not null default '{}'::jsonb,
    is_public boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects(owner_id);

-- 2. ENABLE ROW LEVEL SECURITY
alter table public.projects enable row level security;

-- 3. POLICIES — pemilik boleh urus projek sendiri sepenuhnya
create policy "Owners can view their own projects"
    on public.projects for select
    using (auth.uid() = owner_id);

create policy "Owners can insert their own projects"
    on public.projects for insert
    with check (auth.uid() = owner_id);

create policy "Owners can update their own projects"
    on public.projects for update
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Owners can delete their own projects"
    on public.projects for delete
    using (auth.uid() = owner_id);

-- 4. POLICY — sesiapa (tanpa sign in) boleh BACA projek yang ditanda awam
--    (untuk link/QR viewer AR/VR berfungsi tanpa login)
create policy "Public can view public projects"
    on public.projects for select
    using (is_public = true);

-- 5. AUTO-UPDATE updated_at setiap kali projek diubah
create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger set_projects_updated_at
    before update on public.projects
    for each row
    execute function public.set_updated_at();

-- =====================================================================
-- STORAGE POLICIES untuk bucket 'project-assets'
-- NOTA: Bucket 'project-assets' KENA dicipta dulu melalui Dashboard >
-- Storage > New Bucket (tandakan sebagai "Public bucket") SEBELUM
-- jalankan bahagian ni, kalau tidak akan ada ralat.
-- =====================================================================

-- Pemilik fail (folder pertama dalam path = user id mereka) boleh upload
create policy "Users can upload to their own folder"
    on storage.objects for insert
    with check (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Pemilik fail boleh kemaskini fail sendiri
create policy "Users can update their own files"
    on storage.objects for update
    using (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Pemilik fail boleh padam fail sendiri
create policy "Users can delete their own files"
    on storage.objects for delete
    using (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Sesiapa boleh BACA/muat turun fail (perlu untuk viewer AR/VR tanpa login)
create policy "Public can view files"
    on storage.objects for select
    using (bucket_id = 'project-assets');
