-- =====================================================================
-- WebXR PdP Builder — Audit/kemaskini RLS (jadual `projects` + bucket
-- storan `project-assets`). Selamat dijalankan BERULANG KALI (setiap
-- `create policy` didahului `drop policy if exists` dgn nama yg sama)
-- — lain dgn supabase/setup.sql yg cuma sepatutnya dijalankan SEKALI.
--
-- NOTA NAMA LAJUR: jadual `projects` guna lajur `owner_id` (BUKAN
-- `user_id`) — lihat js/services/supabase.js (semua query `.eq('owner_id', ...)`).
-- Syarat di bawah ikut makna "pemilik projek", bukan nama lajur literal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JADUAL public.projects
--    SELECT   : is_public = true  ATAU  auth.uid() = owner_id
--    INSERT/UPDATE/DELETE : hanya pemilik (auth.uid() = owner_id)
-- ---------------------------------------------------------------------
alter table public.projects enable row level security;

-- Gantikan 2 polisi SELECT lama (setup.sql) dgn SATU polisi gabungan —
-- secara logik sama (RLS OR-kan semua polisi permissive utk aksi yg
-- sama), cuma lebih jelas sepadan dgn syarat yg diminta.
drop policy if exists "Owners can view their own projects" on public.projects;
drop policy if exists "Public can view public projects" on public.projects;
drop policy if exists "Projects are readable by owner or if public" on public.projects;
create policy "Projects are readable by owner or if public"
    on public.projects for select
    using (is_public = true or auth.uid() = owner_id);

drop policy if exists "Owners can insert their own projects" on public.projects;
create policy "Owners can insert their own projects"
    on public.projects for insert
    with check (auth.uid() = owner_id);

drop policy if exists "Owners can update their own projects" on public.projects;
create policy "Owners can update their own projects"
    on public.projects for update
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own projects" on public.projects;
create policy "Owners can delete their own projects"
    on public.projects for delete
    using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------
-- 2. BUCKET STORAN 'project-assets'
--    Path fail: `${userId}/${timestamp}_${rand}_${filename}` — TIADA
--    projectId dalam path (lihat uploadAssetToStorage() dlm
--    js/services/supabase.js), jadi mustahil skop baca ikut projek
--    TERTENTU secara tepat tanpa ubah struktur path + migrate fail
--    sedia ada. Pendekatan "anggaran" yg dipilih (disahkan oleh
--    pengguna): folder tu boleh dibaca kalau DIMINTA OLEH PEMILIK
--    SENDIRI, ATAU pemilik folder tu ADA SEKURANG-KURANGNYA SATU
--    projek is_public=true. Ini lebih ketat drpd sedia ada ("Public
--    can view files" — sesiapa boleh baca APA JUA fail, tanpa syarat
--    langsung), tapi BUKAN skop per-projek — kalau seorang pengguna
--    ada 1 projek awam & 1 projek persendirian, fail projek
--    persendirian dia pun tetap boleh dibaca org luar (sebab RLS
--    storan tak dapat tahu fail tu "milik" projek yang mana).
-- ---------------------------------------------------------------------
drop policy if exists "Public can view files" on storage.objects;
drop policy if exists "Readable by owner or if owner has a public project" on storage.objects;
create policy "Readable by owner or if owner has a public project"
    on storage.objects for select
    using (
        bucket_id = 'project-assets'
        and (
            (storage.foldername(name))[1] = auth.uid()::text
            or exists (
                select 1 from public.projects p
                where p.owner_id::text = (storage.foldername(name))[1]
                  and p.is_public = true
            )
        )
    );

-- Tulis/padam fail — tetap terhad kpd pemilik folder sahaja (tiada
-- perubahan drpd setup.sql, diulang di sini sekadar utk idempotency
-- skrip ni sbg satu unit).
drop policy if exists "Users can upload to their own folder" on storage.objects;
create policy "Users can upload to their own folder"
    on storage.objects for insert
    with check (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "Users can update their own files" on storage.objects;
create policy "Users can update their own files"
    on storage.objects for update
    using (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "Users can delete their own files" on storage.objects;
create policy "Users can delete their own files"
    on storage.objects for delete
    using (
        bucket_id = 'project-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
