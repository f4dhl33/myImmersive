// Eksport projek sebagai SATU fail *.html berdiri sendiri — diekstrak dari index.html.
// SEJARAH BUG (3 dah dibetulkan, lihat memori standalone_export_feature): $-replace
// corruption (".replace()" guna FUNGSI sebagai hujah ke-2, bukan string terus — lihat nota
// dalam exportProjectAsStandaloneHtml), texture race (semua asset di-encode base64 SEBELUM
// templat view.html diproses), stale cached view.html fetch (cache: 'no-store'). JANGAN ubah
// urutan/logik operasi ni tanpa ulang ujian penuh.
//
// Tujuan: pemilik projek boleh "bake" keseluruhan projek (scene/objek/interaksi + SEMUA
// asset: model 3D, imej, audio) jadi SATU fail .html, untuk letak di server sendiri — fail
// eksport TAK PERNAH panggil Supabase (projek ditanam terus sbg window.__EMBEDDED_PROJECT__),
// jimatkan bandwidth/kapasiti server asal projek ni bila byk pengguna.
//
// NOTA PENTING (2026-10-30, lepas view.html tukar ke ES modules + cannon-es): Three.js &
// cannon-es kini TIADA build UMD/global langsung (ESM sahaja) — tak boleh "bake" terus jadi
// <script> klasik macam cannon.js 0.6.2/Three.js r128 classic dulu. SEMUA fail modul —
// js/*.js PROJEK SENDIRI *dan* vendor (three.module.js, three/addons/* yg BENAR-BENAR
// diimport + rantaian import dalaman dia, cannon-es.js) — kini dibenam PENUH (teks sumber,
// bukan CDN) via discoverModuleGraph()/rewriteImportsToCanonical() di bawah, blob: URL
// dicipta masa fail eksport dibuka pengguna (MODULE_BOOTSTRAP_RUNTIME). Fail eksport 100%
// offline SEBENAR — sifar panggilan rangkaian tak kira jenis (CDN atau Supabase) bila dibuka,
// diuji dgn rangkaian browser DIMATIKAN SEPENUHNYA (bukan sekadar "tiada ralat fetch" pasif).
// CDN (jsdelivr) HANYA diperlukan SEKALI, di MESIN YANG EKSPORT (import.meta masa klik
// "Export HTML") — bukan di mesin yang buka fail eksport nanti.
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

// Selesaikan SATU specifier import (relatif ATAU bare) ke URL PENUH. Relatif ('./x.js',
// '../y/z.js', '/z.js') — URL biasa, relatif kepada URL fail yang mengandungi import tu
// sendiri (PENTING: bukan relatif kepada view.html — fail vendor cth
// three/addons/loaders/GLTFLoader.js import '../../../build/three.module.js' relatif kepada
// LOKASI DIA SENDIRI di CDN, bukan lokasi view.html; hantar `ownUrl` = URL fail tu sendiri
// supaya ni betul). Bare ('three', 'cannon-es', 'three/addons/...') — ikut peraturan
// importmap piawai: padanan TEPAT dulu, kalau tiada cari kunci berakhir '/' yang jadi PREFIX
// bagi specifier tu (padanan paling panjang menang, macam browser buat).
function resolveSpecifier(spec, ownUrl, importMap) {
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        return new URL(spec, ownUrl).href;
    }
    const imports = importMap.imports || {};
    if (Object.prototype.hasOwnProperty.call(imports, spec)) return imports[spec];
    let bestKey = null;
    for (const key of Object.keys(imports)) {
        if (key.endsWith('/') && spec.startsWith(key) && (!bestKey || key.length > bestKey.length)) {
            bestKey = key;
        }
    }
    if (bestKey) return imports[bestKey] + spec.slice(bestKey.length);
    throw new Error('Tak dapat selesaikan specifier import "' + spec + '" (bukan relatif, tiada padanan dlm importmap view.html) — eksport dibatalkan supaya tak hasilkan fail yg pecah senyap.');
}

// Cari SEMUA modul yang diimport — fail js/*.js PROJEK SENDIRI *dan* fail VENDOR
// (three.module.js, three/addons/* yang BENAR-BENAR diimport + rantaian import dalaman dia
// cth GLTFLoader -> 'three' sahaja, FBXLoader -> 'three' + fflate.module.js + NURBSCurve.js
// -> NURBSUtils.js, cannon-es.js) — bermula dari teks skrip modul view.html sendiri,
// mengikut SETIAP `from '...'` (relatif ATAU bare, lihat resolveSpecifier) secara rekursif,
// bukan senarai tetap ditulis tangan — kalau versi three.js akan datang tambah/ubah fail
// dalaman yang addon import, discovery ni automatik ikut, tak perlu kemaskini manual di sini.
// Pulangkan source MENTAH (belum ditulis semula) sebagai Map "laluan kanonik" -> teks sumber.
async function discoverModuleGraph(entrySrc, entryUrl, importMap) {
    const sources = new Map(); // kanonikal -> teks sumber mentah
    const urlOf = new Map();   // kanonikal -> URL penuh (utk selesaikan import anaknya)

    function canonicalOf(url) {
        return new URL(url).pathname.replace(/^\//, '');
    }

    async function visit(src, url) {
        const key = canonicalOf(url);
        if (sources.has(key)) return;
        sources.set(key, src);
        urlOf.set(key, url);

        const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
        for (const spec of specifiers) {
            const depUrl = resolveSpecifier(spec, url, importMap);
            const depKey = canonicalOf(depUrl);
            if (sources.has(depKey)) continue;
            const depSrc = await fetch(depUrl, { cache: 'no-store' }).then(r => {
                if (!r.ok) throw new Error('Gagal muat modul (' + depUrl + ') semasa eksport: HTTP ' + r.status);
                return r.text();
            });
            await visit(depSrc, depUrl);
        }
    }

    await visit(entrySrc, entryUrl);
    return { sources, urlOf, entryKey: canonicalOf(entryUrl) };
}

// Tulis semula SETIAP import (relatif ATAU bare — cth 'three', 'three/addons/controls/
// OrbitControls.js', 'cannon-es', './world.js') jadi laluan KANONIKAL (cth
// 'js/physics/world.js' ATAU 'npm/three@0.128.0/build/three.module.js') — SEKALI di
// export-time (deterministik, sama tak kira siapa import siapa). blob: URL SEBENAR hanya
// wujud lepas fail eksport ni dibuka pengguna nanti (lihat MODULE_BOOTSTRAP_RUNTIME di
// bawah) — pemisahan ni yang buat seluruh skim ni boleh dikira di export-time, bukan perlu
// "teka" UUID blob yang browser pengguna akan jana nanti.
function rewriteImportsToCanonical(src, ownUrl, importMap) {
    return src.replace(/from\s+'([^']+)'/g, (whole, spec) => {
        const depKey = new URL(resolveSpecifier(spec, ownUrl, importMap)).pathname.replace(/^\//, '');
        return `from '${depKey}'`;
    });
}

// Bootstrap RUNTIME (sama/statik setiap eksport — tiada data pengguna dibenam terus di sini,
// jadi TIADA risiko $-corruption macam embedding JSON/kod vendor di bawah) — jalan dalam
// BROWSER PENGGUNA bila fail eksport ni dibuka (bukan masa eksport dijana). Selesaikan setiap
// laluan kanonikal (lihat rewriteImportsToCanonical di atas) jadi blob: URL SEBENAR — tak
// boleh dikira lebih awal sebab URL.createObjectURL() jana UUID rawak setiap kali dipanggil,
// cuma wujud dalam sesi/tab pengguna yang membukanya. Topological: proses mana-mana modul
// yang SEMUA kebergantungannya dah ada blob: URL, ulang sampai semua selesai (grafik ni satu
// DAG — tiada circular dependency, lihat js/core/state.js & nota dalam setiap fail js/*.js).
const MODULE_BOOTSTRAP_RUNTIME = `(function () {
    var sources = window.__EXPORT_MODULE_SOURCES__;
    var entry = window.__EXPORT_ENTRY_SOURCE__;
    var blobUrls = {};
    var remaining = Object.keys(sources);
    var specifierRe = /from\\s+'([^']+)'/g;

    function localDepsOf(src) {
        var deps = [];
        var m;
        specifierRe.lastIndex = 0;
        while ((m = specifierRe.exec(src))) {
            if (Object.prototype.hasOwnProperty.call(sources, m[1])) deps.push(m[1]);
        }
        return deps;
    }

    function resolve(src) {
        return src.replace(specifierRe, function (whole, spec) {
            return Object.prototype.hasOwnProperty.call(blobUrls, spec) ? "from '" + blobUrls[spec] + "'" : whole;
        });
    }

    var guard = 0;
    while (remaining.length > 0 && guard < 1000) {
        guard++;
        var progressed = false;
        remaining = remaining.filter(function (key) {
            var deps = localDepsOf(sources[key]);
            var ready = deps.every(function (d) { return Object.prototype.hasOwnProperty.call(blobUrls, d); });
            if (!ready) return true;
            var blob = new Blob([resolve(sources[key])], { type: 'text/javascript' });
            blobUrls[key] = URL.createObjectURL(blob);
            progressed = true;
            return false;
        });
        if (!progressed) {
            console.error('[Export bootstrap] Tak boleh selesaikan modul tempatan (circular/hilang?):', remaining);
            break;
        }
    }

    var scriptEl = document.createElement('script');
    scriptEl.type = 'module';
    scriptEl.textContent = resolve(entry);
    document.body.appendChild(scriptEl);
})();`;

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

        // Keluarkan importmap SEBELUM apa-apa lain — perlukan kandungannya (JSON) utk
        // selesaikan specifier bare ('three', 'cannon-es', 'three/addons/...') semasa
        // discoverModuleGraph/rewriteImportsToCanonical di bawah, tapi fail eksport yang
        // terhasil TAK PERLUKAN tag ni langsung lepas tu (semua specifier, relatif ATAU bare,
        // dah ditulis semula jadi kunci kanonikal blob) — importmap browser TAK BOLEH
        // dipatch/diubah lepas modul mula jalan pun (spec ES: cuma boleh declare SEKALI,
        // sebelum skrip modul pertama), jadi "tukar ke blob URL selepas fakta" bukan pilihan
        // — buang terus tag ni lebih bersih & elak kekeliruan (tag import tak dipakai).
        const importMapMatch = tpl.match(/<script type="importmap">([\s\S]*?)<\/script>/);
        if (!importMapMatch) throw new Error('Templat view.html tiada <script type="importmap"> — format templat berubah?');
        const importMap = JSON.parse(importMapMatch[1]);
        tpl = tpl.replace(importMapMatch[0], () => '');

        // Benam SEMUA fail modul — js/*.js PROJEK SENDIRI (physics/occluder/grab/waypoint/
        // controller-visuals/xr-session/scene/state/ar-debug-hud) *dan* fail VENDOR
        // (three.module.js + three/addons/* yang benar-benar diimport + rantaian dalamannya,
        // cannon-es.js) — terus ke dalam fail eksport sbg teks sumber. Fail js/*.js SAMA
        // dipakai view.html/index.html secara langsung (bukan kopi berasingan), supaya
        // sebarang fix masa depan automatik terpakai pada eksport juga. Mesti jalan SELEPAS
        // substitution __EMBEDDED_PROJECT__ di atas — pada titik ni, teks skrip modul view.html
        // yang kita extract di bawah dah mengandungi window.__EMBEDDED_PROJECT__ (bukan lagi
        // kod client Supabase), jadi fail eksport yang terhasil tak pernah cuba panggil Supabase
        // langsung pun. CDN (jsdelivr) kena boleh dicapai DI SINI (mesin yang klik "Export
        // HTML") — fail yang terhasil lepas ni tak perlukan rangkaian langsung bila dibuka.
        setSaveStatusText('⏳ Exporting... bundling three.js/cannon-es/local modules (offline bootstrap, boleh ambil masa)');
        const moduleScriptMatch = tpl.match(/<script type="module">([\s\S]*?)<\/script>/);
        if (!moduleScriptMatch) throw new Error('Templat view.html tiada <script type="module"> — format templat berubah?');
        const entryUrl = new URL('view.html', window.location.href).href;
        const { sources, urlOf, entryKey } = await discoverModuleGraph(moduleScriptMatch[1], entryUrl, importMap);

        const moduleSourcesObj = {};
        for (const [key, src] of sources) {
            if (key === entryKey) continue; // entry (skrip modul utama) dikendalikan berasingan di bawah
            moduleSourcesObj[key] = rewriteImportsToCanonical(src, urlOf.get(key), importMap);
        }
        const entryRewritten = rewriteImportsToCanonical(moduleScriptMatch[1], entryUrl, importMap);

        // Sebab sama macam embeddedRow/libCode di atas — JANGAN guna string terus sbg hujah
        // ke-2 .replace(), kod sumber fail js/*.js (terutama comment Melayu yg ada "$" + nombor
        // tak sengaja) boleh disalahtafsir sbg corak substitusi.
        const safeModuleSourcesJson = JSON.stringify(moduleSourcesObj).replace(/<\/script/gi, '<\\/script');
        const safeEntrySourceJson = JSON.stringify(entryRewritten).replace(/<\/script/gi, '<\\/script');
        const bootstrapBlock =
            `<script>\nwindow.__EXPORT_MODULE_SOURCES__ = ${safeModuleSourcesJson};\nwindow.__EXPORT_ENTRY_SOURCE__ = ${safeEntrySourceJson};\n<\/script>\n` +
            `<script>\n${MODULE_BOOTSTRAP_RUNTIME}\n<\/script>`;
        tpl = tpl.replace(moduleScriptMatch[0], () => bootstrapBlock);

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
