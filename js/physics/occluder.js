// "INVISIBLE OCCLUDER" CUTOUT — hibrid stencil + semakan kedalaman kasar ikut kamera.
// Diekstrak dari index.html — logik dalaman BYTE-IDENTICAL dengan asal (jangan ubah
// tanpa ulang ujian box-math; lihat nota fix #1-#5 di bawah, 5 percubaan sebelum betul).
// DUA bahagian:
//  1) BENTUK potongan — stencil-buffer (silhouette cutter mengikut kamera,
//     TIADA kaitan dgn kedalaman sebenar permukaan — ini elak z-fighting
//     bila permukaan cutter rapat/bertindih dgn permukaan objek yg dipotong,
//     sesuatu yg PERNAH cuba diselesaikan dgn depth-buffer penuh [commit
//     5a929f8] tapi hasilnya tak stabil/"lari" sebab precision issue —
//     direvert balik ke stencil, commit c7fcd5d).
//  2) SAMA ADA potongan tu AKTIF untuk sesuatu objek — dikira SETIAP FRAME
//     (kamera boleh bergerak dlm Pratonton) ikut kedudukan KASAR (bukan
//     per-pixel) objek itu vs cutter sepanjang arah pandang kamera: kalau
//     cutter LEBIH JAUH dari kamera berbanding objek tu (objek di depan),
//     potongan terus TAK aktif utk objek tu (nampak penuh) — lihat
//     updateCutoutCameraGating().
// Objek ditanda isCutter jadi "alat potong" yang sentiasa invisible dalam
// Pratonton (colorWrite:false). SECARA DEFAULT, setiap objek lain dalam
// scene boleh berlubang di mana-mana bertindih dengan silhouette cutter tu
// (bila gating #2 aktif) — KECUALI objek ditanda excludeFromCutout (immune
// terhadap SEMUA cutter dalam scene). Hanya aktif semasa Pratonton/VR/AR;
// dalam mod Editing, objek cutter dipaparkan sebagai wireframe magenta
// supaya senang di-select/gerakkan (lihat refreshCutterEditVisuals()).
//
// getLoadedModelsList/getWaypointPathMeshes mesti GETTER (bukan array terus) sebab
// waypointPathMeshes di index.html di-*reassign* (bukan cuma push/splice) bila scene
// ditukar — snapshot sekali sahaja akan jadi stale dan terlepas waypoint baharu.
export function createOccluder({ THREE, getLoadedModelsList, getWaypointPathMeshes, getMainCamera }) {
    const cutterStencilMarkMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false, depthWrite: false, depthTest: false,
        stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp,
        side: THREE.DoubleSide
    });
    const cutterEditModeMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.6, depthTest: true
    });

    // Simpan material ASAL setiap sub-mesh SEKALI sahaja (lazy) supaya tukar-ganti
    // antara keadaan (asal / wireframe edit / stencil cutter / stencil cuttable) tak
    // pernah "lupa" rupa sebenar objek tu, tak kira berapa banyak kali ditukar.
    function ensureCutoutMaterialBackup(mesh) {
        if (mesh.userData._cutoutOrigMaterials) return;
        const map = new Map();
        mesh.traverse(node => { if (node.isMesh) map.set(node, node.material); });
        mesh.userData._cutoutOrigMaterials = map;
    }

    function applyCutterStencilMaterial(mesh) {
        ensureCutoutMaterialBackup(mesh);
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const orig = mesh.userData._cutoutOrigMaterials.get(node);
            const mats = Array.isArray(orig) ? orig : [orig];
            // Sub-mesh dekoratif yang SEMUA materialnya transparent (cth bunga api/kesan
            // separa-tak-nampak) sering ada geometri jauh lebih besar/lain bentuk dari
            // silhouette sebenar objek tu — jangan biar ia sumbang kepada stencil, atau
            // "lubang" yang terhasil tak sepadan dengan bentuk objek yang nampak.
            const allTransparent = mats.every(m => m && m.transparent === true);
            node.visible = !allTransparent;
            if (!allTransparent) node.material = cutterStencilMarkMaterial;
            node.renderOrder = -1000; // cutter kena render DULU supaya stencil sedia sebelum objek lain diuji
            node.frustumCulled = false;
        });
    }

    function applyCutterEditModeMaterial(mesh) {
        ensureCutoutMaterialBackup(mesh);
        mesh.traverse(node => {
            if (!node.isMesh) return;
            node.visible = true;
            node.material = cutterEditModeMaterial;
            node.renderOrder = 0;
        });
    }

    // Sediakan (sekali sahaja, lazy) versi KLON material objek boleh-potong yang
    // diuji terhadap stencil cutter — TAPI tak terus di-"pakai" di sini. Material
    // sebenar (klon stencil vs asal) ditukar SETIAP FRAME oleh
    // updateCutoutCameraGating() ikut gating kedalaman kasar #2 di atas.
    function ensureCutoutStencilMaterials(mesh) {
        if (mesh.userData._cutoutStencilMaterials) return;
        ensureCutoutMaterialBackup(mesh);
        const map = new Map();
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const orig = mesh.userData._cutoutOrigMaterials.get(node);
            const wasArray = Array.isArray(orig);
            const mats = wasArray ? orig : [orig];
            const patched = mats.map(m => {
                const clone = m.clone();
                clone.stencilWrite = true;
                clone.stencilFunc = THREE.NotEqualStencilFunc;
                clone.stencilRef = 1;
                clone.stencilFuncMask = 0xff;
                clone.stencilFail = THREE.KeepStencilOp;
                clone.stencilZFail = THREE.KeepStencilOp;
                clone.stencilZPass = THREE.KeepStencilOp;
                return clone;
            });
            map.set(node, wasArray ? patched : patched[0]);
        });
        mesh.userData._cutoutStencilMaterials = map;
    }

    function setCuttableMaterial(mesh, shouldCut) {
        ensureCutoutStencilMaterials(mesh);
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const mats = shouldCut ? mesh.userData._cutoutStencilMaterials : mesh.userData._cutoutOrigMaterials;
            const m = mats.get(node);
            if (m !== undefined) node.material = m;
            node.renderOrder = 0;
        });
    }

    function restoreOriginalMaterial(mesh) {
        if (!mesh.userData._cutoutOrigMaterials) return;
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const orig = mesh.userData._cutoutOrigMaterials.get(node);
            if (orig !== undefined) node.material = orig;
            node.visible = true;
            node.renderOrder = 0;
        });
    }

    // Dipanggil setiap kali buildPhysicsWorldFromScene() jalan (masuk Pratonton/VR/AR,
    // atau scene ditukar semasa Pratonton aktif) — kesan cutout SEBENAR cuma wujud
    // di sini. Kalau tiada objek cutter langsung dalam scene, semua objek dipulihkan
    // ke material asal (tiada overhead stencil langsung). Objek boleh-potong tak
    // terus ditetapkan material cut di sini — updateCutoutCameraGating() (dipanggil
    // sekali di bawah, dan setiap frame dlm animate()) yang tentukan sama ada
    // potongan aktif utk setiap objek, ikut kedudukan kamera.
    function applyCutoutEffect() {
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        const cutters = loadedModelsList.filter(m => m.userData.isCutter);
        if (cutters.length === 0) {
            loadedModelsList.forEach(m => restoreOriginalMaterial(m));
            waypointPathMeshes.forEach(m => restoreOriginalMaterial(m));
            return;
        }
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return;
            if (mesh.userData.isCutter) {
                applyCutterStencilMaterial(mesh);
            } else if (mesh.userData.excludeFromCutout) {
                restoreOriginalMaterial(mesh);
            }
        });
        // Segmen laluan waypoint (bukan senarai loadedModelsList) ikut flag
        // excludeFromCutout yang sama seperti objek biasa — lihat rebuildWaypointPath().
        waypointPathMeshes.forEach(mesh => {
            if (mesh.userData.excludeFromCutout) restoreOriginalMaterial(mesh);
        });
        updateCutoutCameraGating();
    }

    // Dipanggil SETIAP FRAME semasa Pratonton (lihat animate()) selagi ada sekurang-
    // kurangnya satu objek cutter dlm scene. Kedudukan kamera berubah tiap frame
    // (orbit/gerak dlm Pratonton), jadi gating ni kena dikira semula tiap frame —
    // bukan sekali sahaja semasa applyCutoutEffect(). Guna kedudukan KASAR (bounding
    // box), bukan per-pixel, supaya elak isu precision/z-fighting yang punca hasil
    // "lari"/tak tentu bila dicuba dgn depth-buffer penuh (5a929f8).
    //
    // NOTA (fix #1, selepas laporan "pusing sikit, tiba2 potong byk/tak potong
    // langsung walaupun nampak bertindih"): mulanya guna titik PIVOT objek
    // (getWorldPosition()) utk kira depth. Cutter dlm app ni selalunya kotak PANJANG
    // yg cuma bertindih kat SEBAHAGIAN hujungnya sahaja dgn target — pivot yg jauh dari
    // zon pertindihan sebenar buat anggaran depth sangat sensitif pada sudut kamera.
    // Fix #1: guna titik PALING HAMPIR pada bounding box CUTTER ke *pusat* target.
    //
    // NOTA (fix #2 — fix #1 tak cukup): fix #1 cuma betulkan SATU hala (bila CUTTER yg
    // panjang). Pengguna uji kes SEBALIKNYA — TARGET yg panjang, cutter lebih pendek,
    // bertindih kat satu hujung target sahaja — isu sama berulang sebab titik rujukan
    // TARGET masih guna *pusat* box dia. Fix #2 cuba: kira titik paling hampir pada
    // KEDUA-DUA box, SALING MENGHALA satu sama lain (clampPoint pusat satu box ke box
    // satu lagi) — TAPI ni rosak dgn cara lain: bila dua box bertindih DALAM/saiz hampir
    // sama (cth kiub duplicate — cutter & target same size, overlap penuh), pusat
    // SATU box dah berada DALAM box SATU LAGI, jadi clampPoint pulangkan titik tu
    // TANPA diubah — "titik cutter" jadi SAMA PERSIS dgn pusat target & sebaliknya,
    // songsangkan perbandingan (compare target-depth vs cutter-depth, bukan sebaliknya)
    // — punca target "langsung tak terpotong" walaupun bertindih penuh dgn cutter.
    //
    // Fix #3 cuba lagi: titik rujukan dari PUSAT OBJEK SENDIRI diclamp ke kawasan
    // pertindihan (Box3.intersect), elak songsang fix #2. TAPI ni pun ada kelemahan:
    // bila kawasan pertindihan tu NIPIS/kecil (dua box cuma bersentuh sikit kat
    // penjuru/tepi, cth objek digerakkan ke hujung), clamp kedua-dua pusat (yg
    // mungkin jauh berbeza depth asalnya) ke kawasan nipis tu buat dua titik jadi
    // HAMPIR SAMA kedudukan — tak lagi mewakili depth SEBENAR tiap objek, jadi
    // keputusan potong jadi salah/tak konsisten bila objek digerakkan (laporan:
    // "letak bahagian depan macam ni, die terpotong pulak, sepatutnya tak").
    //
    // Fix #4 — tukar pendekatan SEPENUHNYA: SEMUA fix #1-#3 di atas kira "depth" guna
    // unjuran titik ke ARAH PANDANG kamera (camDir, dot-product) — ini yg sentiasa
    // punca ketidakstabilan bawah putaran (unjuran dot-product sensitif pada sudut),
    // tak kira macam mana titik rujukan dipilih. Fix #4 buang arah pandang terus:
    // guna JARAK LURUS dari kamera ke titik TERHAMPIR pada bounding box SETIAP objek
    // (Box3.clampPoint(camPos) — titik pada box tu sendiri yg paling dekat dgn
    // kedudukan kamera). Nilai ni HANYA bergantung pada kedudukan kamera & box objek
    // itu sendiri — LANGSUNG TAK bergantung pada arah pandang/putaran kamera, jadi
    // pusing kamera di tempat (tanpa bergerak) tak akan ubah keputusan potong
    // LANGSUNG (immune secara matematik, bukan cuma "stabil" secara empirik macam
    // fix #1-#3). Juga tiada clamp SATU box ke box LAIN (setiap titik dikira
    // berasingan drpd box sendiri + camPos sahaja), jadi tiada risiko "collapse"/
    // songsang macam fix #2/#3 pun — immune drpd DUA kategori bug yg dah berulang.
    const _cutoutGatingTmpA = new THREE.Vector3();
    const _cutoutGatingTmpBox = new THREE.Box3();
    function updateCutoutCameraGating() {
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        const mainCamera = getMainCamera();
        const cutters = loadedModelsList.filter(m => m.userData.isCutter);
        if (cutters.length === 0) return;
        mainCamera.getWorldPosition(_cutoutGatingTmpA);
        const camPos = _cutoutGatingTmpA;

        const cutterBoxes = cutters.map(c => new THREE.Box3().setFromObject(c));

        const gateMesh = (mesh) => {
            const meshBox = _cutoutGatingTmpBox.setFromObject(mesh);
            const meshCenter = meshBox.getCenter(new THREE.Vector3());
            const meshDist = camPos.distanceTo(meshBox.clampPoint(camPos, new THREE.Vector3()));

            // Pilih cutter PALING RELEVAN (jurang terkecil ke target) sebagai cutter
            // yg berkaitan dgn objek ni (andaian sedia ada: satu cutter dominan je
            // pada satu masa) — ni cuma utk PILIH cutter, jarak ke kamera dikira
            // berasingan selepas ni, bukan guna titik pilihan ni utk depth.
            let chosenCutterBox = cutterBoxes[0];
            let bestGap = Infinity;
            cutterBoxes.forEach(box => {
                const gap = box.clampPoint(meshCenter, new THREE.Vector3()).distanceTo(meshCenter);
                if (gap < bestGap) { bestGap = gap; chosenCutterBox = box; }
            });

            // FIX #5 (laporan "bulldozer duduk ATAS cut tool, tapi terpotong jugak"):
            // Fix #4 di atas guna titik TERHAMPIR SELURUH box objek/cutter ke kamera
            // sbg "depth" — DIBUKTIKAN guna ujian box matematik berasingan (bukan teka)
            // ni PECAH bila objek (cth bulldozer) duduk/berehat ATAS cutter yg lebih
            // besar/dalam (cth platform/tangga): titik terhampir CUTTER (selalunya
            // penjuru bawah-depan platform yg luas) selalu lebih dekat drpd titik
            // terhampir objek kecil yg duduk atas permukaan atasnya — walhal secara
            // fizikal objek tu JELAS "di atas" (luar) cutter, bukan "di dalam"/belakang
            // ia. Diuji: SALAH (terpotong) pada 7 drpd 8 sudut kamera diuji (hanya
            // betul tepat-depan) — bukan setakat jarang/edge-case, ROSAK HAMPIR SEMUA
            // SUDUT. Objek yang pusat Y dia >= bahagian ATAS cutter (duduk/berehat atas
            // permukaan atasnya, bukan tenggelam/berada dlm julat Y cutter tu) TAK
            // PERNAH patut dipotong cutter ni — tak kira sudut kamera langsung (immune
            // sudut by construction, sama prinsip fix #4). Guard ni TAMBAHAN di atas
            // gating jarak kamera sedia ada — kes dinding/cutaway asal (objek dlm
            // julat Y sama dgn cutter, cth bilik di belakang dinding) TAK terjejas
            // langsung (meshCenter.y dia berada DALAM julat Y cutter, bukan >= max.y,
            // jadi terus jatuh ke gating jarak kamera sedia ada macam biasa).
            if (meshCenter.y >= chosenCutterBox.max.y) {
                setCuttableMaterial(mesh, false);
                return;
            }

            const cutterDist = camPos.distanceTo(chosenCutterBox.clampPoint(camPos, new THREE.Vector3()));
            setCuttableMaterial(mesh, cutterDist < meshDist);
        };

        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return;
            if (mesh.userData.isCutter || mesh.userData.excludeFromCutout) return;
            gateMesh(mesh);
        });

        // Segmen laluan waypoint boleh dipilih sama ada immune (excludeFromCutout,
        // ikut flag objek waypoint yang bersambung dengannya) atau ikut gating jarak
        // kamera yang sama macam objek biasa.
        waypointPathMeshes.forEach(mesh => {
            if (mesh.userData.excludeFromCutout) return;
            gateMesh(mesh);
        });
    }

    // Dipanggil bila keluar Pratonton (teardownPhysicsWorld) — buang kesan stencil
    // sepenuhnya, dan pulihkan objek cutter ke paparan kosmetik mod Editing (wireframe).
    function clearCutoutEffect() {
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.isCutter) {
                applyCutterEditModeMaterial(mesh);
            } else {
                restoreOriginalMaterial(mesh);
            }
        });
        waypointPathMeshes.forEach(mesh => restoreOriginalMaterial(mesh));
    }

    // Dipanggil dalam mod Editing (bukan Pratonton) setiap kali senarai objek/flag
    // isCutter mungkin berubah (scene baru dimuat, togol checkbox, duplicate, dll) —
    // pastikan objek cutter SENTIASA nampak sebagai wireframe magenta semasa editing.
    // `isPreviewMode` diterima sebagai parameter (bukan baca state editor terus) —
    // caller (index.html) sentiasa tahu nilai semasa pada titik panggilan.
    function refreshCutterEditVisuals(isPreviewMode) {
        if (isPreviewMode) return;
        const loadedModelsList = getLoadedModelsList();
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.isCutter) applyCutterEditModeMaterial(mesh);
            else restoreOriginalMaterial(mesh);
        });
    }

    // restoreOriginalMaterial diexport juga (selain dipakai dalaman) — view.html perlukan
    // ia sendiri untuk teardownPhysicsWorld versi viewer (tiada mod Editing, jadi "clear"
    // cutout di situ cuma pulihkan material asal terus, bukan tukar ke wireframe magenta
    // edit mode macam clearCutoutEffect() editor di atas).
    return { applyCutoutEffect, updateCutoutCameraGating, clearCutoutEffect, refreshCutterEditVisuals, restoreOriginalMaterial };
}
