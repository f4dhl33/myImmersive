// Utiliti kamera/orbit-pivot — diekstrak dari index.html. Setup scene/camera/renderer/
// lights SEBENAR (THREE.Scene, mainCamera, WebGLRenderer, dll) KEKAL di index.html — ia
// immediate-execution code yang urutan ciptanya penting (mainCamera perlu wujud sebelum
// cameraRig, renderer sebelum createXRButton dipanggil, dsb) dan hanya dicipta SEKALI
// semasa app bermula, jadi faedah modulasi rendah berbanding risiko pecahkan urutan tu.
export function createSceneUtils({ THREE, getContentRoot, getRenderer, getLoadedModelsList, getControls }) {
    function recenterOrbitPivot() {
        const renderer = getRenderer();
        // JANGAN sentuh OrbitControls semasa sesi XR aktif sedang presenting —
        // kedudukan kamera sepatutnya dikawal sepenuhnya oleh WebXR/headset/
        // telefon ketika tu, bukan OrbitControls. controls.update() akan tulis
        // semula mainCamera.position ikut matematik orbit dan boleh rosakkan/
        // konflik dengan render AR sebenar (contoh: bila tukar scene semasa AR).
        if (renderer.xr.isPresenting) return;
        const loadedModelsList = getLoadedModelsList();
        if (!loadedModelsList.length) return;
        // Paksa matrixWorld ter-update dulu — Box3 baca matrixWorld terus, tak
        // auto-update sendiri, jadi kedudukan dunia objek yang baru sahaja
        // ditambah/dimuat mungkin masih belum "fresh" tanpa panggilan ni.
        getContentRoot().updateMatrixWorld(true);
        const box = new THREE.Box3();
        let hasAny = false;
        loadedModelsList.forEach(m => { box.expandByObject(m); hasAny = true; });
        if (!hasAny) return;
        const center = new THREE.Vector3();
        box.getCenter(center);
        if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(center.z)) return;
        const controls = getControls();
        controls.target.copy(center);
        controls.update();
    }

    // Cari titik pivot yang sepadan dengan JARAK SEBENAR kandungan dari kamera —
    // bukan jarak tetap (contoh 3 unit) yang tak kira di mana objek sebenar
    // berada (boleh buat objek jauh "berpusar" dramatik keliling kamera bila
    // jarak tu tak match — tuas/lever-arm terlalu pendek berbanding jarak objek
    // sebenar). Raycast sepanjang arah pandangan kamera; kalau kena objek, guna
    // titik tu sebagai pivot. Kalau tidak, fallback ke jarak tetap.
    function findCameraOrbitTarget(camPosition, camQuaternion, fallbackDistance) {
        getContentRoot().updateMatrixWorld(true);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuaternion).normalize();
        const rc = new THREE.Raycaster(camPosition.clone(), forward.clone());
        const hits = rc.intersectObjects(getLoadedModelsList().filter(o => o.visible), true);
        if (hits.length > 0) {
            return hits[0].point;
        }
        return camPosition.clone().add(forward.multiplyScalar(fallbackDistance));
    }

    return { recenterOrbitPivot, findCameraOrbitTarget };
}
