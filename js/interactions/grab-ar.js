// Logik genggam KHUSUS AR tap-skrin (proksi jarak-tetap sepanjang ray controller).
// Diekstrak dari index.html. JANGAN import grab-core.js dari sini (elak circular — lihat
// js/core/state.js); kalau kod sini perlu state kongsi app-wide pada masa depan, import
// terus dari js/core/state.js, bukan menerusi grab-core.js.
//
// AR (tap skrin telefon): input source "transient-pointer" webXR TAK berkelakuan
// macam controller tangan VR — kedudukan DUNIA die kekal hampir statik (terikat
// kamera/telefon), cuma ARAH ray berubah bila jari diseret atas skrin. Pendekatan
// mod 'move' asal (deltaPos dari kedudukan controller sebenar) sentiasa dapat
// deltaPos ~0 utk AR walau macam mana jari digerakkan — punca sebenar "tak boleh
// genggam langsung dlm AR" (bukan isu gain/kelajuan macam VR).
//
// PERCUBAAN #1 (dibuang): ray-plane intersection (satah tegak lurus arah kamera).
// Perlukan bacaan "arah kamera SEMASA" setiap bingkai yang boleh dipercayai — selepas
// 7 percubaan (#21-#27, lihat memori vr_grab_gravity_fix) cuba pelbagai cara baca
// arah kamera (mainCamera.getWorldDirection, frame.getViewerPose, gabung cameraRig),
// denom (sudut ray lawan satah) tetap TAK MASUK AKAL (stabil tapi songsang, ~-0.96,
// patut ~+0.96) — bug jenis timing/reference-frame WebXR yang sukar disahkan tanpa
// devtools sebenar. BUKAN pendekatan mantap utk kes ni.
//
// PERCUBAAN #2 (SEKARANG): kekalkan proksi pada JARAK TETAP sepanjang ray controller
// (ditetapkan SEKALI di commitVRGrab, drpd jarak controller->objek masa genggam
// bermula) — proxy = rayOrigin + rayDirection.normalize() * jarakTetap, dikemaskini
// setiap bingkai. TIADA satah, TIADA arah kamera langsung — cuma bergantung pada ray
// controller SENDIRI (kedudukan + arah), yang SUDAH terbukti betul sepanjang saga ni
// (laser/penanda hover sentiasa kena objek dgn tepat, guna teknik SAMA). Jauh lebih
// ringkas & tahan lasak: tiada kes degenerat (selari/songsang satah), tiada bahagi
// dgn nombor hampir sifar. Objek kekal jarak SAMA dari kamera sepanjang seretan,
// bergerak sisi/atas-bawah ikut ke mana ray dihalakan — serupa teknik "holographic
// drag" biasa dlm apl AR lain.
export const AR_SCREEN_GRAB_ANGLE_THRESHOLD = 0.0175; // radian ~1° — mod 'move' AR tap skrin sahaja
// Ambang MASA minimum (ms) SERTA dgn ambang sudut di atas (bukan ganti) — lihat
// nota penuh dlm checkVRPendingGrabCommit (index.html). Ketukan ringkas secara semula
// jadi singkat; seretan sengaja perlu sekurang2 tempoh ni utk dikira niat drag.
export const AR_SCREEN_GRAB_MIN_HOLD_MS = 180;

// AR tap skrin SAHAJA — proxy ray-plane (AR_GRAB_PROXY_SMOOTHING di bawah) dah tapis
// sedikit gegaran, tapi GRAB_VELOCITY_BLEND=1 (grab-core.js, sengaja, jangan ubah) bermakna
// body.velocity TERUS tukar penuh ikut sasaran setiap bingkai tanpa tapisan tambahan
// langsung, jadi bunyi/gegaran yang tinggal lepas smoothing proxy masih "bocor" penuh ke
// pergerakan objek sebenar — punca laporan "random movement, kadang rotate sendiri, kadang
// menjauh/mendekat" (2026-10-29). JANGAN ubah GRAB_VELOCITY_BLEND di grab-core.js (shared
// dgn VR/desktop, dah ditala dgn teliti) — guna constant BERASINGAN ni khusus laluan
// proksi AR sahaja.
export const AR_GRAB_VELOCITY_BLEND = 0.3;
// Tapis gegaran — lihat nota di atas (masih relevan: ray AR tap skrin bergantung pada
// orientasi tangan/telefon SEBENAR, bukan cuma kedudukan jari atas skrin, jadi gegaran
// tangan halus pun jadi pergerakan ketara pada jarak).
export const AR_GRAB_PROXY_SMOOTHING = 0.35;
// Had jarak lonjakan setiap bingkai (meter) — jaring keselamatan terhadap ralat
// berangka hujung (bukan sepatutnya tercetus langsung dgn teknik jarak-tetap ni,
// sbb tiada kes degenerat/pembahagian — tapi kekalkan sebagai lapisan selamat).
export const AR_GRAB_MAX_JUMP_PER_FRAME = 1.5;

// Factory sebab computeARGrabDistance/updateARGrabProxy guna objek THREE (Vector3/Object3D/
// Matrix4) SEMENTARA yang dikitar semula setiap bingkai (updateARGrabProxy) — THREE
// (bridge ESM index.html) dihantar sebagai parameter factory, bukan diandaikan wujud pada
// waktu fail ni di-load.
export function createArGrab({ THREE }) {
    function computeARGrabDistance(rawController, objWorldPos) {
        const rayOrigin = new THREE.Vector3();
        rawController.getWorldPosition(rayOrigin);
        const proxy = new THREE.Object3D();
        proxy.position.copy(objWorldPos);
        // EKSPERIMEN (cadangan Gemini) — had bawah 0.3m elak objek "terlekat" kat
        // jarak hampir-sifar. Tak berkaitan isu ~7-8m yg disahkan (itu terlalu BESAR,
        // bukan terlalu kecil) — kekal sbb tak merosakkan apa-apa.
        const dist = Math.max(rayOrigin.distanceTo(objWorldPos), 0.3);
        return { proxy, distance: dist };
    }

    const _arRayOrigin = new THREE.Vector3();
    const _arRayDir = new THREE.Vector3();
    const _arHitPoint = new THREE.Vector3();
    const _arCamPos = new THREE.Vector3();
    const _arMat = new THREE.Matrix4();
    function updateARGrabProxy(st, { mainCamera, arDebug }) {
        st.arRawController.getWorldPosition(_arRayOrigin);
        // EKSPERIMEN (cadangan Gemini, 2026-10-30) — ekstrak arah -Z guna matrix terus
        // (sama teknik dgn getControllerRaycastHit) dgn-pada getWorldDirection(). Secara
        // teori patut hasilkan nilai SAMA (getWorldDirection() three.js memang pulangkan
        // -Z dunia, bukan +Z macam dakwaan Gemini) — cuba empirik, bukan sbb kami rasa
        // diagnosis asal Gemini betul.
        _arMat.identity().extractRotation(st.arRawController.matrixWorld);
        _arRayDir.set(0, 0, -1).applyMatrix4(_arMat).normalize();
        _arHitPoint.copy(_arRayOrigin).addScaledVector(_arRayDir, st.arGrabDistance);

        // DIAGNOSTIK — grabDistance tekal ~7m walau objek nampak ~1m dlm skrin,
        // tak berubah lepas tukar anchor pivot->pusat kotak sempadan (attempt #30),
        // jadi punca mesti di hujung LAIN pengukuran (origin ray, bukan objek).
        // Banding terus kedudukan DUNIA kamera lawan kedudukan DUNIA controller raw
        // SETIAP bingkai — patut hampir SAMA (ray AR tap skrin "terikat kamera")
        // kalau andaian asal (attempt #11) betul. BUANG lepas bug disahkan.
        mainCamera.getWorldPosition(_arCamPos);
        arDebug.camControllerDist = _arCamPos.distanceTo(_arRayOrigin);

        const jump = _arHitPoint.distanceTo(st.controller.position);
        arDebug.proxyJump = jump;
        // EKSPERIMEN (cadangan Gemini) — snap TERUS walau lonjakan besar, bukan tolak.
        // AMARAN: objVisualCenter/grabDistance masih DISAHKAN salah (~7-8m, lihat
        // attempt #30-33) — snap ni akan hantar objek TERUS ke kedudukan SALAH tu
        // (bukan "betulkan drag", sebaliknya buat objek "terbang" nampak jelas). Guna
        // sbb tiada kerosakan tak boleh diundur (git), bukan sbb kami yakin ni fix
        // sebenar — lihat apa yang berlaku sbg DATA, bukan terima terus sbg fix.
        if (jump > AR_GRAB_MAX_JUMP_PER_FRAME) {
            st.controller.position.copy(_arHitPoint);
            arDebug.proxyReject = 'snap';
            return;
        }
        arDebug.proxyReject = 'ok';
        st.controller.position.lerp(_arHitPoint, AR_GRAB_PROXY_SMOOTHING);
    }

    return { computeARGrabDistance, updateARGrabProxy };
}
