// Eksport projek sebagai SATU fail *.html berdiri sendiri — diekstrak dari index.html.
// SEJARAH BUG (3 dah dibetulkan, lihat memori standalone_export_feature): $-replace
// corruption (".replace()" guna FUNGSI sebagai hujah ke-2, bukan string terus — lihat nota
// dalam exportProjectAsStandaloneHtml), texture race (semua asset di-encode base64 SEBELUM
// templat view.html diproses), stale cached view.html fetch (cache: 'no-store'). JANGAN ubah
// urutan/logik operasi ni tanpa ulang ujian penuh.
//
// Tujuan: pemilik projek boleh "bake" keseluruhan projek (scene/objek/interaksi + SEMUA
// asset: model 3D, imej, audio + SEMUA library Three.js/cannon.js) jadi SATU fail .html,
// untuk letak di server sendiri — jalan 100% offline/tanpa panggil Supabase terus, jimatkan
// bandwidth/kapasiti server asal projek ni bila byk pengguna.
export function getViewerUrl(activeProjectId) {
    const base = window.location.href.replace(/index\.html.*$/, '').replace(/\/?$/, '/');
    return base + 'view.html?project=' + encodeURIComponent(activeProjectId);
}

export function guessMimeFromUrl(url) {
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const map = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
        glb: 'model/gltf-binary', gltf: 'model/gltf+json', fbx: 'application/octet-stream'
    };
    return map[ext] || null;
}

export async function urlToDataUri(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching ' + url);
    const blob = await resp.blob();
    const mime = guessMimeFromUrl(url) || blob.type || 'application/octet-stream';
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

export async function exportProjectAsStandaloneHtml({ activeProjectId, activeProjectName, serializeSceneForSave, setSaveStatusText }) {
    if (!activeProjectId) { alert('Please open/save a project first.'); return; }

    const btn = document.getElementById('btn-export-html');
    btn.disabled = true;
    try {
        setSaveStatusText('⏳ Exporting... preparing project data');
        const projectJson = JSON.parse(JSON.stringify(serializeSceneForSave()));

        // Kumpul SEMUA url asset unik (model/imej/audio/texture custom) merentasi
        // semua scene — satu Set supaya asset yang dikongsi (cth. duplicate objek,
        // audio dipakai dalam >1 scene) cuma dimuat turun & encode SEKALI.
        const urlSet = new Set();
        projectJson.scenes.forEach(scene => {
            (scene.objects || []).forEach(obj => {
                if (obj.fileUrl) urlSet.add(obj.fileUrl);
                if (obj.customTextureUrl) urlSet.add(obj.customTextureUrl);
            });
        });
        (projectJson.audios || []).forEach(a => { if (a.url) urlSet.add(a.url); });

        const urlList = [...urlSet];
        const dataUriMap = new Map();
        for (let i = 0; i < urlList.length; i++) {
            setSaveStatusText(`⏳ Exporting... asset ${i + 1}/${urlList.length}`);
            dataUriMap.set(urlList[i], await urlToDataUri(urlList[i]));
        }

        projectJson.scenes.forEach(scene => {
            (scene.objects || []).forEach(obj => {
                if (obj.fileUrl && dataUriMap.has(obj.fileUrl)) obj.fileUrl = dataUriMap.get(obj.fileUrl);
                if (obj.customTextureUrl && dataUriMap.has(obj.customTextureUrl)) obj.customTextureUrl = dataUriMap.get(obj.customTextureUrl);
            });
        });
        (projectJson.audios || []).forEach(a => {
            if (a.url && dataUriMap.has(a.url)) a.url = dataUriMap.get(a.url);
        });

        setSaveStatusText('⏳ Exporting... bundling libraries (offline mode, this can take a moment)');
        // cache: 'no-store' — view.html (fail sendiri, path relatif tanpa versi) kena
        // sentiasa ambil versi TERKINI dari server, bukan versi lama yg browser dah
        // cache — kalau tidak, eksport boleh "bake" kod view.html yg LAPUK walaupun
        // index.html sendiri dah di-hard-refresh (punca fail eksport nampak macam fix
        // sebelum ni "tak jalan", sedangkan ia cuma tak pernah sampai ke fail eksport).
        let tpl = await fetch('view.html', { cache: 'no-store' }).then(r => {
            if (!r.ok) throw new Error('Could not fetch view.html template (HTTP ' + r.status + ')');
            return r.text();
        });

        // NOTA PENTING: tag penutup <script> literal TAK BOLEH ditulis terus dalam
        // fail ni (termasuk dalam komen macam ni pun) — parser HTML tutup tag
        // <script> ni serta-merta bila jumpa jujukan tu, tak kira pun ia sebenarnya
        // sebahagian dari string/regex JS. Guna slash di-escape (backslash sebelum
        // garis miring) supaya ia kekal sebagai teks biasa, bukan penutup tag.
        tpl = tpl.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"><\/script>\n', '');

        const libMatches = [...tpl.matchAll(/<script src="(https:\/\/[^"]+)"><\/script>/g)];
        for (const m of libMatches) {
            const libCode = await fetch(m[1]).then(r => r.text());
            // Escape sebarang tag penutup script YANG MUNGKIN wujud di dalam kod
            // library asal (cth. dalam string/komen) — sebab yang sama macam nota di
            // atas, ni fail HTML sebenar yang akan dibuka browser pelajar nanti.
            const safeLibCode = libCode.replace(/<\/script/gi, '<\\/script');
            // PENTING: guna FUNGSI sebagai hujah ke-2 .replace(), BUKAN string terus —
            // kalau string, JS layan "$" dalam kandungan (cth. "$1", "$&", "$`") sebagai
            // corak substitusi khas, bukan teks literal. Kod library minified yang kita
            // benam ni (fflate/three.js/cannon.js) HAMPIR PASTI ada nama pembolehubah
            // macam "$t"/"$0" dsb — kalau tak guna fungsi, "$" tu akan disalahtafsir dan
            // rosakkan output (inilah punca fail eksport jadi serabut bila diuji).
            tpl = tpl.replace(m[0], () => `<script>\n${safeLibCode}\n<\/script>`);
        }

        const embeddedRow = {
            name: activeProjectName || 'Project',
            data: { activeSceneId: projectJson.activeSceneId, scenes: projectJson.scenes, audios: projectJson.audios }
        };
        const safeEmbeddedJson = JSON.stringify(embeddedRow).replace(/<\/script/gi, '<\\/script');
        // Sebab sama — teks projek (nama objek/nota interaksi dsb, ditaip bebas oleh
        // pengguna) boleh secara tak sengaja ada "$" + nombor/aksara khas juga.
        tpl = tpl.replace(
            "const SUPABASE_URL = 'https://jmuraizgowqwmpmetupu.supabase.co';\n        const SUPABASE_ANON_KEY = 'sb_publishable_DZ8vjKrIJhXM34D7ddS6dw_nlIL18YD';\n        const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);",
            () => `window.__EMBEDDED_PROJECT__ = ${safeEmbeddedJson};`
        );

        const blob = new Blob([tpl], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (activeProjectName || 'project').replace(/[^a-z0-9_\- ]/gi, '_').trim() + '.html';
        document.body.appendChild(a);
        a.click();
        a.remove();

        setSaveStatusText('✅ Exported standalone HTML!');
    } catch (err) {
        console.error('Eksport HTML gagal:', err);
        alert('Failed to export project: ' + (err.message || err));
        setSaveStatusText('⚠️ Export failed!');
    } finally {
        btn.disabled = false;
    }
}
