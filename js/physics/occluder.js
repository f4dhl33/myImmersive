// "INVISIBLE OCCLUDER" CUTOUT — potongan PER-PIKSEL dlm shader (FIX #8, 2026-11-23).
//
// Peraturan (dinyatakan pengguna): piksel objek dipotong HANYA bila kamera → cutter →
// piksel (cutter menghalang pandangan ke piksel tu); JANGAN bila kamera → piksel → cutter.
// Setiap material objek boleh-potong disuntik kod shader (onBeforeCompile) yg, utk
// SETIAP PIKSEL, tembak sinar dari kamera ke kedudukan dunia piksel tu dlm ruang
// TEMPATAN setiap cutter (kotak/sfera/silinder ikut primitif) — kalau sinar MASUK
// cutter sebelum sampai piksel → `discard`. Objek ditanda isCutter sendiri sentiasa
// invisible dlm Pratonton; excludeFromCutout immune terhadap SEMUA cutter. Mod Editing:
// cutter dipaparkan wireframe magenta (refreshCutterEditVisuals()).
//
// SEJARAH (kenapa bukan cara lain — JANGAN kembali ke mana-mana ni):
//  - Stencil silhouette tulen (e2d786e): potong objek di DEPAN cutter juga.
//  - Depth-buffer penuh (5a929f8): z-fighting bila permukaan cutter rapat dgn objek
//    (cutaway) — perbandingan kedalaman GPU antara permukaan hampir bertindih tak stabil.
//    Kaedah sekarang ANALITIK (persilangan sinar-kotak dlm float, dgn toleransi CUT_BIAS),
//    tiada depth buffer, jadi tiada z-fighting.
//  - Stencil + "gating" SELURUH OBJEK sekali hidup/mati (e5df727 → fix #1-#7: pivot,
//    titik-terhampir, clampPoint saling, kawasan-silang, jarak-kamera, "duduk atas",
//    undian garis pandangan + OBB). Setiap formula ada kes tepi baharu, dan SEMUANYA
//    "pop": bila keputusan bertukar pd satu sudut, semua piksel bertindih silhouette
//    hilang serentak (laporan pengguna: "bila capai tahap tertentu baru terpotong,
//    sepatutnya seamless"). Keputusan per-piksel tiada titik tukar langsung.
//  - Fix #8 juga betulkan kes yg fix #5/#6/#7 cuba tampal: objek ATAS cutter (bulldozer
//    Tester) — badan di atas permukaan cutter utuh, cuma bahagian yg TENGGELAM dlm cutter
//    dipotong; cutter DIPUTAR guna ruang tempatan sendiri (bukan AABB dunia yg kembang).
//
// DUA LALUAN BENTUK CUTTER:
//  - Primitif kotak/sfera/silinder/satah → ANALITIK (persilangan sinar dlm shader, tepat
//    & murah). Maksimum CUT_MAX serentak.
//  - Cutter lain (model GLB, gambar, teks) → DEPTH TEXTURE: proksi berkongsi geometri
//    sebenar cutter dilukis ke depth texture setiap frame (renderCutterDepth()) dgn
//    kamera semasa — dlm VR three.js lukis KEDUA-DUA mata ke texture yg sama (viewport
//    ikut framebuffer XR), jadi gl_FragCoord sepadan. Shader banding jarak linear piksel
//    vs permukaan depan cutter (toleransi CUT_BIAS — bukan perbandingan depth buffer
//    terus macam 5a929f8, jadi tiada z-fighting). Bahagian LUTSINAR gambar/teks
//    diabaikan (alphaTest). Bentuk ANIMASI rangka (skinned) cutter guna pose rehat.
// Material bukan "built-in" three.js (ShaderMaterial tersuai) tak disuntik → tak dipotong.
//
// getLoadedModelsList/getWaypointPathMeshes mesti GETTER (bukan array terus) sebab
// waypointPathMeshes di index.html di-*reassign* (bukan cuma push/splice) bila scene
// ditukar — snapshot sekali sahaja akan jadi stale dan terlepas waypoint baharu.
const CUT_MAX = 8;
const CUT_BIAS = 0.002; // meter — piksel TEPAT pd permukaan cutter dikira "depan" (stabil, tiada kelip)
const SHAPE_BOX = 0, SHAPE_SPHERE = 1, SHAPE_CYLINDER = 2;
const ANALYTIC_PRIM_TYPES = ['box', 'sphere', 'cylinder', 'plane'];

// getRenderer/getMainCamera hanya utk laluan depth texture (cutter bukan primitif) —
// laluan analitik baca kamera terus dlm shader (cameraPosition, betul per mata dlm VR).
export function createOccluder({ THREE, getLoadedModelsList, getWaypointPathMeshes, getMainCamera, getRenderer }) {
    // Cutter dlm Pratonton: tak lukis apa-apa (colorWrite/depthWrite off) — kekal
    // node.visible=true supaya raycast/interaksi pd cutter tak berubah drpd sebelum ni.
    const cutterHiddenMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide
    });
    const cutterEditModeMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.6, depthTest: true
    });

    // Uniform DIKONGSI semua material boleh-potong (rujukan objek sama) — kemas kini
    // sekali setiap frame dlm updateCutoutCameraGating(), terus sampai ke semua shader.
    const cutUniforms = {
        uCutCount: { value: 0 },
        uCutInv: { value: Array.from({ length: CUT_MAX }, () => new THREE.Matrix4()) },
        uCutMin: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector3()) },
        uCutMax: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector3()) },
        uCutShape: { value: new Array(CUT_MAX).fill(SHAPE_BOX) },
        uCutDepthOn: { value: 0 },
        uCutDepthTex: { value: null },
        uCutDepthSize: { value: new THREE.Vector2(1, 1) },
        uCutNear: { value: 0.1 },
        uCutFar: { value: 1000 }
    };

    const CUT_VERTEX_DECL = 'varying vec3 vCutWorldPos;\n';
    // `transformed` dah termasuk skinning/morph (dikira sebelum project_vertex).
    const CUT_VERTEX_BODY = '\nvCutWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n';
    const CUT_FRAGMENT_DECL = `
varying vec3 vCutWorldPos;
uniform int uCutCount;
uniform mat4 uCutInv[${CUT_MAX}];
uniform vec3 uCutMin[${CUT_MAX}];
uniform vec3 uCutMax[${CUT_MAX}];
uniform int uCutShape[${CUT_MAX}];
uniform int uCutDepthOn;
uniform sampler2D uCutDepthTex;
uniform vec2 uCutDepthSize;
uniform float uCutNear;
uniform float uCutFar;
`;
    // Segmen sinar dlm ruang tempatan cutter: ro + rd*t, t=0 di kamera, t=1 di piksel
    // (transform afin kekalkan parameter t, jadi t sama dlm ruang dunia & tempatan).
    // [tn, tf] = julat t sinar berada DLM bentuk cutter.
    const CUT_FRAGMENT_BODY = `
{
    float cutBiasT = ${CUT_BIAS.toFixed(4)} / max(length(vCutWorldPos - cameraPosition), 1e-4);
    for (int i = 0; i < ${CUT_MAX}; i++) {
        if (i >= uCutCount) break;
        vec3 ro = (uCutInv[i] * vec4(cameraPosition, 1.0)).xyz;
        vec3 rd = (uCutInv[i] * vec4(vCutWorldPos, 1.0)).xyz - ro;
        vec3 bmin = uCutMin[i];
        vec3 bmax = uCutMax[i];
        float tn = 1e9;
        float tf = -1e9;
        if (uCutShape[i] == ${SHAPE_SPHERE}) {
            vec3 c = 0.5 * (bmin + bmax);
            float r = 0.5 * (bmax.x - bmin.x);
            vec3 oc = ro - c;
            float a = dot(rd, rd);
            float b = dot(oc, rd);
            float cc = dot(oc, oc) - r * r;
            float disc = b * b - a * cc;
            if (disc >= 0.0 && a > 0.0) {
                float sq = sqrt(disc);
                tn = (-b - sq) / a;
                tf = (-b + sq) / a;
            }
        } else {
            vec3 sgn = step(vec3(0.0), rd) * 2.0 - 1.0;
            vec3 invRd = 1.0 / (sgn * max(abs(rd), vec3(1e-8)));
            vec3 t1 = (bmin - ro) * invRd;
            vec3 t2 = (bmax - ro) * invRd;
            vec3 tlo = min(t1, t2);
            vec3 thi = max(t1, t2);
            if (uCutShape[i] == ${SHAPE_CYLINDER}) {
                // Silinder paksi-Y: slab Y + bulatan dlm satah XZ.
                tn = tlo.y;
                tf = thi.y;
                vec2 c2 = 0.5 * (bmin.xz + bmax.xz);
                float r = 0.5 * (bmax.x - bmin.x);
                vec2 o2 = ro.xz - c2;
                vec2 d2 = rd.xz;
                float a = dot(d2, d2);
                float b = dot(o2, d2);
                float cc = dot(o2, o2) - r * r;
                if (a < 1e-12) {
                    if (cc > 0.0) { tn = 1e9; tf = -1e9; }
                } else {
                    float disc = b * b - a * cc;
                    if (disc < 0.0) { tn = 1e9; tf = -1e9; }
                    else {
                        float sq = sqrt(disc);
                        tn = max(tn, (-b - sq) / a);
                        tf = min(tf, (-b + sq) / a);
                    }
                }
            } else {
                tn = max(max(tlo.x, tlo.y), tlo.z);
                tf = min(min(thi.x, thi.y), thi.z);
            }
        }
        if (tf >= max(tn, 0.0)) {
            // Kamera di luar cutter: potong bila sinar MASUK cutter sebelum sampai piksel
            // (termasuk piksel DLM cutter — bahagian tenggelam/cutaway).
            // Kamera DLM cutter: cuma potong piksel yg juga berada dlm cutter.
            if (tn >= 0.0) {
                if (tn < 1.0 - cutBiasT) discard;
            } else {
                if (tf > 1.0 + cutBiasT) discard;
            }
        }
    }
    if (uCutDepthOn == 1) {
        // Kedalaman perspektif [0,1] → jarak linear dari kamera: n*f / (f - d*(f-n)).
        float cutD = texture2D(uCutDepthTex, gl_FragCoord.xy / uCutDepthSize).x;
        if (cutD < 1.0) {
            float cutDist = (uCutNear * uCutFar) / (uCutFar - cutD * (uCutFar - uCutNear));
            float fragDist = (uCutNear * uCutFar) / (uCutFar - gl_FragCoord.z * (uCutFar - uCutNear));
            if (fragDist > cutDist + ${CUT_BIAS.toFixed(4)}) discard;
        }
    }
}
`;

    function injectCutout(material) {
        // RANTAI onBeforeCompile sedia ada — sesetengah material GLB (cth specular-
        // glossiness GLTFLoader r128) bergantung pd onBeforeCompile sendiri utk tambah
        // uniform. Ditimpa = "Cannot set properties of undefined (setting 'value')" dlm
        // refreshUniformsCommon (diuji pd model jentolak projek Tester).
        const prevOnBeforeCompile = material.onBeforeCompile;
        // Kunci cache mesti ikut kod onBeforeCompile ASAL juga — kalau sama utk semua
        // material, three.js kongsi program shader antara material jenis-sama tapi
        // uniform berlainan (punca ralat yg sama).
        const prevKey = 'webxr-cutout-v1|' + prevOnBeforeCompile.toString();
        material.onBeforeCompile = (shader, renderer) => {
            prevOnBeforeCompile.call(material, shader, renderer);
            Object.assign(shader.uniforms, cutUniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\n' + CUT_VERTEX_DECL)
                .replace('#include <project_vertex>', '#include <project_vertex>' + CUT_VERTEX_BODY);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\n' + CUT_FRAGMENT_DECL)
                .replace('#include <clipping_planes_fragment>', CUT_FRAGMENT_BODY + '#include <clipping_planes_fragment>');
        };
        // Program shader berasingan drpd material asal yg sama jenis (tanpa suntikan).
        material.customProgramCacheKey = () => prevKey;
        return material;
    }

    // Simpan material ASAL setiap sub-mesh SEKALI sahaja (lazy) supaya tukar-ganti
    // antara keadaan (asal / wireframe edit / tersembunyi cutter / boleh-potong) tak
    // pernah "lupa" rupa sebenar objek tu, tak kira berapa banyak kali ditukar.
    function ensureCutoutMaterialBackup(mesh) {
        if (mesh.userData._cutoutOrigMaterials) return;
        const map = new Map();
        mesh.traverse(node => { if (node.isMesh) map.set(node, node.material); });
        mesh.userData._cutoutOrigMaterials = map;
    }

    function applyCutterHiddenMaterial(mesh) {
        ensureCutoutMaterialBackup(mesh);
        mesh.traverse(node => {
            if (!node.isMesh) return;
            node.material = cutterHiddenMaterial;
            node.renderOrder = 0;
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

    // KLON material asal (sekali sahaja, lazy) dgn suntikan shader potongan. Klon kongsi
    // texture yg sama dgn asal (scroll waypoint, video dsb kekal jalan).
    function ensureCutoutMaterials(mesh) {
        if (mesh.userData._cutoutShaderMaterials) return;
        ensureCutoutMaterialBackup(mesh);
        const map = new Map();
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const orig = mesh.userData._cutoutOrigMaterials.get(node);
            const wasArray = Array.isArray(orig);
            const patched = (wasArray ? orig : [orig]).map(m => m ? injectCutout(m.clone()) : m);
            map.set(node, wasArray ? patched : patched[0]);
        });
        mesh.userData._cutoutShaderMaterials = map;
    }

    function setCuttableMaterial(mesh, shouldCut) {
        if (shouldCut) ensureCutoutMaterials(mesh);
        else ensureCutoutMaterialBackup(mesh);
        const mats = shouldCut ? mesh.userData._cutoutShaderMaterials : mesh.userData._cutoutOrigMaterials;
        mesh.traverse(node => {
            if (!node.isMesh) return;
            const m = mats.get(node);
            if (m !== undefined && node.material !== m) node.material = m;
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

    // Kotak cutter dlm ruang TEMPATAN sendiri (gabungan kotak geometri anak-anaknya) +
    // matriks songsang — cutter diputar/diskala tak seragam dikendalikan tepat.
    const _nodeMat = new THREE.Matrix4();
    const _tmpBox = new THREE.Box3();
    const _localBox = new THREE.Box3();
    function writeCutterUniforms(cutter, i) {
        cutter.updateMatrixWorld(true);
        const inv = cutUniforms.uCutInv.value[i].copy(cutter.matrixWorld).invert();
        _localBox.makeEmpty();
        cutter.traverse(node => {
            if (!node.isMesh || !node.geometry) return;
            if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
            _nodeMat.multiplyMatrices(inv, node.matrixWorld);
            _localBox.union(_tmpBox.copy(node.geometry.boundingBox).applyMatrix4(_nodeMat));
        });
        if (_localBox.isEmpty()) _localBox.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
        cutUniforms.uCutMin.value[i].copy(_localBox.min);
        cutUniforms.uCutMax.value[i].copy(_localBox.max);
        const p = cutter.userData.primType;
        cutUniforms.uCutShape.value[i] = p === 'sphere' ? SHAPE_SPHERE : p === 'cylinder' ? SHAPE_CYLINDER : SHAPE_BOX;
    }

    // ---- LALUAN DEPTH TEXTURE (cutter bukan primitif) ----
    const isAnalyticCutter = (c) => ANALYTIC_PRIM_TYPES.includes(c.userData.primType);
    const depthScene = new THREE.Scene();
    depthScene.autoUpdate = true;
    const proxyByNode = new Map();      // node mesh cutter → proksi dlm depthScene
    const proxyMatByOrig = new Map();   // material asal → material proksi (depth sahaja)
    let depthTarget = null;
    const _depthSize = new THREE.Vector2();

    function proxyMaterialFor(orig) {
        const key = orig || cutterHiddenMaterial;
        let m = proxyMatByOrig.get(key);
        if (m) return m;
        // Bahagian lutsinar gambar/teks (map dgn alpha) tak patut memotong — alphaTest.
        const useAlpha = !!(orig && orig.map && orig.transparent);
        m = new THREE.MeshBasicMaterial({
            colorWrite: false,
            map: useAlpha ? orig.map : null,
            alphaTest: useAlpha ? 0.5 : 0,
            // Ikut sisi material asal: model tertutup (FrontSide) — kamera DLM cutter tak
            // nampak muka depan → tak potong; gambar/teks (DoubleSide) potong dari dua arah.
            side: orig ? orig.side : THREE.FrontSide
        });
        proxyMatByOrig.set(key, m);
        return m;
    }

    function syncDepthProxies(meshCutters) {
        const active = new Set();
        meshCutters.forEach(cutter => {
            const origMap = cutter.userData._cutoutOrigMaterials;
            cutter.traverse(node => {
                if (!node.isMesh || !node.geometry || node.visible === false) return;
                let proxy = proxyByNode.get(node);
                if (!proxy) {
                    const orig = origMap ? origMap.get(node) : node.material;
                    proxy = new THREE.Mesh(node.geometry, proxyMaterialFor(Array.isArray(orig) ? orig[0] : orig));
                    proxy.matrixAutoUpdate = false;
                    proxy.frustumCulled = false;
                    proxyByNode.set(node, proxy);
                }
                proxy.matrix.copy(node.matrixWorld);
                proxy.matrixWorldNeedsUpdate = true;
                active.add(proxy);
            });
        });
        depthScene.children.slice().forEach(p => { if (!active.has(p)) depthScene.remove(p); });
        active.forEach(p => { if (p.parent !== depthScene) depthScene.add(p); });
        // Buang cache nod yg dah tiada (objek dipadam/scene ditukar) — elak bocor memori.
        proxyByNode.forEach((p, node) => { if (!active.has(p) && !node.parent) proxyByNode.delete(node); });
        return active.size > 0;
    }

    function renderCutterDepth(meshCutters) {
        const renderer = getRenderer && getRenderer();
        const camera = getMainCamera && getMainCamera();
        if (!renderer || !camera || !syncDepthProxies(meshCutters)) {
            cutUniforms.uCutDepthOn.value = 0;
            return;
        }
        // Saiz MESTI sama dgn framebuffer sebenar (gl_FragCoord dlm shader): dlm XR ia
        // framebuffer layer sesi (kedua-dua mata), bukan saiz kanvas.
        const session = renderer.xr && renderer.xr.isPresenting ? renderer.xr.getSession() : null;
        const layer = session && session.renderState && session.renderState.baseLayer;
        if (layer) _depthSize.set(layer.framebufferWidth, layer.framebufferHeight);
        else renderer.getDrawingBufferSize(_depthSize);
        const w = Math.max(1, Math.floor(_depthSize.x)), h = Math.max(1, Math.floor(_depthSize.y));
        if (!depthTarget || depthTarget.width !== w || depthTarget.height !== h) {
            if (depthTarget) { depthTarget.depthTexture.dispose(); depthTarget.dispose(); }
            const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
            depthTexture.minFilter = THREE.NearestFilter;
            depthTexture.magFilter = THREE.NearestFilter;
            depthTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false, depthTexture });
        }
        // Kamera utama anak cameraRig (bukan dlm depthScene) — render() tak kemas kini
        // matrixWorld dia, jadi kemas kini sendiri (OrbitControls dah ubah posisi frame ni).
        if (!session) camera.updateMatrixWorld(true);
        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = true;
        renderer.setRenderTarget(depthTarget);
        renderer.render(depthScene, camera);
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;

        cutUniforms.uCutDepthTex.value = depthTarget.depthTexture;
        cutUniforms.uCutDepthSize.value.set(w, h);
        cutUniforms.uCutNear.value = camera.near;
        cutUniforms.uCutFar.value = camera.far;
        cutUniforms.uCutDepthOn.value = 1;
    }

    let warnedTooManyCutters = false;

    // Dipanggil setiap kali buildPhysicsWorldFromScene() jalan (masuk Pratonton/VR/AR,
    // atau scene ditukar semasa Pratonton aktif). Tiada cutter langsung → semua objek
    // kembali ke material asal (tiada kos shader tambahan).
    function applyCutoutEffect() {
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        const cutters = loadedModelsList.filter(m => m.userData.isCutter);
        if (cutters.length === 0) {
            cutUniforms.uCutCount.value = 0;
            cutUniforms.uCutDepthOn.value = 0;
            loadedModelsList.forEach(m => restoreOriginalMaterial(m));
            waypointPathMeshes.forEach(m => restoreOriginalMaterial(m));
            return;
        }
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return;
            if (mesh.userData.isCutter) applyCutterHiddenMaterial(mesh);
            else if (mesh.userData.excludeFromCutout) restoreOriginalMaterial(mesh);
        });
        waypointPathMeshes.forEach(mesh => {
            if (mesh.userData.excludeFromCutout) restoreOriginalMaterial(mesh);
        });
        updateCutoutCameraGating();
    }

    // Dipanggil SETIAP FRAME semasa Pratonton (lihat animate()). Tiada lagi keputusan
    // per-objek — cuma kemas kini uniform cutter (kedudukan/putaran boleh berubah, cth
    // cutter digenggam atau contentRoot AR dipindah) & pastikan objek baharu (dimuat
    // lewat/dimunculkan) guna material boleh-potong. Kamera dibaca terus oleh shader
    // (cameraPosition — per mata dlm VR), jadi tiada kerja kamera di sini.
    function updateCutoutCameraGating() {
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        // Cutter TERSEMBUNYI (visible=false, cth belum dimunculkan trigger) tak memotong —
        // sama macam versi stencil dulu (cutter tersembunyi tak tulis stencil).
        const visibleCutters = loadedModelsList.filter(m => m.userData.isCutter && m.visible !== false);
        const cutters = visibleCutters.filter(isAnalyticCutter);
        if (cutters.length > CUT_MAX && !warnedTooManyCutters) {
            warnedTooManyCutters = true;
            console.warn('[Cutout] Lebih ' + CUT_MAX + ' cutter primitif dlm scene — yg berlebihan diabaikan.');
        }
        const count = Math.min(cutters.length, CUT_MAX);
        for (let i = 0; i < count; i++) writeCutterUniforms(cutters[i], i);
        cutUniforms.uCutCount.value = count;

        const meshCutters = visibleCutters.filter(c => !isAnalyticCutter(c));
        meshCutters.forEach(c => c.updateMatrixWorld(true));
        if (meshCutters.length > 0) renderCutterDepth(meshCutters);
        else cutUniforms.uCutDepthOn.value = 0;

        if (!loadedModelsList.some(m => m.userData.isCutter)) return;

        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return;
            if (mesh.userData.isCutter || mesh.userData.excludeFromCutout) return;
            setCuttableMaterial(mesh, true);
        });
        // Segmen laluan waypoint ikut flag excludeFromCutout yg sama macam objek biasa
        // (diwarisi drpd waypoint yg bersambung — lihat rebuildWaypointPath()).
        waypointPathMeshes.forEach(mesh => {
            if (mesh.userData.excludeFromCutout) return;
            setCuttableMaterial(mesh, true);
        });
    }

    // Dipanggil bila keluar Pratonton (teardownPhysicsWorld) — buang kesan potongan
    // sepenuhnya, dan pulihkan objek cutter ke paparan kosmetik mod Editing (wireframe).
    function clearCutoutEffect() {
        cutUniforms.uCutCount.value = 0;
        cutUniforms.uCutDepthOn.value = 0;
        const loadedModelsList = getLoadedModelsList();
        const waypointPathMeshes = getWaypointPathMeshes();
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.isCutter) applyCutterEditModeMaterial(mesh);
            else restoreOriginalMaterial(mesh);
        });
        waypointPathMeshes.forEach(mesh => restoreOriginalMaterial(mesh));
    }

    // Dipanggil dalam mod Editing (bukan Pratonton) setiap kali senarai objek/flag
    // isCutter mungkin berubah (scene baru dimuat, togol checkbox, duplicate, dll) —
    // pastikan objek cutter SENTIASA nampak sebagai wireframe magenta semasa editing.
    function refreshCutterEditVisuals(isPreviewMode) {
        if (isPreviewMode) return;
        const loadedModelsList = getLoadedModelsList();
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.isCutter) applyCutterEditModeMaterial(mesh);
            else restoreOriginalMaterial(mesh);
        });
    }

    // restoreOriginalMaterial diexport juga — view.html perlukan ia utk teardownPhysicsWorld
    // versi viewer (tiada mod Editing, jadi "clear" cuma pulihkan material asal terus).
    return { applyCutoutEffect, updateCutoutCameraGating, clearCutoutEffect, refreshCutterEditVisuals, restoreOriginalMaterial };
}
