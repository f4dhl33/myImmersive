// Sistem interaksi pointer penuh: klik/hover/genggam tetikus (desktop) + klik/genggam
// controller VR/AR (WebXR select/selectstart/selectend) — diekstrak dari index.html. Ini
// gabungan PALING padat dalam app (sejarah bug grab paling panjang, lihat memori projek) —
// byk getter/setter sebab kebanyakan state yang disentuh diisytiharkan LEWAT berbanding
// titik asal kod ni dalam index.html. JANGAN ubah logik dalaman tanpa ulang ujian menyeluruh
// (VR/AR controller sebenar + mouse desktop) — ini TAK boleh diuji automatik (perlukan
// peranti WebXR sebenar), jadi sebarang perubahan di sini kena diuji manual.
import { appState } from '../core/state.js';
import { arDebug } from '../ui/ar-debug-hud.js';

export function createPointerGrab({
    THREE,
    getRenderer, getMainCamera, getControls, getScene, getContentRoot, getCameraRig,
    getPreviewCameraMarker, getReticle,
    getLoadedModelsList, getHoveredModel, setHoveredModel,
    getIsPreviewMode, getIsARSession, getIsPlaced, getIsDraggingGizmo,
    getIsMouseGrabbing, setIsMouseGrabbing,
    getVrPendingGrabCandidate, setVrPendingGrabCandidate,
    getInfoPopup, clearPopupHideTimer,
    triggerInteraction, selectObject, deselectObject,
    checkPlacementZones, returnObjectToOriginalTransform,
    placeContentAtReticle,
    getControllerRaycastHit, getControllerGrabRaycastHit,
    computeARGrabDistance, computeMoveGain, buildGrabStartState,
    AR_SCREEN_GRAB_ANGLE_THRESHOLD, AR_SCREEN_GRAB_MIN_HOLD_MS, VR_GRAB_ANGLE_THRESHOLD, VR_GRAB_POS_THRESHOLD,
    scheduleAutoSave
}) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let justReleasedGrab = false;
    let pendingGrabCandidate = null; // {hitModel, point} — ditetapkan di pointerdown, disahkan di pointermove

    // GENGGAM GUNA MOUSE (Desktop Preview, bukan sesi XR — termasuk fallback "View tanpa
    // AR/VR" bila peranti tak sokong WebXR, sebab mod tu pun guna laluan mouse yang sama).
    // Guna STRUKTUR GRAB SAMA (appState.grabbedObject/appState.grabStartState/updateGrabbedObjectTransform)
    // macam controller VR — proksi "controller" untuk mouse ialah Object3D ringkas yang
    // kedudukannya dikemaskini ikut titik persilangan mouse-ray dengan satah (plane) tegak
    // lurus arah kamera yang melalui titik genggaman asal. Sentiasa mod 'move' (tiada
    // rotate — mouse tiada input putaran semula jadi macam tangan VR).
    // AR (tap di skrin telefon): WebXR mewakilkan tap sebagai "transient-pointer"
    // controller, melalui laluan onControllerSelectStart/End yang SAMA di atas —
    // TAPI kedudukan DUNIA controller tu sendiri kekal hampir statik (terikat kamera),
    // jadi commitVRGrab/checkVRPendingGrabCommit bina proksi jarak-tetap KHUSUS utk AR
    // (computeARGrabDistance/updateARGrabProxy) drpd guna kedudukan controller mentah
    // terus macam VR hand controller — rujuk nota panjang pada computeARGrabDistance.
    const mouseGrabProxy = new THREE.Object3D();
    const mouseGrabPlane = new THREE.Plane();
    const mouseGrabPlaneNormal = new THREE.Vector3();

    function startMouseGrab(hitModel, grabPoint) {
        const mainCamera = getMainCamera();
        const controls = getControls();
        appState.grabbedObject = hitModel;
        controls.enabled = false; // elak OrbitControls putar/pan kamera serentak masa drag

        const bodyToWake = hitModel.userData._physicsBody;
        if (bodyToWake && bodyToWake.type === CANNON.Body.STATIC) {
            bodyToWake.type = CANNON.Body.DYNAMIC;
            bodyToWake.mass = 1;
            bodyToWake.updateMassProperties();
            bodyToWake.velocity.set(0, 0, 0);
            bodyToWake.angularVelocity.set(0, 0, 0);
        }

        // Lumpuhkan damping sementara semasa digenggam — lihat nota panjang dlm
        // onControllerSelectStart (sebab sama terpakai utk mouse-grab desktop).
        let prevLinearDamping = null, prevAngularDamping = null;
        if (bodyToWake) {
            prevLinearDamping = bodyToWake.linearDamping;
            prevAngularDamping = bodyToWake.angularDamping;
            bodyToWake.linearDamping = 0;
            bodyToWake.angularDamping = 0;
        }

        mainCamera.getWorldDirection(mouseGrabPlaneNormal);
        mouseGrabPlane.setFromNormalAndCoplanarPoint(mouseGrabPlaneNormal, grabPoint);
        mouseGrabProxy.position.copy(grabPoint);
        mouseGrabProxy.quaternion.identity();

        const objWorldPosStart = new THREE.Vector3();
        const objWorldQuatStart = new THREE.Quaternion();
        hitModel.getWorldPosition(objWorldPosStart);
        hitModel.getWorldQuaternion(objWorldQuatStart);

        const controllerWorldPosStart = new THREE.Vector3();
        const controllerWorldQuatInvStart = new THREE.Quaternion();
        mouseGrabProxy.getWorldPosition(controllerWorldPosStart);
        mouseGrabProxy.getWorldQuaternion(controllerWorldQuatInvStart).invert();

        // buildGrabStartState() (js/interactions/grab-core.js) default-kan arGrabDistance/
        // arRawController ke null bila tak dihantar — fix SEBENAR utk bug app-hang
        // 2026-10-29 (laluan mouse dulu lupa set explicit null pada object literal
        // SENDIRI, buat `undefined !== null` jadi TRUE, updateARGrabProxy() terpanggil
        // utk mouse-grab & crash baca .getWorldPosition() pada arRawController yg
        // sepatutnya null). Guna SATU constructor dikongsi ni buat shape ni mustahil
        // drift lagi antara laluan VR/AR & mouse.
        appState.grabStartState = buildGrabStartState({
            mode: 'move',
            controller: mouseGrabProxy,
            objWorldPosStart,
            objWorldQuatStart,
            controllerWorldPosStart,
            controllerWorldQuatInvStart,
            prevLinearDamping,
            prevAngularDamping,
            moveGain: 1
        });

        setIsMouseGrabbing(true);
    }

    function commitVRGrab(pending) {
        const { hitModel, controller, mode } = pending;
        const isARSession = getIsARSession();
        const contentRoot = getContentRoot();
        appState.grabbedObject = hitModel;

        // Kalau objek ni pernah "terdok" dalam Zon Sasaran (jadi badan statik), hidupkan
        // semula jadi dinamik supaya boleh digenggam & digerakkan sekali lagi.
        const bodyToWake = hitModel.userData._physicsBody;
        if (bodyToWake && bodyToWake.type === CANNON.Body.STATIC) {
            bodyToWake.type = CANNON.Body.DYNAMIC;
            bodyToWake.mass = 1;
            bodyToWake.updateMassProperties();
            bodyToWake.velocity.set(0, 0, 0);
            bodyToWake.angularVelocity.set(0, 0, 0);
        }

        // SEBAB SEBENAR "berat/bergerak sikit sangat": setiap badan dinamik dicipta dgn
        // linearDamping 0.2 / angularDamping 0.4 (createPhysicsBodyForMesh) utk objek
        // lepas-genggam reda elok-elok. Tapi SEMASA digenggam, kelajuan sasaran kita
        // set terus ke body.velocity setiap bingkai render — damping cannon.js pula
        // terpakai setiap SUB-LANGKAH fizik dalaman (internalStep), bukan setiap bingkai
        // render. Di VR (~90Hz) kadar sub-langkah per bingkai tak tetap (0 atau 2,
        // accumulator world.step()), jadi damping boleh termampat 2x antara dua kemaskini
        // kita (0.8*0.8=0.64 baki) sebelum kita sempat set velocity semula — nyaris
        // membatalkan gerakan P-controller di atas, sama rata semua arah (padan dgn
        // laporan "berat" dlm SEMUA arah, bukan cuma angkat). Desktop (~60Hz) tak nampak
        // sebab 1 sub-langkah/bingkai konsisten. Lumpuhkan damping SEMENTARA semasa
        // digenggam (pulih bila lepas, onControllerSelectEnd) — ini TAK sentuh
        // collisionResponse/pelanggaran, jadi sokongan lantai/permukaan Pepejal kekal
        // penuh (beza dgn percubaan collisionResponse=false yg dah gagal sebelum ni).
        let prevLinearDamping = null, prevAngularDamping = null;
        if (bodyToWake) {
            prevLinearDamping = bodyToWake.linearDamping;
            prevAngularDamping = bodyToWake.angularDamping;
            bodyToWake.linearDamping = 0;
            bodyToWake.angularDamping = 0;
        }

        const objWorldPosStart = new THREE.Vector3();
        const objWorldQuatStart = new THREE.Quaternion();
        hitModel.getWorldPosition(objWorldPosStart);
        hitModel.getWorldQuaternion(objWorldQuatStart);

        // Kotak sempadan SEBENAR (geometri) objek — bukan objWorldPosStart (origin/pivot
        // Object3D). Model GLB (lagi-lagi export Sketchfab) selalu ada pivot JAUH drpd
        // pusat visual geometri — raycast/laser sentiasa betul sbb kena TRIANGLE sebenar,
        // tapi apa-apa pengiraan guna .position/getWorldPosition() terus boleh terpesong
        // jauh drpd kedudukan VISUAL. Data sebenar (2026-10-29): grabDistance terukur
        // 7.583m drpd objWorldPosStart, walhal objek nampak ~1m je dlm skrin — pivot
        // offset ni punca sebenar proksi jarak-tetap AR "proxy jump 19m/14m". Guna PUSAT
        // kotak sempadan (padan visual) utk ukur jarak controller->objek drpd AR sahaja;
        // movement delta (objWorldPosStart) kekal guna origin SEBENAR (betul utk kekal
        // offset asal objek, bukan isu di sini).
        const objBox = new THREE.Box3().setFromObject(hitModel);
        const objVisualCenter = objBox.getCenter(new THREE.Vector3());
        const objSize = objBox.getSize(new THREE.Vector3());

        // AR mod 'move' — bina proksi jarak-tetap (lihat computeARGrabDistance/
        // updateARGrabProxy di atas) sbb kedudukan DUNIA controller "transient-pointer"
        // tak boleh dipercayai utk translate (lihat nota di atas fungsi tu).
        let arGrabDistance = null, arRawController = null;
        let effectiveController = controller;
        // HANYA utk tap skrin TANPA jejak kedudukan ('screen') — controller 6DOF SEBENAR
        // (targetRayMode 'tracked-pointer', termasuk controller fizikal headset AR cth
        // Quest passthrough) kekal guna kedudukan controller terus macam VR, SAH sudah
        // (jangan topang proksi ni atasnya — itu punca regresi "jadi rotation" yg
        // dilaporkan pengguna bila test headset AR dgn controller kiri+kanan sebenar).
        if (isARSession && mode === 'move' && controller.userData.targetRayMode === 'screen') {
            const { proxy, distance } = computeARGrabDistance(controller, objVisualCenter);
            arGrabDistance = distance;
            // DIAGNOSTIK — koordinat MENTAH, bukan jarak sahaja. Pengguna sahkan fizikal
            // <1m drpd objek tapi grabDistance terbaca ~7-8m berulang kali walau lepas
            // tukar anchor pivot->pusat kotak — perlu nampak X/Y/Z sebenar utk kenal
            // pasti paksi/komponen mana yang terpesong, bukan teka lagi. BUANG lepas
            // bug disahkan.
            const ctrlPosNow = new THREE.Vector3();
            controller.getWorldPosition(ctrlPosNow);
            arDebug.commitObjPos = objVisualCenter.clone();
            arDebug.commitCtrlPos = ctrlPosNow;
            // DIAGNOSTIK — rantaian PENUH: kedudukan LOKAL objek (dlm contentRoot, patut
            // padan panel Transform editor) + kedudukan/putaran contentRoot sendiri
            // (penjangkaran AR, hasil tap-to-place). Dunia = contentRoot transform
            // diterapkan pada lokal — kalau dua-dua ni waras tapi obj@commit (dunia)
            // masih jauh, puncanya DI SINI, bukan objek/controller.
            arDebug.commitObjLocalPos = hitModel.position.clone();
            arDebug.commitContentRootPos = contentRoot.position.clone();
            arDebug.commitContentRootRotDeg = new THREE.Vector3(
                THREE.MathUtils.radToDeg(contentRoot.rotation.x),
                THREE.MathUtils.radToDeg(contentRoot.rotation.y),
                THREE.MathUtils.radToDeg(contentRoot.rotation.z)
            );
            arRawController = controller;
            effectiveController = proxy;
        }

        const controllerWorldPosStart = new THREE.Vector3();
        const controllerWorldQuatInvStart = new THREE.Quaternion();
        effectiveController.getWorldPosition(controllerWorldPosStart);
        effectiveController.getWorldQuaternion(controllerWorldQuatInvStart).invert();

        // Nisbah gerak ikut saiz objek (mod 'move' VR sahaja) — lihat nota GRAB_GAIN_* di
        // atas. TAK terpakai utk AR: proksi jarak-tetap di atas dah bagi pergerakan 1:1
        // sepadan unit dunia-nyata (sama konsep dgn mouse-grab desktop, bukan isu
        // "controller gerak sikit drpd objek besar" yg GRAB_GAIN_* selesaikan utk VR).
        const moveGain = arGrabDistance !== null ? 1 : computeMoveGain(Math.max(objSize.x, objSize.y, objSize.z));

        appState.grabStartState = buildGrabStartState({
            mode,
            controller: effectiveController,
            objWorldPosStart,
            objWorldQuatStart,
            controllerWorldPosStart,
            controllerWorldQuatInvStart,
            prevLinearDamping,
            prevAngularDamping,
            moveGain,
            arGrabDistance,
            arRawController
        });
    }

    // Cuba cipta calon genggam tertunda drpd controller ni SEKARANG — diekstrak drpd
    // onControllerSelectStart supaya checkARTouchAwaitingGrab (di bawah) boleh cuba
    // SEMULA setiap bingkai guna logik SAMA, bukan hanya sekali di saat selectstart.
    // Pulangkan true kalau berjaya cipta calon.
    function tryCreateGrabCandidate(controller) {
        const isPreviewMode = getIsPreviewMode();
        const isARSession = getIsARSession();
        const vrPendingGrabCandidate = getVrPendingGrabCandidate();
        if (!isPreviewMode || appState.grabbedObject || vrPendingGrabCandidate) return false;

        const hitModel = getControllerGrabRaycastHit(controller);
        if (isARSession) arDebug.lastHitOnSelectStart = hitModel ? (hitModel.name || hitModel.userData.id || '(unnamed)') : '(tiada hit grabbable)';
        if (!hitModel) return false;

        const mode = controller.userData.handedness === 'left' ? 'rotate' : 'move';
        const startWorldPos = new THREE.Vector3();
        const startWorldQuat = new THREE.Quaternion();
        controller.getWorldPosition(startWorldPos);
        controller.getWorldQuaternion(startWorldQuat);

        if (isARSession) { arDebug.pendingMode = mode; arDebug.pendingMaxAngleDeg = 0; arDebug.pendingMaxDist = 0; }
        setVrPendingGrabCandidate({ hitModel, controller, mode, startWorldPos, startWorldQuat, startTime: performance.now() });
        return true;
    }

    function onControllerSelectStart(event) {
        const isARSession = getIsARSession();
        if (isARSession) {
            arDebug.selectStartCount++;
            arDebug.lastTargetRayMode = event.target.userData.targetRayMode;
            arDebug.lastHandedness = event.target.userData.handedness;
        }
        const isPreviewMode = getIsPreviewMode();
        if (!isPreviewMode || appState.grabbedObject || getVrPendingGrabCandidate()) {
            if (isARSession) arDebug.lastHitOnSelectStart = '(skip: ' + (!isPreviewMode ? 'bukan preview' : appState.grabbedObject ? 'dah genggam' : 'dah pending') + ')';
            return;
        }
        if (isARSession && !getIsPlaced()) {
            arDebug.lastHitOnSelectStart = '(skip: belum placed)';
            return;
        }

        const controller = event.target;
        const created = tryCreateGrabCandidate(controller);

        // AR tap skrin: ray pada bingkai TEPAT jari turun kadang tersasar sikit drpd
        // objek (touch-down bukan genap-genap kena), walhal laser/klik kemudian memang
        // kena objek betul (dikesan setiap bingkai sepanjang sentuhan). Data HUD sebenar
        // (2026-10-29) sahkan: hit@start kosong tapi hit@click (raycast sama, bingkai
        // lain) kena objek yg SAMA, isGrabbable disahkan TRUE oleh pengguna (dah lama
        // berfungsi di VR/PC). Jangan putus asa kat bingkai pertama — tandakan sentuhan
        // ni "menunggu" dan cuba lagi SETIAP bingkai (checkARTouchAwaitingGrab) selagi
        // jari belum diangkat (onControllerSelectEnd buang tanda ni).
        if (!created && isARSession && controller.userData.targetRayMode === 'screen') {
            controller.userData.arTouchAwaitingHit = true;
        }
    }

    // Dipanggil SETIAP BINGKAI (animate()) — lihat nota kat tryCreateGrabCandidate/
    // onControllerSelectStart. Hanya utk tap skrin AR yg terlepas kat bingkai pertama.
    function checkARTouchAwaitingGrab(controller1, controller2) {
        if (!getIsARSession() || !getIsPreviewMode() || appState.grabbedObject || getVrPendingGrabCandidate()) return;
        [controller1, controller2].forEach(ctrl => {
            if (!ctrl.userData.arTouchAwaitingHit) return;
            if (appState.grabbedObject || getVrPendingGrabCandidate()) return;
            if (tryCreateGrabCandidate(ctrl)) ctrl.userData.arTouchAwaitingHit = false;
        });
    }

    // Dipanggil SETIAP BINGKAI (animate()) selagi ada calon genggam tertunda — sah
    // jadi genggaman SEBENAR sebaik controller betul-betul bergerak/berputar melepasi
    // threshold (bukan terus di selectstart). Rujukan P-controller (controllerWorldPosStart
    // dll, dlm commitVRGrab) sengaja dikira PADA SAAT commit ni, bukan saat selectstart
    // asal — elak lonjakan mengejut drpd kedudukan controller yg dah berubah sepanjang
    // tempoh menunggu threshold.
    function checkVRPendingGrabCommit() {
        const pending = getVrPendingGrabCandidate();
        if (!pending) return;
        const { controller, mode, startWorldPos, startWorldQuat } = pending;
        const isARSession = getIsARSession();

        // AR tap skrin: kedudukan DUNIA controller "transient-pointer" kekal hampir
        // statik (terikat kamera) walau jari diseret — threshold JARAK (macam VR hand
        // controller) nyaris tak pernah tercapai, punca "tak boleh genggam langsung
        // dlm AR". ARAH ray pula berubah banyak bila jari diseret — guna threshold
        // SUDUT (macam mod rotate) utk kesan niat drag dlm AR gantinya.
        const useAngleThreshold = mode === 'rotate' ||
            (isARSession && mode === 'move' && controller.userData.targetRayMode === 'screen');

        // DIAGNOSTIK AR — jejak SUDUT & JARAK sebenar setiap bingkai semasa pending
        // (tak kira threshold mana dipakai) supaya HUD boleh tunjuk nombor SEBENAR
        // yang dicapai, utk sahkan sama ada controller/ray AR langsung berubah semasa
        // hold ATAU terus pegun (dua kemungkinan punca "hold tak jadi apa2" yang beza).
        if (isARSession) {
            const qDbg = new THREE.Quaternion();
            controller.getWorldQuaternion(qDbg);
            const angleDbg = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(startWorldQuat.dot(qDbg)), -1, 1));
            arDebug.pendingMaxAngleDeg = Math.max(arDebug.pendingMaxAngleDeg, angleDbg * 180 / Math.PI);
            const pDbg = new THREE.Vector3();
            controller.getWorldPosition(pDbg);
            arDebug.pendingMaxDist = Math.max(arDebug.pendingMaxDist, pDbg.distanceTo(startWorldPos));
        }

        if (useAngleThreshold) {
            const isARScreenMove = isARSession && mode === 'move' && controller.userData.targetRayMode === 'screen';
            const angleThreshold = isARScreenMove ? AR_SCREEN_GRAB_ANGLE_THRESHOLD : VR_GRAB_ANGLE_THRESHOLD;
            const q = new THREE.Quaternion();
            controller.getWorldQuaternion(q);
            const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(startWorldQuat.dot(q)), -1, 1));
            if (angle < angleThreshold) return;
            // AR tap skrin SAHAJA — ambang sudut rendah (~1°) perlu utk benarkan
            // drag sengaja bermula CEPAT, tapi gegaran tangan semula jadi semasa
            // ketukan PENDEK pun cukup utk lepasi ambang tu sekarang pergerakan
            // sebenar dah berfungsi (sebelum ni "silap klasifikasi jadi drag" tak
            // nampak sbb proksi pecah, objek tak bergerak langsung pun). Tambah
            // ambang MASA minimum (bukan ganti ambang sudut, SERTA dgn ia) — ketukan
            // ringkas secara semula jadi singkat, drag sengaja perlukan sekurang2
            // tempoh ni utk "terasa" sengaja. Lapoan pengguna 2026-10-30: "tak dapat
            // bezakan tap/click dgn drag" lepas pergerakan mula berfungsi.
            if (isARScreenMove && (performance.now() - pending.startTime) < AR_SCREEN_GRAB_MIN_HOLD_MS) return;
        } else {
            const p = new THREE.Vector3();
            controller.getWorldPosition(p);
            if (p.distanceTo(startWorldPos) < VR_GRAB_POS_THRESHOLD) return;
        }

        setVrPendingGrabCandidate(null);
        if (isARSession) { arDebug.lastCommitMode = mode; arDebug.lastCommitAt = performance.now(); }
        commitVRGrab(pending);
    }

    function onControllerSelectEnd(event) {
        const isARSession = getIsARSession();
        if (isARSession) arDebug.selectEndCount++;
        if (event && event.target) event.target.userData.arTouchAwaitingHit = false;

        const vrPendingGrabCandidate = getVrPendingGrabCandidate();
        // Calon genggam VR tak pernah melepasi threshold (lihat checkVRPendingGrabCommit)
        // — ni KLIK tulen, bukan niat genggam. Biar laluan 'select' (onControllerSelect)
        // cetus onClick macam biasa (justReleasedGrab KEKAL false di bawah).
        if (vrPendingGrabCandidate && (!event || vrPendingGrabCandidate.controller === event.target)) {
            if (isARSession) arDebug.pendingMode = '(klik — threshold x tercapai)';
            setVrPendingGrabCandidate(null);
            return;
        }
        if (!appState.grabbedObject) return;

        const obj = appState.grabbedObject;
        const mode = appState.grabStartState ? appState.grabStartState.mode : 'move';

        const releasedBody = obj.userData._physicsBody;
        if (releasedBody && appState.grabStartState && appState.grabStartState.prevLinearDamping !== null) {
            releasedBody.linearDamping = appState.grabStartState.prevLinearDamping;
            releasedBody.angularDamping = appState.grabStartState.prevAngularDamping;
        }

        let docked = false;
        if (mode === 'move') {
            docked = checkPlacementZones(obj);
        }

        if (!docked && obj.userData.returnToOriginalOnRelease) {
            returnObjectToOriginalTransform(obj);
        }

        appState.grabbedObject = null;
        appState.grabStartState = null;
        justReleasedGrab = true;
        scheduleAutoSave();
    }

    function onControllerSelect(event) {
        const isPreviewMode = getIsPreviewMode();
        if (!isPreviewMode) return;

        const isARSession = getIsARSession();
        if (isARSession) arDebug.selectCount++;

        // Jgn andaikan 'selectend' SEMESTINYA cetus dahulu drpd 'select' — utk
        // transient-pointer (tap skrin AR) susunan tu tak konsisten antara
        // pelaksanaan. Semak appState.grabbedObject SEKARANG (masih di-set kalau 'select'
        // tiba dulu) SERTA justReleasedGrab (di-set kalau 'selectend' dah pun
        // jalan) — dua-dua perlu disemak utk redam onClick lepas drag/genggam,
        // tanpa kira urutan sebenar event ni ditembak oleh runtime WebXR.
        // Hadkan semakan ni pada controller yg SEDANG genggam shj (bandingkan
        // event.target) — supaya controller LAIN (tangan sebelah, VR dua-tangan)
        // masih boleh onClick objek lain macam biasa walaupun satu tangan tengah
        // drag sesuatu.
        if (appState.grabbedObject && appState.grabStartState &&
            (event.target === appState.grabStartState.controller || event.target === appState.grabStartState.arRawController)) {
            return;
        }
        if (justReleasedGrab) {
            justReleasedGrab = false;
            return;
        }

        if (isARSession && !getIsPlaced()) {
            if (getReticle().visible) placeContentAtReticle();
            return;
        }

        const hitModel = getControllerRaycastHit(event.target);
        if (isARSession) arDebug.lastHitOnSelect = hitModel ? (hitModel.name || hitModel.userData.id || '(unnamed)') : '(none)';
        if (hitModel) {
            triggerInteraction(hitModel, 'onClick');
        }
    }

    // ---- Pasang listener tetikus (desktop) — klik/hover/genggam ----
    function setupPointerInteraction() {
        const renderer = getRenderer();

        renderer.domElement.addEventListener('pointerdown', (event) => {
            const mainCamera = getMainCamera();
            const scene = getScene();
            const contentRoot = getContentRoot();
            const loadedModelsList = getLoadedModelsList();

            pointerDownPos.x = event.clientX;
            pointerDownPos.y = event.clientY;

            // GENGGAM MOUSE (Desktop Preview, bukan sesi XR) — JANGAN genggam serta-merta pada
            // pointerdown (itu buat objek "Boleh Diambil" TAK PERNAH boleh diklik untuk
            // interaksi — setiap sentuhan dianggap genggam walaupun tak digerakkan langsung).
            // Simpan sebagai CALON dulu; genggaman sebenar cuma bermula kalau mouse betul-betul
            // bergerak melepasi threshold 5px (lihat pointermove) — kalau tidak (klik tulen,
            // tiada drag), pointerup jatuh terus ke laluan klik/onClick biasa di bawah.
            if (getIsPreviewMode() && !renderer.xr.isPresenting && !appState.grabbedObject && event.button === 0) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, mainCamera);

                const grabTargets = loadedModelsList.filter(o => o.visible && o.userData.isGrabbable);
                const intersects = raycaster.intersectObjects(grabTargets, true);
                if (intersects.length > 0) {
                    let hitModel = intersects[0].object;
                    while (hitModel.parent && hitModel.parent !== scene && hitModel.parent !== contentRoot) {
                        hitModel = hitModel.parent;
                    }
                    if (hitModel.userData.isGrabbable) {
                        pendingGrabCandidate = { hitModel, point: intersects[0].point.clone() };
                        // Pastikan pointerup/pointermove terus sasar canvas ni walaupun kursor
                        // bergerak keluar sempadannya semasa drag (elak objek "tersangkut" genggam).
                        try { renderer.domElement.setPointerCapture(event.pointerId); } catch (e) {}
                    }
                }
            }
        });

        renderer.domElement.addEventListener('pointerup', (event) => {
            const mainCamera = getMainCamera();
            const scene = getScene();
            const contentRoot = getContentRoot();
            const loadedModelsList = getLoadedModelsList();
            const controls = getControls();

            if (event.button !== 0) return;

            if (getIsMouseGrabbing()) {
                setIsMouseGrabbing(false);
                controls.enabled = true;
                try { renderer.domElement.releasePointerCapture(event.pointerId); } catch (e) {}
                onControllerSelectEnd();
                return;
            }

            if (pendingGrabCandidate) {
                // Calon genggam yang tak pernah melepasi threshold drag — ini sebenarnya KLIK
                // tulen pada objek "Boleh Diambil", bukan niat nak drag. Lepaskan capture dan
                // biar ia jatuh terus ke laluan klik biasa di bawah supaya onClick dia (kalau
                // ada) tetap sempat jalan.
                pendingGrabCandidate = null;
                try { renderer.domElement.releasePointerCapture(event.pointerId); } catch (e) {}
            }

            if (getIsDraggingGizmo()) return;

            const deltaX = Math.abs(event.clientX - pointerDownPos.x);
            const deltaY = Math.abs(event.clientY - pointerDownPos.y);

            if (deltaX > 5 || deltaY > 5) return;

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, mainCamera);

            if (getIsPreviewMode()) {
                if (loadedModelsList.length > 0) {
                    const visibleObjects = loadedModelsList.filter(o => o.visible);
                    const intersects = raycaster.intersectObjects(visibleObjects, true);
                    if (intersects.length > 0) {
                        let hitModel = intersects[0].object;
                        while (hitModel.parent && hitModel.parent !== scene && hitModel.parent !== contentRoot) {
                            hitModel = hitModel.parent;
                        }
                        triggerInteraction(hitModel, 'onClick', event.clientX, event.clientY);
                    }
                }
            } else {
                const previewCameraMarker = getPreviewCameraMarker();
                const targets = [...loadedModelsList, previewCameraMarker];
                const intersects = raycaster.intersectObjects(targets, true);

                if (intersects.length > 0) {
                    let hitModel = intersects[0].object;
                    while (hitModel.parent && hitModel.parent !== scene && hitModel.parent !== contentRoot) {
                        hitModel = hitModel.parent;
                    }
                    selectObject(hitModel);
                } else {
                    deselectObject();
                }
            }
        });

        // HOVER EVENT
        renderer.domElement.addEventListener('pointermove', (event) => {
            if (!getIsPreviewMode()) return;

            const mainCamera = getMainCamera();
            const scene = getScene();
            const contentRoot = getContentRoot();
            const loadedModelsList = getLoadedModelsList();

            // Ada calon genggam tertunda (pointerdown kena objek Boleh Diambil) — cuma SAHKAN
            // jadi genggaman sebenar bila mouse betul-betul bergerak melepasi threshold 5px
            // (sama macam threshold klik). Sementara belum melepasi, anggap ia masih mungkin
            // klik tulen — jangan proses hover lagi (elak gangguan visual semasa menunggu).
            if (pendingGrabCandidate && !getIsMouseGrabbing()) {
                const dX = Math.abs(event.clientX - pointerDownPos.x);
                const dY = Math.abs(event.clientY - pointerDownPos.y);
                if (dX > 5 || dY > 5) {
                    startMouseGrab(pendingGrabCandidate.hitModel, pendingGrabCandidate.point);
                    pendingGrabCandidate = null;
                } else {
                    return;
                }
            }

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, mainCamera);

            // Sedang genggam objek (mouse) — kemaskan sasaran proksi ikut titik persilangan
            // mouse-ray dengan satah genggaman, bukan hover (hover tak relevan masa menggenggam).
            // lerp (bukan copy terus) — redam bunyi/lonjakan kecil pada sudut condong satah
            // yang buat titik persilangan melompat walaupun gerakan mouse kecil sahaja.
            if (getIsMouseGrabbing() && appState.grabbedObject) {
                const target = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(mouseGrabPlane, target)) {
                    mouseGrabProxy.position.lerp(target, 0.6);
                }
                return;
            }

            let hitModel = null;
            if (loadedModelsList.length > 0) {
                const visibleObjects = loadedModelsList.filter(o => o.visible);
                const intersects = raycaster.intersectObjects(visibleObjects, true);

                if (intersects.length > 0) {
                    hitModel = intersects[0].object;
                    while (hitModel.parent && hitModel.parent !== scene && hitModel.parent !== contentRoot) {
                        hitModel = hitModel.parent;
                    }
                }
            }

            const hoveredModel = getHoveredModel();
            if (hitModel !== hoveredModel) {
                setHoveredModel(hitModel);
                clearPopupHideTimer();
                getInfoPopup().style.display = 'none';

                if (hitModel) {
                    triggerInteraction(hitModel, 'onHover', event.clientX, event.clientY);
                }
            }
        });
    }

    return {
        setupPointerInteraction,
        startMouseGrab, commitVRGrab, tryCreateGrabCandidate, onControllerSelectStart,
        checkARTouchAwaitingGrab, checkVRPendingGrabCommit, onControllerSelectEnd, onControllerSelect
    };
}
