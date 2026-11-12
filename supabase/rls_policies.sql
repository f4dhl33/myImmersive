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
--    projek is_public=true. BUKAN skop per-projek — kalau seorang
--    pengguna ada 1 projek awam & 1 persendirian, fail persendirian
--    dia pun lulus polisi ni.
--
--    HAD PENTING (disahkan selepas review 2026-11-11): bucket ni
--    "Public bucket", dan app baca SEMUA aset melalui getPublicUrl()
--    (/storage/v1/object/public/...) — laluan tu LANGSUNG TAK menilai
--    polisi RLS. Jadi polisi SELECT di bawah hanya mengawal
--    .list()/.download() via endpoint berautentikasi (cth.
--    deleteAllUserStorageFiles), BUKAN muat turun aset oleh pelawat.
--    Sesiapa yg tahu URL (tak boleh diteka: userId/timestamp_rawak_
--    nama) tetap boleh muat turun selagi bucket kekal awam.
--
--    PENYELESAIAN (bucket PRIVAT + signed URL, lihat js/services/asset-url.js):
--    tukar bucket ke "Private" dlm Dashboard > Storage SELEPAS app baharu
--    di-deploy. Semua muat turun lalu createSignedUrl() yg MENILAI polisi
--    SELECT ni — pelawat awam (anon) pun lulus cawangan `exists(...)` bila
--    projek awam, jadi TIADA Edge Function diperlukan. Muat naik BAHARU
--    guna path `userId/projectId/fail` → skop PER-PROJEK TEPAT (hanya
--    projek INI yg awam). Path LAMA `userId/fail` kekal pendekatan
--    anggaran di atas (mana-mana projek awam pemilik) — tiada migrasi
--    fail/URL sedia ada (pengecam dlm projects.data kekal, asset-url.js
--    tukar kpd signed URL masa muat).
-- ---------------------------------------------------------------------
--    NOTA PELAKSANAAN: semakan dibuat dlm fungsi SECURITY DEFINER, BUKAN
--    sub-query terus dlm polisi. Diuji 2026-11-11: versi sub-query terus
--    MENOLAK anon pd DB sebenar (createSignedUrls/list gagal utk projek
--    awam) — sub-query `public.projects` dlm polisi storage.objects dinilai
--    dlm konteks sambungan storage-api (hak role/RLS-dalam-RLS), bukan
--    sama spt PostgREST. SECURITY DEFINER lepasi kekangan tu; auth.uid()
--    tetap baca claim JWT permintaan semasa.
create or replace function public.asset_folder_is_readable(folder text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        (auth.uid() is not null and folder[1] = auth.uid()::text)
        or exists (
            select 1 from public.projects p
            where p.owner_id::text = folder[1]
              and p.is_public = true
              and (
                  -- path baharu userId/projectId/...: mesti projek INI yg awam
                  (array_length(folder, 1) >= 2 and p.id::text = folder[2])
                  -- path lama userId/...: mana-mana projek awam pemilik
                  or array_length(folder, 1) = 1
              )
        );
$$;
revoke all on function public.asset_folder_is_readable(text[]) from public;
grant execute on function public.asset_folder_is_readable(text[]) to anon, authenticated, service_role;

drop policy if exists "Public can view files" on storage.objects;
drop policy if exists "Readable by owner or if owner has a public project" on storage.objects;
drop policy if exists "Readable by owner, or by anyone if the project is public" on storage.objects;
create policy "Readable by owner, or by anyone if the project is public"
    on storage.objects for select
    using (
        bucket_id = 'project-assets'
        and public.asset_folder_is_readable(storage.foldername(name))
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
