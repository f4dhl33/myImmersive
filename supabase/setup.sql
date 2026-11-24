-- =====================================================================
-- WebXR PdP Builder — Setup Supabase (Jadual + Storan + Security Rules)
-- Jalankan skrip ni SEKALI SAHAJA dalam Supabase Dashboard > SQL Editor,
-- KEMUDIAN jalankan supabase/rls_policies.sql (konfigurasi RLS utama).
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
-- STORAGE: bucket 'project-assets' — WAJIB PRIVAT
-- Aset dibaca melalui signed URL (js/services/asset-url.js) yang menilai
-- polisi RLS. JANGAN tandakan "Public bucket": laluan /object/public/...
-- langsung tak menilai RLS, jadi aset projek persendirian akan terdedah.
--
-- Blok di bawah mencipta bucket sebagai PRIVAT (atau menukarnya ke privat
-- kalau dah wujud). Polisi storage (baca/tulis/padam) TIDAK ditakrif di
-- sini — selepas skrip ni, jalankan supabase/rls_policies.sql (konfigurasi
-- utama RLS jadual + storan; selamat dijalankan berulang kali).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do update set public = false;
