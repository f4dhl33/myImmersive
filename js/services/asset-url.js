// Resolver URL aset (bucket privat + signed URL). SEBAB WUJUD: bucket `project-assets`
// dulu "Public bucket" — getPublicUrl() (/object/public/...) LANGSUNG tak menilai RLS
// storan, jadi sesiapa yg tahu URL boleh muat turun aset projek persendirian. Bucket kini
// PRIVAT; setiap muat turun lalu /object/sign/... yg dinilai polisi RLS storan (pemilik,
// atau pelawat kalau projek/pemilik awam — lihat supabase/rls_policies.sql).
//
// REKA BENTUK (tiada migrasi data): pengecam aset dlm projects.data KEKAL format URL
// `.../object/public/project-assets/<path>` lama (uploadAssetToStorage pun terus pulangkan
// format ni utk muat naik baharu) — ia cuma PENGECAM, bukan URL yg boleh diambil terus lagi.
// Semua titik MUAT (loader model/imej/tekstur/audio, exporter) panggil resolveAssetUrl()
// dulu; data:/blob: (fail eksport) & URL luar lalu terus tanpa disentuh.
//
// PENTING utk fail eksport (view.html dibakar offline): modul ni TAK boleh sentuh
// window.supabase semasa module-eval — SDK Supabase dibuang dari fail eksport. Klien hanya
// dicipta lazily bila ada URL storan sebenar yg perlu ditandatangan (tak pernah berlaku
// dlm fail eksport sebab semua aset dah jadi data: URI).
const SUPABASE_URL = 'https://jmuraizgowqwmpmetupu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZ8vjKrIJhXM34D7ddS6dw_nlIL18YD';
export const ASSET_BUCKET = 'project-assets';
const PUBLIC_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${ASSET_BUCKET}/`;

// 12 jam: audio "Play Sound" dimainkan dari URL yg ditandatangan masa projek dimuat
// (new Audio() segerak dlm handler klik — tak boleh tunggu tandatangan baharu tanpa
// hilang user-gesture autoplay), jadi TTL kena cukup panjang utk satu sesi mengajar.
const SIGNED_URL_TTL_SEC = 12 * 60 * 60;
const RENEW_MARGIN_MS = 5 * 60 * 1000;

let clientProvider = null;
let lazyClient = null;

// index.html hantar klien supabase.js yg DAH log masuk (perlu utk tandatangan fail projek
// persendirian pemilik). view.html/fail eksport tak panggil — klien anon dicipta lazily.
export function setAssetUrlClient(provider) {
    clientProvider = (typeof provider === 'function') ? provider : () => provider;
}

function getClient() {
    if (clientProvider) return clientProvider();
    if (!lazyClient) {
        if (!window.supabase) throw new Error('Supabase SDK not loaded — cannot sign asset URL.');
        lazyClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return lazyClient;
}

export function storagePathFromAssetUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(PUBLIC_URL_PREFIX)) return null;
    const raw = url.slice(PUBLIC_URL_PREFIX.length).split('?')[0];
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

const signedCache = new Map(); // pengecam kanonikal -> { signedUrl, expiresAt }
const inFlight = new Map();    // pengecam kanonikal -> Promise<signedUrl|null> (dedupe serentak)

// Versi SEGERAK — pulangkan signed URL kalau dah ada dlm cache (diprefetch masa projek
// dimuat), kalau tidak pengecam asal. Utk laluan yg tak boleh async (new Audio() dlm
// handler klik).
export function peekAssetUrl(url) {
    const c = signedCache.get(url);
    return (c && c.expiresAt > Date.now()) ? c.signedUrl : url;
}

export async function resolveAssetUrl(url) {
    const [resolved] = await resolveAssetUrls([url]);
    return resolved;
}

// Tandatangan secara BERKELOMPOK (satu panggilan createSignedUrls utk semua path unik) —
// projek dgn byk aset tak perlu N round-trip.
export async function resolveAssetUrls(urls) {
    const out = urls.slice();
    const pending = [];   // perlu panggilan tandatangan baharu
    const awaiting = [];  // dah ada permintaan serentak dlm perjalanan — tumpang
    urls.forEach((u, i) => {
        const path = storagePathFromAssetUrl(u);
        if (!path) return;
        const c = signedCache.get(u);
        if (c && c.expiresAt - RENEW_MARGIN_MS > Date.now()) { out[i] = c.signedUrl; return; }
        const f = inFlight.get(u);
        if (f) { awaiting.push({ i, promise: f }); return; }
        pending.push({ i, path, u });
    });

    if (pending.length > 0) {
        const batch = signBatch(pending.map(p => ({ path: p.path, u: p.u })));
        pending.forEach(p => {
            const promise = batch.then(byUrl => byUrl.get(p.u) || null).finally(() => {
                if (inFlight.get(p.u) === promise) inFlight.delete(p.u);
            });
            inFlight.set(p.u, promise);
            awaiting.push({ i: p.i, promise });
        });
    }

    const results = await Promise.all(awaiting.map(a => a.promise));
    awaiting.forEach((a, k) => { if (results[k]) out[a.i] = results[k]; });
    return out;
}

// Satu panggilan createSignedUrls utk semua path unik; pulangkan Map pengecam -> signedUrl.
async function signBatch(items) {
    const byUrl = new Map();
    const uniquePaths = [...new Set(items.map(it => it.path))];
    let data, error;
    try {
        ({ data, error } = await getClient().storage.from(ASSET_BUCKET).createSignedUrls(uniquePaths, SIGNED_URL_TTL_SEC));
    } catch (e) { error = e; }
    if (error || !Array.isArray(data)) {
        // Jangan gugurkan muat projek keseluruhan — biar loader aset tu sendiri gagal
        // (ralat jelas dlm console) sementara aset lain terus dimuat.
        console.error('[AssetUrl] createSignedUrls failed:', error);
        return byUrl;
    }
    const byPath = new Map();
    data.forEach(d => {
        const signed = d && (d.signedUrl || d.signedURL);
        if (signed && !d.error) byPath.set(d.path, signed);
        else if (d && d.error) console.warn('[AssetUrl] cannot sign "' + d.path + '":', d.error);
    });
    const expiresAt = Date.now() + SIGNED_URL_TTL_SEC * 1000;
    items.forEach(it => {
        const signed = byPath.get(it.path);
        if (!signed) return;
        signedCache.set(it.u, { signedUrl: signed, expiresAt });
        byUrl.set(it.u, signed);
    });
    return byUrl;
}
