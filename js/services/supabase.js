// Servis luaran: Auth + Database (jadual `projects`) + Storage (project-assets) via Supabase.
// Diekstrak dari index.html — tiada kebergantungan pada DOM atau state editor (currentUser,
// activeProjectId, dll kekal di main script; fungsi di sini terima id/parameter terus).
// window.supabase (UMD SDK) mesti sudah dimuat sebelum modul ni jalan — dijamin sebab
// <script src=".../supabase-js@2/..."> di index.html adalah classic script (bukan
// defer/module), jadi ia execute semasa parsing, sebelum mana-mana <script type="module">
// (termasuk modul ni) yang sentiasa deferred sampai selepas dokumen siap di-parse.
const SUPABASE_URL = 'https://jmuraizgowqwmpmetupu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZ8vjKrIJhXM34D7ddS6dw_nlIL18YD';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Utk asset-url.js tandatangan URL aset dgn sesi log masuk yg SAMA (fail projek
// persendirian hanya boleh ditandatangan oleh pemiliknya).
export function getSupabaseClient() {
    return supabaseClient;
}

// ---- AUTH ----
export async function signUpUser(email, password) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

export async function signInUser(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signOutUser() {
    await supabaseClient.auth.signOut();
}

export function onAuthStateChange(callback) {
    return supabaseClient.auth.onAuthStateChange(callback);
}

export async function getCurrentSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}

export async function requestPasswordReset(email, redirectUrl) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
    if (error) throw error;
}

export async function updateUserPassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

// ---- STORAGE (fail model/gambar/audio) ----
// Path `userId/projectId/fail` — segmen projectId bagi polisi RLS storan skop baca
// PER-PROJEK tepat (lihat supabase/rls_policies.sql). Nilai pulangan kekal format URL
// /object/public/... walaupun bucket kini PRIVAT — ia PENGECAM yg disimpan dlm
// projects.data, bukan URL boleh-ambil; semua titik muat lalu resolveAssetUrl()
// (js/services/asset-url.js) utk dapat signed URL.
export async function uploadAssetToStorage(userId, file, projectId) {
    if (!userId) throw new Error('Please sign in first.');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = projectId ? `${userId}/${projectId}` : userId;
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

    const { error } = await supabaseClient.storage.from('project-assets').upload(path, file, {
        cacheControl: '3600',
        upsert: false
    });
    if (error) throw error;

    const { data } = supabaseClient.storage.from('project-assets').getPublicUrl(path);
    return data.publicUrl;
}

export async function deleteAllUserStorageFiles(userId) {
    const bucket = supabaseClient.storage.from('project-assets');
    const { data: entries, error } = await bucket.list(userId);
    if (error) { console.error('Gagal senaraikan fail Storage:', error); return; }
    if (!entries || entries.length === 0) return;

    // list() tak rekursif — sub-folder projectId (path baharu) muncul sbg entri tanpa
    // `id`; senaraikan isinya sekali lagi supaya fail dlm tu turut dipadam.
    const paths = [];
    for (const e of entries) {
        if (e.id) { paths.push(`${userId}/${e.name}`); continue; }
        const { data: sub, error: subErr } = await bucket.list(`${userId}/${e.name}`);
        if (subErr) { console.error('Gagal senaraikan sub-folder Storage:', subErr); continue; }
        (sub || []).forEach(f => { if (f.id) paths.push(`${userId}/${e.name}/${f.name}`); });
    }
    if (paths.length === 0) return;

    const { error: removeError } = await bucket.remove(paths);
    if (removeError) console.error('Gagal padam fail Storage:', removeError);
}

// ---- PROJEK (Firestore-setara: jadual `projects` di Supabase) ----
export async function fetchMyProjects(ownerId) {
    const { data, error } = await supabaseClient
        .from('projects')
        .select('id,name,is_public,updated_at')
        .eq('owner_id', ownerId)
        .order('updated_at', { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
}

export async function createProjectRow(ownerId, name) {
    const { data, error } = await supabaseClient
        .from('projects')
        .insert({ owner_id: ownerId, name: name, data: {} })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function loadProjectRow(projectId) {
    const { data, error } = await supabaseClient
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
    if (error) { console.error(error); return null; }
    return data;
}

export async function saveProjectRow(projectId, dataObj) {
    const { error } = await supabaseClient
        .from('projects')
        .update({ data: dataObj })
        .eq('id', projectId);
    if (error) throw error;
}

export async function deleteProjectRow(projectId) {
    const { error } = await supabaseClient.from('projects').delete().eq('id', projectId);
    if (error) throw error;
}

export async function renameProjectRow(projectId, newName) {
    const { error } = await supabaseClient.from('projects').update({ name: newName }).eq('id', projectId);
    if (error) throw error;
}

export async function togglePublicRow(projectId, isPublic) {
    const { error } = await supabaseClient.from('projects').update({ is_public: isPublic }).eq('id', projectId);
    if (error) throw error;
}

export async function deleteAllUserProjects(ownerId) {
    const { error } = await supabaseClient.from('projects').delete().eq('owner_id', ownerId);
    if (error) throw error;
}
