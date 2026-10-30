// Kitaran hayat mod Pratonton (masuk/keluar Editing <-> Preview/VR/AR) — diekstrak dari
// index.html. Ini orkestrasi paling padat dalam app (sentuh occluder, fizik, trigger,
// kamera, hierarchy, grab) — byk getter/setter sebab kebanyakan state yang disentuh
// diisytiharkan LEWAT berbanding titik asal fungsi-fungsi ni dalam index.html.
import { appState } from './state.js';

export function createPreviewMode({
    THREE, gridHelper, originCross, cameraRig, editorCameraState,
    btnTogglePreview, btnExitPreview, modeTextLabel,
    getContentRoot,
    getRenderer, getMainCamera, getControls, getPreviewCameraMarker, getCameraHelper, getReticle,
    getLoadedModelsList, getHideCameraHelperPref,
    getPreviewObjectSnapshot, setPreviewObjectSnapshot,
    getIsPreviewMode, setIsPreviewMode,
    getHoveredModel, setHoveredModel,
    getIsARSession, setIsPlaced, setHitTestSource, setHitTestSourceRequested,
    getProjectScenesMeta, getActiveSceneId, switchToScene,
    setIsMouseGrabbing, setVrPendingGrabCandidate,
    clearEditColliderDebug, buildEditColliderDebug, closeAnimModal, deselectObject,
    buildPhysicsWorldFromScene, teardownPhysicsWorld, fireSceneStartTriggers,
    renderObjectsList, recenterOrbitPivot, scheduleAutoSave
}) {
    function capturePreviewObjectSnapshot() {
        const snapshot = new Map();
        getLoadedModelsList().forEach(m => {
            snapshot.set(m.userData.id, {
                position: m.position.clone(),
                quaternion: m.quaternion.clone(),
                scale: m.scale.clone()
            });
        });
        setPreviewObjectSnapshot(snapshot);
    }

    function restorePreviewObjectSnapshot() {
        const previewObjectSnapshot = getPreviewObjectSnapshot();
        if (!previewObjectSnapshot) return;
        getLoadedModelsList().forEach(m => {
            const snap = previewObjectSnapshot.get(m.userData.id);
            if (!snap) return;
            m.position.copy(snap.position);
            m.quaternion.copy(snap.quaternion);
            m.scale.copy(snap.scale);
            m.userData.stepStateToggle = false;
            m.userData.isRotating = false;
        });
        setPreviewObjectSnapshot(null);
    }

    // Letak semula visibility awal objek + posisi kamera/rig kat Kedudukan Awal Kamera.
    // Dipakai semasa masuk Pratonton, DAN semula bila "Tukar Scene" dicetus sewaktu
    // pratonton/VR/AR sedang aktif (macam "portal" ke scene lain).
    function applyPreviewVisibilityAndCamera() {
        const renderer = getRenderer();
        const mainCamera = getMainCamera();
        const controls = getControls();
        const previewCameraMarker = getPreviewCameraMarker();

        getLoadedModelsList().forEach(m => {
            m.visible = (m.userData.primType === 'zone') ? false : (m.userData.initialVisibility !== false);
        });

        if (renderer.xr.isPresenting) {
            cameraRig.position.copy(previewCameraMarker.position);
            cameraRig.rotation.copy(previewCameraMarker.rotation);
            mainCamera.position.set(0, 0, 0);
            mainCamera.rotation.set(0, 0, 0);
            controls.enabled = false;
        } else {
            mainCamera.position.copy(previewCameraMarker.position);
            mainCamera.rotation.copy(previewCameraMarker.rotation);

            // Guna pivot yang SAMA macam mod editing (titik tengah bounding-box
            // semua kandungan) — bukan kira semula berdasarkan kamera pratonton —
            // supaya putaran dalam Pratonton rasa konsisten dengan editor.
            recenterOrbitPivot();

            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            controls.enabled = true;
            controls.update();
        }

        buildPhysicsWorldFromScene();
        fireSceneStartTriggers();
    }

    // Fallback bila hit-test AR tak disokong peranti/browser — letak kandungan
    // 1.5m di hadapan titik mula sesi AR (world-locked, tak "ikut kamera").
    function placeContentAtDefault() {
        const contentRoot = getContentRoot();
        contentRoot.position.set(0, 0, -1.5);
        contentRoot.quaternion.identity();
        setIsPlaced(true);
        getReticle().visible = false;
        getLoadedModelsList().forEach(m => {
            m.visible = (m.userData.primType === 'zone') ? false : (m.userData.initialVisibility !== false);
        });
        buildPhysicsWorldFromScene();
        fireSceneStartTriggers();
    }

    function placeContentAtReticle() {
        const contentRoot = getContentRoot();
        const reticle = getReticle();
        contentRoot.position.setFromMatrixPosition(reticle.matrix);
        contentRoot.quaternion.setFromRotationMatrix(reticle.matrix);
        setIsPlaced(true);
        reticle.visible = false;
        getLoadedModelsList().forEach(m => {
            m.visible = (m.userData.primType === 'zone') ? false : (m.userData.initialVisibility !== false);
        });
        buildPhysicsWorldFromScene();
        fireSceneStartTriggers();
    }

    async function setPreviewMode(enable) {
        setIsPreviewMode(enable);
        setHoveredModel(null);
        clearEditColliderDebug(); // elak wireframe mod Editing bertindih dengan yang fizik sebenar

        const contentRoot = getContentRoot();
        const renderer = getRenderer();
        const mainCamera = getMainCamera();
        const controls = getControls();
        const cameraHelper = getCameraHelper();
        const loadedModelsList = getLoadedModelsList();

        if (enable) {
            // Scene PERTAMA (paling atas dalam senarai) sentiasa jadi default view bila
            // masuk Pratonton/VR/AR — tak kira scene mana yang terakhir diedit.
            const projectScenesMeta = getProjectScenesMeta();
            if (projectScenesMeta.length > 0 && getActiveSceneId() !== projectScenesMeta[0].id) {
                await switchToScene(projectScenesMeta[0].id);
            }

            closeAnimModal();
            document.body.classList.add('preview-mode');
            btnTogglePreview.style.display = 'none';
            btnExitPreview.style.display = 'block';
            modeTextLabel.innerText = "User Preview (Interactive Mode)";

            deselectObject();
            gridHelper.visible = false;
            originCross.visible = false;
            cameraHelper.visible = false;

            // Tangkap kedudukan/putaran/saiz SEMUA objek SEBELUM apa-apa simulasi
            // fizik/interaksi berlaku — ni yang dipulihkan semula bila keluar Pratonton.
            capturePreviewObjectSnapshot();

            // Reset status "pengguna dalam zon" supaya trigger onUserEnterZone boleh
            // tercetus semula dari awal setiap kali Pratonton dimasuki.
            loadedModelsList.forEach(m => { m.userData._userInsideZone = false; });

            if (!renderer.xr.isPresenting) {
                editorCameraState.position.copy(mainCamera.position);
                editorCameraState.rotation.copy(mainCamera.rotation);
                editorCameraState.target.copy(controls.target);
            }

            if (getIsARSession()) {
                // AR: jangan letak kamera/visibility lagi — tunggu tap-to-place (hit-test).
                setIsPlaced(false);
                setHitTestSourceRequested(false);
                setHitTestSource(null);
                getReticle().visible = false;
                contentRoot.position.set(0, 0, 0);
                contentRoot.quaternion.identity();
                loadedModelsList.forEach(m => { m.visible = false; });
            } else {
                applyPreviewVisibilityAndCamera();
            }

        } else {
            document.body.classList.remove('preview-mode');
            btnTogglePreview.style.display = 'block';
            btnExitPreview.style.display = 'none';
            modeTextLabel.innerText = "Interactive Editing";

            gridHelper.visible = true;
            originCross.visible = true;
            cameraHelper.visible = !getHideCameraHelperPref();

            // Reset keadaan genggam kalau pengguna keluar Pratonton semasa tengah menggenggam.
            appState.grabbedObject = null;
            appState.grabStartState = null;
            setIsMouseGrabbing(false);
            setVrPendingGrabCandidate(null);

            teardownPhysicsWorld();

            // Pulihkan kedudukan/putaran/saiz semua objek ke keadaan SEBELUM Pratonton
            // dimasuki — buang sebarang kesan fizik/pick & place/interaksi yang berlaku
            // semasa sesi ujian tu, supaya layout editor tak berubah secara kekal.
            restorePreviewObjectSnapshot();
            renderObjectsList();

            // Simpan SEMULA keadaan yang baru dipulihkan — timpa sebarang auto-save "rosak"
            // (cth: objek terbalik/posisi fizik ujian) yang mungkin sempat tersimpan semasa
            // Pratonton sebelum gari scheduleAutoSave() di atas wujud/jalan.
            scheduleAutoSave();

            loadedModelsList.forEach(m => {
                m.visible = true;
            });

            contentRoot.position.set(0, 0, 0);
            contentRoot.quaternion.identity();

            if (!renderer.xr.isPresenting) {
                cameraRig.position.set(0, 0, 0);
                cameraRig.rotation.set(0, 0, 0);
                mainCamera.position.copy(editorCameraState.position);
                mainCamera.rotation.copy(editorCameraState.rotation);
                controls.target.copy(editorCameraState.target);

                controls.mouseButtons = {
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.PAN
                };
                controls.enabled = true;
                controls.update();
            }
            buildEditColliderDebug();
        }
        window.dispatchEvent(new Event('resize'));
    }

    return {
        capturePreviewObjectSnapshot, restorePreviewObjectSnapshot, applyPreviewVisibilityAndCamera,
        placeContentAtDefault, placeContentAtReticle, setPreviewMode
    };
}
