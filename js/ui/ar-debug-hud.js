// HUD DIAGNOSTIK SEMENTARA (lihat <div id="ar-debug-hud"> di index.html) — dulu utk "hold
// tap dekat objek tak jadi apa2" dlm AR telefon yg tak boleh disahkan tanpa devtools
// sebenar. Diekstrak dari index.html. Bug AR grab yg HUD ni didiagnosis DAH DISAHKAN
// SELESAI (2026-10-30) — dimatikan terus via ENABLE_DEBUG_HUD di bawah (bukan dibuang
// terus) sebab arDebug.xxx masih ditulis dari grab-core.js/grab-ar.js/pointer-grab.js
// sbg instrumentasi (murah, counter/state sahaja) — buang fail ni sepenuhnya akan perlu
// bersihkan semua titik tulis tu jugak. Tukar ENABLE_DEBUG_HUD = true balik utk
// debug AR grab pd masa depan tanpa perlu redo kerja tu.
const ENABLE_DEBUG_HUD = false;
export const AR_DEBUG_BUILD = '41';
export const arDebug = {
    selectCount: 0, selectStartCount: 0, selectEndCount: 0,
    lastTargetRayMode: undefined, lastHandedness: undefined,
    lastHitOnSelect: null, lastHitOnSelectStart: null,
    pendingMode: null, pendingMaxAngleDeg: 0, pendingMaxDist: 0,
    lastCommitMode: null, lastCommitAt: 0,
    proxyJump: 0, proxyReject: '-', camControllerDist: 0,
    commitObjPos: null, commitCtrlPos: null,
    commitObjLocalPos: null, commitContentRootPos: null, commitContentRootRotDeg: null
};

// HUD DOM (<div id="ar-debug-hud">) bergantung pada ciri 'dom-overlay' WebXR — disahkan
// pengguna "tiada hud" walau lepas domOverlay:{root} diaktifkan, jadi kemungkinan besar
// browser/peranti ni TAK sokong dom-overlay langsung (bukan semua browser WebXR sokong).
// Papar jugak versi WebGL (sprite teks dilukis atas <canvas>, dilekat pada mainCamera
// supaya head-locked) — tak bergantung pada dom-overlay SAMA SEKALI, sama macam
// laser/dot/ring controller yang dah terbukti sentiasa nampak dlm AR/VR.
export function createArDebugHud({ THREE, mainCamera, arDebugHud }) {
    if (!ENABLE_DEBUG_HUD) {
        return { updateARDebugHud: () => {} };
    }

    const arDebugCanvas = document.createElement('canvas');
    arDebugCanvas.width = 640; arDebugCanvas.height = 320;
    const arDebugCtx = arDebugCanvas.getContext('2d');
    const arDebugTexture = new THREE.CanvasTexture(arDebugCanvas);
    // Panel 0.4m lebar pada 0.4m jarak = ~53° sudut tampak (hampir SEPARUH FOV
    // kamera telefon) — itu sebab nampak macam kotak gelap besar menutup
    // separuh skrin, bukan HUD sudut kecil macam disangka. 0.18m pada jarak
    // SAMA (0.4m) ≈ 25° sudut tampak — jauh lebih munasabah utk panel sudut.
    const arDebugSprite = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.09),
        new THREE.MeshBasicMaterial({ map: arDebugTexture, transparent: true, depthTest: false, depthWrite: false })
    );
    arDebugSprite.renderOrder = 99999;
    arDebugSprite.position.set(-0.12, -0.08, -0.4); // tepi KIRI BAWAH — elak kamera depan/notch telefon (atas-tengah)
    arDebugSprite.visible = false;
    mainCamera.add(arDebugSprite);

    function updateARDebugHud({ isPreviewMode, isARSession, isPresenting, vrPendingGrabCandidate, grabbedObject, grabStartState }) {
        const active = isPreviewMode && isARSession && isPresenting;
        // dom-overlay didapati BERFUNGSI selepas semua (lain drpd andaian awal) —
        // 2 HUD terpapar serentak (DOM + sprite WebGL ni) cuma mengelirukan, bukan
        // punca masalah grab. Lumpuhkan sprite 3D, DOM sahaja cukup.
        arDebugSprite.visible = false;
        if (arDebugHud.style.display !== (active ? 'block' : 'none')) {
            arDebugHud.style.display = active ? 'block' : 'none';
        }
        if (!active) return;

        const lines = [
            'AR GRAB DEBUG (build ' + AR_DEBUG_BUILD + ')',
            'start/sel/end: ' + arDebug.selectStartCount + '/' + arDebug.selectCount + '/' + arDebug.selectEndCount,
            'rayMode:' + arDebug.lastTargetRayMode + '  hand:' + arDebug.lastHandedness,
            'hit@start: ' + arDebug.lastHitOnSelectStart,
            'hit@click: ' + arDebug.lastHitOnSelect,
            'pending: ' + (vrPendingGrabCandidate ? arDebug.pendingMode : (arDebug.pendingMode || '-')),
            'maxAngle: ' + arDebug.pendingMaxAngleDeg.toFixed(1) + 'deg  maxDist: ' + arDebug.pendingMaxDist.toFixed(3) + 'm',
            'grabbed: ' + (grabbedObject ? (grabbedObject.name || '(unnamed)') : '-') + '  commit: ' + (arDebug.lastCommitMode || '-'),
            'proxy jump:' + arDebug.proxyJump.toFixed(3) + 'm  ' + arDebug.proxyReject,
            'grabDistance: ' + (grabStartState && grabStartState.arRawController ? grabStartState.arGrabDistance.toFixed(3) + 'm' : '-'),
            'camVsController: ' + arDebug.camControllerDist.toFixed(3) + 'm',
            'obj@commit: ' + (arDebug.commitObjPos ? arDebug.commitObjPos.x.toFixed(2) + ',' + arDebug.commitObjPos.y.toFixed(2) + ',' + arDebug.commitObjPos.z.toFixed(2) : '-'),
            'ctrl@commit: ' + (arDebug.commitCtrlPos ? arDebug.commitCtrlPos.x.toFixed(2) + ',' + arDebug.commitCtrlPos.y.toFixed(2) + ',' + arDebug.commitCtrlPos.z.toFixed(2) : '-'),
            'objLocal: ' + (arDebug.commitObjLocalPos ? arDebug.commitObjLocalPos.x.toFixed(2) + ',' + arDebug.commitObjLocalPos.y.toFixed(2) + ',' + arDebug.commitObjLocalPos.z.toFixed(2) : '-'),
            'rootPos: ' + (arDebug.commitContentRootPos ? arDebug.commitContentRootPos.x.toFixed(2) + ',' + arDebug.commitContentRootPos.y.toFixed(2) + ',' + arDebug.commitContentRootPos.z.toFixed(2) : '-'),
            'rootRotDeg: ' + (arDebug.commitContentRootRotDeg ? arDebug.commitContentRootRotDeg.x.toFixed(0) + ',' + arDebug.commitContentRootRotDeg.y.toFixed(0) + ',' + arDebug.commitContentRootRotDeg.z.toFixed(0) : '-')
        ];

        arDebugHud.textContent = lines.join('\n');

        const ctx = arDebugCtx;
        ctx.clearRect(0, 0, arDebugCanvas.width, arDebugCanvas.height);
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(0, 0, arDebugCanvas.width, arDebugCanvas.height);
        ctx.fillStyle = '#00ff66';
        ctx.font = '20px monospace';
        lines.forEach((line, i) => ctx.fillText(line, 10, 28 + i * 26));
        arDebugTexture.needsUpdate = true;
    }

    return { updateARDebugHud };
}
