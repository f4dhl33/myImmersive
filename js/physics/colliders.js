// Bina & urus badan fizik cannon.js + collider debug wireframe untuk setiap objek
// "Pepejal"/"Boleh Diambil" — diekstrak dari index.html. appState.physicsBodies/
// physicsActive/editColliderDebugMeshes dikongsi (dibaca/ditulis) dengan index.html
// (animate loop, checkbox "Show Colliders") — lihat js/core/state.js.
//
// physicsWorld/getPhysicsMaterialForBounciness diimport TERUS dari world.js (bukan
// dihantar sebagai parameter) — ni selamat (BUKAN circular): world.js sendiri tiada
// import apa-apa, jadi colliders.js -> world.js adalah satu hala sahaja.
import { physicsWorld, getPhysicsMaterialForBounciness } from './world.js';
import { appState } from '../core/state.js';

// getShowCollidersChecked/getIsPreviewMode MESTI getter (bukan nilai terus) — dua sebab:
// (1) chkShowColliders (elemen DOM) diisytiharkan LEWAT dalam index.html (selepas titik
//     factory ni dipanggil) — nilai terus akan baca pembolehubah yang belum wujud (TDZ).
// (2) isPreviewMode ialah pembolehubah index.html sendiri — fail modul ni ada skop
//     berasingan, tiada akses closure terus kepadanya walaupun timing bukan isu.
export function createColliders({ THREE, contentRoot, getLoadedModelsList, getShowCollidersChecked, getIsPreviewMode, applyCutoutEffect, clearCutoutEffect }) {
    function isMaterialEffectivelyInvisible(material) {
        if (!material) return false;
        const mats = Array.isArray(material) ? material : [material];
        return mats.every(m => m && (m.visible === false || (m.transparent && m.opacity <= 0.02)));
    }

    // Box3 yang HANYA kira mesh yang benar-benar KELIHATAN (node.visible !== false).
    // THREE.Box3().setFromObject() baku mengabaikan flag visible — kalau fail GLB ada
    // node tersembunyi (cth: platform/collision-proxy/backdrop yang ditinggalkan oleh
    // pencipta asal model), ia tetap disertakan dalam kiraan kotak, buat collider fizik
    // jadi jauh lebih besar/beranjak berbanding model yang benar-benar nampak.
    // Sesetengah fail GLB muat turun ada "shadow plane"/mesh bantuan yang node.visible
    // dia TRUE (jadi tetap dirender) tapi material dia lutsinar/opacity hampir 0 — nampak
    // "tiada" di mata tapi geometri dia tetap wujud dan selalunya lebih luas/rendah
    // daripada model sebenar, buat collider jadi lebih besar daripada yang patut.
    function computeVisibleWorldBox3(root) {
        // PENTING: paksa matrixWorld terkini dulu — root mungkin belum pernah
        // di-render/ditambah ke scene (cth: model yang baru siap load), jadi
        // matrixWorld lalai (identity) tak mencerminkan transform sebenar lagi.
        root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const tmpBox = new THREE.Box3();
        const tmpVec = new THREE.Vector3();
        let hasAny = false;
        (function recurse(node) {
            if (node.visible === false) return;
            if (node.isMesh && isMaterialEffectivelyInvisible(node.material)) return;
            if (node.isSkinnedMesh && node.geometry && node.skeleton) {
                // SkinnedMesh.geometry.boundingBox ialah bentuk "bind pose" STATIK —
                // tak kira langsung pose/rig semasa (cth: kaki robot terbuka/tertutup),
                // jadi boleh jadi jauh lebih kecil/nipis daripada bentuk sebenar yang
                // nampak. Guna boneTransform() supaya kedudukan vertex SELEPAS skinning
                // yang diukur, bukan bentuk rehat. cuba/tangkap — model dengan skeleton
                // tak lengkap/pelik boleh baling ralat dalam boneTransform(); jangan biar
                // ia gugurkan keseluruhan pengiraan, guna bind-pose statik sebagai fallback.
                let skinnedOk = false;
                try {
                    node.skeleton.update();
                    const posAttr = node.geometry.attributes.position;
                    let firstVertex = true;
                    const skinnedBox = new THREE.Box3();
                    for (let i = 0; i < posAttr.count; i++) {
                        node.boneTransform(i, tmpVec);
                        tmpVec.applyMatrix4(node.matrixWorld);
                        if (firstVertex) { skinnedBox.min.copy(tmpVec); skinnedBox.max.copy(tmpVec); firstVertex = false; }
                        else skinnedBox.expandByPoint(tmpVec);
                    }
                    if (!firstVertex) {
                        if (!hasAny) { box.copy(skinnedBox); hasAny = true; }
                        else box.union(skinnedBox);
                        skinnedOk = true;
                    }
                } catch (e) {
                    console.warn('[Physics] boneTransform failed for "' + (node.name || 'skinned mesh') + '", falling back to bind-pose box:', e);
                }
                if (!skinnedOk && node.geometry) {
                    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
                    tmpBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
                    if (!hasAny) { box.copy(tmpBox); hasAny = true; }
                    else box.union(tmpBox);
                }
            } else if (node.isMesh && node.geometry) {
                if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
                tmpBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
                if (!hasAny) { box.copy(tmpBox); hasAny = true; }
                else box.union(tmpBox);
            }
            for (let i = 0; i < node.children.length; i++) recurse(node.children[i]);
        })(root);
        if (!hasAny) box.setFromObject(root); // fallback kalau tiada mesh kelihatan langsung
        return box;
    }

    // Kira "kotak sempadan lokal" objek (saiz + offset pusat berbanding position-nya) —
    // guna bila primitif bukan kotak/sfera ringkas (contoh model GLTF, satah teks, dll).
    function computeLocalBoxHalfExtentsAndOffset(mesh) {
        const savedQuat = mesh.quaternion.clone();
        const savedPos = mesh.position.clone();
        mesh.quaternion.identity();
        mesh.position.set(0, 0, 0);
        mesh.updateMatrixWorld(true);

        // PENTING: position/quaternion mesh MESTI dipulihkan tak kira apa-apa pun jadi
        // semasa pengiraan (contoh: ralat tak dijangka dalam computeVisibleWorldBox3) —
        // kalau tidak, objek tu "terperangkap" di (0,0,0)/identity secara kekal. Ini boleh
        // dipanggil bila-bila masa (Preview, Show Colliders masa Editing, mouse-grab),
        // jadi ralat terlepas pandang di sini rosakkan kedudukan objek yang nampak.
        let size, center;
        try {
            const box = computeVisibleWorldBox3(mesh);
            size = new THREE.Vector3();
            center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
        } catch (e) {
            console.error('[Physics] computeVisibleWorldBox3 failed for "' + (mesh.userData.fileName || mesh.name) + '" — using a small fallback box:', e);
            size = new THREE.Vector3(0.5, 0.5, 0.5);
            center = new THREE.Vector3(0, 0, 0);
        } finally {
            mesh.quaternion.copy(savedQuat);
            mesh.position.copy(savedPos);
            mesh.updateMatrixWorld(true);
        }

        size.x = Math.max(size.x, 0.02);
        size.y = Math.max(size.y, 0.02);
        size.z = Math.max(size.z, 0.02);
        return { halfExtents: size.multiplyScalar(0.5), offset: center };
    }

    // Potong manual kotak collider dari MANA-MANA muka (6 sisi) — untuk kes auto-detect
    // (visible-only box) masih tak match bentuk sebenar (cth: fail GLB dengan geometri
    // tersembunyi yang tak dikesan), supaya pengguna boleh betulkan terus ikut mata guna
    // "Show Colliders". trim = {nx,px,ny,py,nz,pz}, semua dalam meter, lalai 0.
    function applyColliderTrim(mesh, halfExtents, offset) {
        const t = mesh.userData.colliderTrim;
        if (!t) return { halfExtents, offset };
        const hx = Math.max(halfExtents.x - ((t.nx || 0) + (t.px || 0)) / 2, 0.02);
        const hy = Math.max(halfExtents.y - ((t.ny || 0) + (t.py || 0)) / 2, 0.02);
        const hz = Math.max(halfExtents.z - ((t.nz || 0) + (t.pz || 0)) / 2, 0.02);
        return {
            halfExtents: { x: hx, y: hy, z: hz },
            offset: {
                x: offset.x + ((t.nx || 0) - (t.px || 0)) / 2,
                y: offset.y + ((t.ny || 0) - (t.py || 0)) / 2,
                z: offset.z + ((t.nz || 0) - (t.pz || 0)) / 2
            }
        };
    }

    function buildPhysicsShapeForMesh(mesh) {
        const primType = mesh.userData.primType;

        if (primType === 'sphere') {
            const radius = 0.6 * ((mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3);
            return { shape: new CANNON.Sphere(Math.max(radius, 0.02)), offset: new CANNON.Vec3(0, 0, 0) };
        }
        if (primType === 'box') {
            const hx = Math.max(0.5 * mesh.scale.x, 0.02);
            const hy = Math.max(0.5 * mesh.scale.y, 0.02);
            const hz = Math.max(0.5 * mesh.scale.z, 0.02);
            const trimmed = applyColliderTrim(mesh, { x: hx, y: hy, z: hz }, { x: 0, y: 0, z: 0 });
            return {
                shape: new CANNON.Box(new CANNON.Vec3(trimmed.halfExtents.x, trimmed.halfExtents.y, trimmed.halfExtents.z)),
                offset: new CANNON.Vec3(trimmed.offset.x, trimmed.offset.y, trimmed.offset.z)
            };
        }

        const base = computeLocalBoxHalfExtentsAndOffset(mesh);
        const trimmed = applyColliderTrim(mesh, base.halfExtents, base.offset);
        return {
            shape: new CANNON.Box(new CANNON.Vec3(trimmed.halfExtents.x, trimmed.halfExtents.y, trimmed.halfExtents.z)),
            offset: new CANNON.Vec3(trimmed.offset.x, trimmed.offset.y, trimmed.offset.z)
        };
    }

    function createPhysicsBodyForMesh(mesh) {
        const isDynamic = !!mesh.userData.isGrabbable;
        const { shape, offset } = buildPhysicsShapeForMesh(mesh);
        const bounciness = (typeof mesh.userData.bounciness === 'number') ? mesh.userData.bounciness : 0.4;

        const body = new CANNON.Body({
            mass: isDynamic ? 1 : 0,
            material: getPhysicsMaterialForBounciness(bounciness),
            linearDamping: 0.2,
            angularDamping: 0.4
        });
        body.addShape(shape, offset);

        body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
        body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
        if (!isDynamic) body.type = CANNON.Body.STATIC;

        return { body, shape, offset };
    }

    // PENUNJUK DEBUG (wireframe) — tunjuk dengan TEPAT saiz & kedudukan "kotak fizik"
    // (collider) sebenar yang cannon.js guna untuk setiap objek, supaya senang kesan
    // kalau ia tak sepadan dengan model visual (contoh: terlalu besar/offset silap
    // untuk model GLB kompleks). Togol via checkbox "Show Colliders" di top-bar.
    const physicsDebugMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false });
    function buildPhysicsDebugMesh(shape, offset) {
        let geometry;
        if (shape instanceof CANNON.Sphere) {
            geometry = new THREE.SphereGeometry(shape.radius, 12, 8);
        } else {
            const he = shape.halfExtents;
            geometry = new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2);
        }
        const debugMesh = new THREE.Mesh(geometry, physicsDebugMaterial);
        debugMesh.userData._localOffset = new THREE.Vector3(offset.x, offset.y, offset.z);
        debugMesh.renderOrder = 997;
        return debugMesh;
    }

    // Objek nampak → collider aktif. Objek tersembunyi → collider TAK aktif, KECUALI
    // ditanda khas "Keep Collider Active While Hidden" (cth: dinding/penyekat tak
    // kelihatan untuk motong laluan waypoint di sebalik dinding sebenar dalam AR).
    function shouldColliderBeActive(mesh) {
        return mesh.visible !== false || mesh.userData.colliderActiveWhenHidden === true;
    }

    // Bina semula dunia fizik daripada kedudukan SEMASA setiap objek "Boleh Diambil"
    // (badan dinamik — kena graviti, boleh melantun) & "Pepejal" (badan statik — perengkuh).
    // Dipanggil setiap kali Pratonton/VR/AR dimasuki, atau bila scene ditukar semasa aktif.
    function buildPhysicsWorldFromScene() {
        const loadedModelsList = getLoadedModelsList();
        appState.physicsBodies.forEach(pb => {
            if (pb.inWorld) physicsWorld.removeBody(pb.body);
            if (pb.debugMesh) contentRoot.remove(pb.debugMesh);
        });
        appState.physicsBodies = [];

        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return; // zon bukan objek fizikal
            if (!mesh.userData.isSolid && !mesh.userData.isGrabbable) return;

            // try/catch SETIAP objek — satu objek bermasalah tak patut gugurkan
            // pembinaan fizik untuk SEMUA objek lain dalam scene.
            try {
                const { body, shape, offset } = createPhysicsBodyForMesh(mesh);

                // Collider objek yang TERSEMBUNYI (visible=false) tak dimasukkan ke dunia
                // fizik lagi (kecuali ditanda "Keep Collider Active While Hidden" — cth:
                // dinding/penyekat tak kelihatan). Disegerakkan setiap bingkai ikut
                // mesh.visible SEMASA (lihat syncPhysicsBodiesWithVisibility di animate()).
                const inWorld = shouldColliderBeActive(mesh);
                if (inWorld) physicsWorld.addBody(body);

                const debugMesh = buildPhysicsDebugMesh(shape, offset);
                debugMesh.visible = getShowCollidersChecked() && inWorld;
                contentRoot.add(debugMesh);

                appState.physicsBodies.push({ mesh, body, debugMesh, inWorld });
                mesh.userData._physicsBody = body;
            } catch (e) {
                console.error('[Physics] Failed to build physics body for "' + (mesh.userData.fileName || mesh.name) + '" — skipping this object:', e);
            }
        });

        appState.physicsActive = true;
        applyCutoutEffect();
    }

    // Disegerakkan setiap bingkai SEBELUM physicsWorld.step() — tambah/keluarkan badan
    // dari dunia fizik ikut mesh.visible SEMASA berbanding keadaan "inWorld" yang disimpan,
    // supaya togol visibility (initial atau semasa Pratonton via aksi Hide/Show) terus
    // aktif/nyahaktifkan collider objek tu dengan segera, bukan hanya masa scene dibina.
    function syncPhysicsBodiesWithVisibility() {
        appState.physicsBodies.forEach(pb => {
            const shouldBeInWorld = shouldColliderBeActive(pb.mesh);
            if (shouldBeInWorld && !pb.inWorld) {
                physicsWorld.addBody(pb.body);
                pb.inWorld = true;
            } else if (!shouldBeInWorld && pb.inWorld) {
                physicsWorld.removeBody(pb.body);
                pb.inWorld = false;
            }
            if (pb.debugMesh) pb.debugMesh.visible = getShowCollidersChecked() && shouldBeInWorld;
        });
    }

    function teardownPhysicsWorld() {
        appState.physicsActive = false;
        appState.physicsBodies.forEach(pb => {
            if (pb.inWorld) physicsWorld.removeBody(pb.body);
            if (pb.debugMesh) contentRoot.remove(pb.debugMesh);
            delete pb.mesh.userData._physicsBody;
        });
        appState.physicsBodies = [];
        clearCutoutEffect();
    }

    // "Show Colliders" di luar Pratonton (mod Editing biasa) — tiada dunia fizik cannon.js
    // berjalan di sini (tiada graviti/simulasi), jadi ini sekadar PAPARAN STATIK: bina
    // wireframe collider terus daripada kedudukan/putaran/saiz SEMASA setiap objek
    // Pepejal/Boleh Diambil, supaya pengguna nampak collider masa tengah edit/trim lagi
    // tanpa perlu masuk Preview setiap kali nak semak.
    function clearEditColliderDebug() {
        appState.editColliderDebugMeshes.forEach(e => contentRoot.remove(e.debugMesh));
        appState.editColliderDebugMeshes = [];
    }
    function buildEditColliderDebug() {
        clearEditColliderDebug();
        if (getIsPreviewMode() || !getShowCollidersChecked()) return;

        const loadedModelsList = getLoadedModelsList();
        loadedModelsList.forEach(mesh => {
            if (mesh.userData.primType === 'zone') return;
            if (!mesh.userData.isSolid && !mesh.userData.isGrabbable) return;
            if (!shouldColliderBeActive(mesh)) return;

            try {
                const { shape, offset } = buildPhysicsShapeForMesh(mesh);
                const debugMesh = buildPhysicsDebugMesh(shape, offset);
                debugMesh.visible = true;
                contentRoot.add(debugMesh);
                appState.editColliderDebugMeshes.push({ mesh, debugMesh, localOffset: new THREE.Vector3(offset.x, offset.y, offset.z) });
            } catch (e) {
                console.error('[Physics] Failed to build edit-mode collider debug for "' + (mesh.userData.fileName || mesh.name) + '":', e);
            }
        });
        syncEditColliderDebugPositions();
    }
    // Dipanggil setiap frame (murah — sekadar salin position/quaternion) supaya collider
    // ikut objek secara langsung semasa drag (Move/Rotate). Saiz/bentuk kotak (geometry)
    // hanya dibina semula bila benar-benar perlu (lihat scheduleAutoSave).
    function syncEditColliderDebugPositions() {
        appState.editColliderDebugMeshes.forEach(e => {
            const worldOffset = e.localOffset.clone().applyQuaternion(e.mesh.quaternion);
            e.debugMesh.position.set(
                e.mesh.position.x + worldOffset.x,
                e.mesh.position.y + worldOffset.y,
                e.mesh.position.z + worldOffset.z
            );
            e.debugMesh.quaternion.copy(e.mesh.quaternion);
        });
    }

    return {
        computeVisibleWorldBox3,
        buildPhysicsShapeForMesh,
        createPhysicsBodyForMesh,
        shouldColliderBeActive,
        buildPhysicsWorldFromScene,
        syncPhysicsBodiesWithVisibility,
        teardownPhysicsWorld,
        clearEditColliderDebug,
        buildEditColliderDebug,
        syncEditColliderDebugPositions
    };
}
