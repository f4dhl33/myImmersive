// Logik genggam KONGSI — dipakai VR controller, AR tap skrin, DAN mouse desktop (ketiga-tiga
// laluan commit grab berbeza di index.html panggil fungsi SAMA di sini). Diekstrak dari
// index.html. JANGAN import grab-ar.js dari sini (elak circular — lihat js/core/state.js);
// apa-apa nilai khusus AR (cth AR_GRAB_VELOCITY_BLEND) dihantar MASUK sebagai parameter
// oleh index.html, bukan diimport terus dari grab-ar.js.

// GENGGAM + FIZIK — bila objek "Boleh Diambil" digenggam, ia SENTIASA kekal sebagai
// badan dinamik cannon.js (bukan diteleport terus) — mod gerak halakan velocity
// badan ke arah sasaran (P-controller dipotong had laju), supaya cuba tarik objek
// menembusi objek "Pepejal" akan disekat oleh pelanggaran fizik sebenar, bukan tembus
// terus. Bila dilepas, graviti + pelanggaran + bounce (cannon.js) ambil alih terus —
// tiada lagi "snap ke kedudukan asal" macam dulu.
// SEBAB "gerak tu terlalu lambat respon berbanding pergerakan controller" (VR):
// diuji guna replika fizik (controller digerak terus, bukan guna mouse) simulasi
// ayunan tangan sederhana (1m dlm 0.4s ≈ 2.5 m/s) — had 6 m/s SENTIASA aktif
// (speed sasaran diperlukan selalu jauh lebih tinggi drpd 6, sbb formula "tutup
// jurang SEPENUHNYA dlm satu langkah fizik" (dtSafe ~4-11ms) secara semula jadi
// minta kelajuan sangat tinggi utk jurang kecil pun), jurang kelihatan/jarak
// ketinggalan objek drpd sasaran sampai ~7.5cm semasa ayunan. Naikkan had ke 20
// (diuji: jurang berkurang ~2x kpd ~3.3cm, hampir sama dgn tiada had langsung —
// lebih tinggi drpd 20 tak banyak tolong lagi). Baki jurang ~3cm yg tinggal ni
// PUNCA BERBEZA (ketinggalan "satu sampel" semula jadi bila kejar sasaran yg
// SENTIASA bergerak, berkadar dgn kelajuan tangan × masa bingkai fizik — bukan
// had kelajuan lagi) — diterima sbg kos reka bentuk sedia ada (kekal guna fizik
// sebenar, bukan teleport, supaya objek tak boleh ditarik tembus Pepejal lain).
export const GRAB_MAX_SPEED = 20; // meter/saat

// NISBAH GERAK IKUT SAIZ OBJEK (VR sahaja) — laporan asal: "aku gerakkan controller
// hanya beberapa cm... tetapi objek... besar, panjang cecah 3 meter... macam tak
// bergerak." Disahkan betul: deltaPos SEBELUM ni 1:1 terus jarak controller SEBENAR
// (meter dunia nyata dari WebXR) ke jarak objek, TIADA pekali nisbah langsung tak
// kira saiz objek. Lepas gandaan pertama (1x..8x, rujukan 1m..8m) masih "terasa
// kurang", pengguna minta lengkung lagi agresif: 1m=1x (tepat), 4m=8x, 8m=16x
// (gandaan saiz dua kali ganda -> gandaan nisbah dua kali ganda, utk saiz >4m).
// computeMoveGain() di bawah: lengkung kuasa 1.5 utk 1m..4m (size^1.5 — sepadan
// TEPAT pd kedua-dua hujung: 1^1.5=1, 4^1.5=8), terus LINEAR (gain = 2×saiz) bagi
// saiz >4m supaya corak "saiz 2x -> gandaan 2x" pengguna minta berterusan utk
// objek lagi besar (8m->16x, 16m->32x, dst.), plafond keselamatan GRAB_GAIN_MAX
// (bukan reka-reka — cuma had atas munasabah, pengguna belum nyatakan had).
// Dikira SEKALI sahaja semasa commitVRGrab (saiz objek tak berubah sepanjang
// genggaman). PENTING — had kelajuan GRAB_MAX_SPEED kena digandakan SAMA dgn
// moveGain di updateGrabbedObjectTransform (bukan kekal tetap): diuji guna
// replika fizik, pd gandaan tinggi (8x) dgn had kelajuan TAK digandakan, jurang
// ketinggalan melonjak smpai 0.67m (balik isu "lambat" asal). Gandakan had sekali
// dgn moveGain kekalkan jurang kecil (~0.05-0.1m, berkadar kecil drpd jarak
// dicapai) merentasi gandaan 1x hingga 32x (diuji). Mouse (desktop) TAK disentuh —
// laporan ni khusus controller VR; mouse dah guna unjuran skrin-ke-dunia yg
// sedia ada "scale" ikut perspektif, bukan unit meter dunia-nyata tetap.
// 2026-10-29 — pengguna sedang "finesse" nilai ni secara aktif (dah naik dari
// cerun 2 -> 4 -> 10 dalam beberapa pusingan). Guna GRAB_GAIN_GRADIENT sebagai
// SATU-SATUNYA nombor yang perlu dilaras pusingan akan datang — kuasa lengkung
// (1m..CURVE_END) dikira AUTOMATIK drpd GRAB_GAIN_GRADIENT (supaya sambungan ke
// kawasan linear kekal LICIN/tiada lonjakan di CURVE_END, tak kira apa nilai
// cerun dipilih), bukan ditetapkan keras macam sebelum ni (kuasa 2 tetap utk
// cerun=4 sahaja, akan jadi tak licin kalau cerun ditukar tanpa kira semula kuasa
// secara manual).
export const GRAB_GAIN_REFERENCE_SIZE = 1; // meter — objek bersaiz ni & lebih kecil kekal gandaan 1x
export const GRAB_GAIN_CURVE_END = 4;      // meter — hujung lengkung kuasa, permulaan kawasan linear
export const GRAB_GAIN_GRADIENT = 12;      // cerun kawasan linear (saiz > CURVE_END) — LARAS SINI SAHAJA
export const GRAB_GAIN_MAX = 300;          // plafond keselamatan (beri ruang ~30m pd cerun 10)
// Kuasa lengkung dikira drpd GRAB_GAIN_GRADIENT supaya nilai di CURVE_END sentiasa
// sepadan TEPAT dgn permulaan kawasan linear (GRAB_GAIN_GRADIENT × CURVE_END).
export const GRAB_GAIN_CURVE_POWER = Math.log(GRAB_GAIN_GRADIENT * GRAB_GAIN_CURVE_END) / Math.log(GRAB_GAIN_CURVE_END);

export function computeMoveGain(maxDim) {
    if (maxDim <= GRAB_GAIN_REFERENCE_SIZE) return 1;
    const gain = (maxDim <= GRAB_GAIN_CURVE_END)
        ? Math.pow(maxDim, GRAB_GAIN_CURVE_POWER) // 1m..CURVE_END: 1x..(GRADIENT×CURVE_END)x, licin
        : GRAB_GAIN_GRADIENT * maxDim;            // >CURVE_END: linear, cerun GRAB_GAIN_GRADIENT
    return Math.min(gain, GRAB_GAIN_MAX);
}

// SEBAB SEBENAR "trail"/objek rasa terapung-apung di belakang kursor — DIBUKTIKAN
// guna simulasi fizik berasingan (bukan teka): vx/vy/vz di bawah dikira sebagai
// (jurang kedudukan / dtSafe) — ni dah TEPAT (dtSafe = delta bingkai SEBENAR lepas
// fix accumulator), maksudnya terapkan nilai ni SATU langkah je dah cukup tutup
// jurang sepenuhnya, tiada overshoot. Tapi blend (lerp) < 1 kekalkan sebahagian
// velocity LAMA (dikira utk jurang SEBELUM ni, dah lapuk) bersama velocity baru —
// badan terlajak lepas sasaran, lalu kena "patah balik" bingkai seterusnya, patah
// balik tu pula terlajak sikit, dst — ringing/oscillation klasik yang pengguna
// rasa sbg "trail"/bergegar (bukan "slow", tapi "goyang" tak stabil kat sasaran).
// Diuji guna replika fizik berasingan: blend 0.55 -> vy berbalik tanda (+7.27 ->
// +6.15 -> +3.66 -> -0.23 -> -1.85 -> ...) tiap kali sasaran kekal tetap sekejap;
// blend 1.0 -> vy susut terus ke 0 (+7.51 -> +2.75 -> +1.13 -> 0), tiada overshoot.
// Pekali blend LAMA (0.55) wajar balik zaman dtSafe terapung/damping 0.2 aktif
// (nilai "mentah" sentiasa terkurang-anggar, blend jarang nampak kesan) — lepas dua
// fix tu (c064ea4/926eda9) nilai mentah jadi TEPAT, blend yg kekal jadi punca utama.
export const GRAB_VELOCITY_BLEND = 1;

export const VR_GRAB_POS_THRESHOLD = 0.03;   // meter — mod 'move' (controller kanan)
export const VR_GRAB_ANGLE_THRESHOLD = 0.08; // radian ~4.6° — mod 'rotate' (controller kiri, putaran pergelangan tangan sebenar)

// SATU constructor dikongsi oleh KEDUA-DUA laluan commit (VR/AR di commitVRGrab, mouse di
// startMouseGrab) — ni fix SEBENAR utk bug app-hang 2026-10-29: dulu dua object literal
// BERASINGAN bina grabStartState (satu di tiap laluan), mudah "lupa" field (cth lupa
// explicit `arGrabDistance: null` di laluan mouse buat `undefined !== null` jadi TRUE,
// updateARGrabProxy() terpanggil utk mouse-grab, crash baca .getWorldPosition() pada
// arRawController yg sepatutnya null — animate() loop berhenti senyap). Guna SATU fungsi
// ni utk kedua-dua laluan buat shape tu MUSTAHIL drift lagi — default `?? null` di sini
// (bukan di setiap call-site) jadi SATU-SATUNYA tempat default arGrabDistance/
// arRawController perlu diingati.
export function buildGrabStartState({
    mode, controller, objWorldPosStart, objWorldQuatStart,
    controllerWorldPosStart, controllerWorldQuatInvStart,
    prevLinearDamping, prevAngularDamping, moveGain,
    arGrabDistance = null, arRawController = null
}) {
    return {
        mode,
        controller,
        objWorldPosStart,
        objWorldQuatStart,
        controllerWorldPosStart,
        controllerWorldQuatInvStart,
        prevLinearDamping,
        prevAngularDamping,
        moveGain,
        arGrabDistance,
        arRawController
    };
}

// Factory (bukan plain export) sebab fungsi di bawah guna vector/quaternion SEMENTARA
// yang dikitar semula setiap bingkai (elak garbage churn dalam animate() loop) — objek
// THREE.Vector3/Quaternion tu kena dicipta SELEPAS THREE (bridge ESM index.html) sedia,
// bukan pada waktu fail ni di-load, jadi THREE dihantar sebagai parameter factory.
export function createGrabCore({ THREE }) {
    const _grabTmpVec = new THREE.Vector3();
    const _grabTmpQuat = new THREE.Quaternion();
    const _grabTmpQuat2 = new THREE.Quaternion();

    // AR tap skrin SAHAJA — proxy ray-plane (AR_GRAB_PROXY_SMOOTHING, di grab-ar.js) dah
    // tapis sedikit gegaran, tapi GRAB_VELOCITY_BLEND=1 di atas (sengaja, jangan ubah —
    // lihat nota overshoot VR di atas) bermakna body.velocity TERUS tukar penuh ikut
    // sasaran setiap bingkai tanpa tapisan tambahan langsung, jadi bunyi/gegaran yang
    // tinggal lepas smoothing proxy masih "bocor" penuh ke pergerakan objek sebenar —
    // punca laporan "random movement, kadang rotate sendiri, kadang menjauh/mendekat"
    // (2026-10-29). JANGAN ubah GRAB_VELOCITY_BLEND sendiri (shared dgn VR/desktop, dah
    // ditala dgn teliti) — caller (index.html) hantar arVelocityBlend BERASINGAN (dari
    // grab-ar.js) khusus laluan proksi AR sahaja.
    function updateGrabbedObjectTransform(obj, st, delta, { physicsWorld, arVelocityBlend }) {
        if (!obj || !st) return;
        const controller = st.controller;
        const body = obj.userData._physicsBody;

        if (st.mode === 'rotate') {
            controller.getWorldQuaternion(_grabTmpQuat);
            const deltaQuat = st.controllerWorldQuatInvStart.clone().multiply(_grabTmpQuat);
            const newWorldQuat = st.objWorldQuatStart.clone().multiply(deltaQuat);

            obj.parent.getWorldQuaternion(_grabTmpQuat2);
            obj.quaternion.copy(_grabTmpQuat2.invert().multiply(newWorldQuat));

            if (body) {
                body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
                body.velocity.set(0, 0, 0);
                body.angularVelocity.set(0, 0, 0);
            }
        } else {
            controller.getWorldPosition(_grabTmpVec);
            const moveGain = st.moveGain || 1;
            const deltaPos = _grabTmpVec.clone().sub(st.controllerWorldPosStart).multiplyScalar(moveGain);
            const newWorldPos = st.objWorldPosStart.clone().add(deltaPos);
            obj.parent.worldToLocal(newWorldPos);

            // EKSPERIMEN (cadangan Gemini) — AR tap skrin: teleport TERUS badan Cannon
            // ke sasaran setiap bingkai (langkau integrasi velocity/speed-cap/blend sama
            // sekali), bukan cuma "rotate" mode yg dah buat macam ni. AMARAN: ini akan
            // HILANGKAN respons pelanggaran (badan boleh tiris terus menerusi objek
            // Pepejal lain semasa diseret, sbb tiada momentum utk solver cannon.js
            // selesaikan terhadap) — percubaan sbb boleh diundur via git, bukan krn
            // yakin ni jalan betul.
            if (body && st.arRawController) {
                body.position.set(newWorldPos.x, newWorldPos.y, newWorldPos.z);
                body.velocity.set(0, 0, 0);
                body.angularVelocity.set(0, 0, 0);
                obj.position.copy(newWorldPos);
                return;
            }

            if (body) {
                // Guna delta BINGKAI SEBENAR (bukan floor ke 1/60) — floor lama buat
                // dtSafe jadi LEBIH BESAR dari delta tulen di VR (~90Hz, delta≈1/90 <
                // 1/60), jadi kelajuan sasaran (gap/dtSafe) terkurang-anggar ~1.5x
                // secara berterusan, tambah kpd isu damping di atas. Had bawah (1/240)
                // cuma elak bahagi-dgn-sifar; had atas (1/20) elak lonjakan kelajuan
                // kalau ada bingkai tersekat/lag.
                const dtSafe = Math.min(Math.max(delta || 1 / 60, 1 / 240), 1 / 20);
                const vx = (newWorldPos.x - body.position.x) / dtSafe;
                const vy = (newWorldPos.y - body.position.y) / dtSafe;
                const vz = (newWorldPos.z - body.position.z) / dtSafe;
                const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
                // Had kelajuan digandakan SAMA dgn moveGain — tanpa ni, objek bergandaan
                // tinggi (cth 8x) jatuh balik ke isu "lambat" asal (diuji: jurang
                // melonjak smpai 0.67m tanpa penggandaan had ni, kekal ~0.05m dengannya).
                const effMaxSpeed = GRAB_MAX_SPEED * moveGain;
                const scale = speed > effMaxSpeed ? effMaxSpeed / speed : 1;
                // Blend (bukan timpa terus) dengan velocity sedia ada — redam lonjakan
                // bingkai-ke-bingkai yang buat objek nampak bergegar semasa digenggam.
                // AR tap skrin guna blend BERASINGAN (lebih lembut) — lihat nota
                // arVelocityBlend di atas; VR/desktop (GRAB_VELOCITY_BLEND) tidak disentuh.
                const velocityBlend = st.arRawController ? arVelocityBlend : GRAB_VELOCITY_BLEND;
                body.velocity.set(
                    THREE.MathUtils.lerp(body.velocity.x, vx * scale, velocityBlend),
                    THREE.MathUtils.lerp(body.velocity.y, vy * scale, velocityBlend),
                    THREE.MathUtils.lerp(body.velocity.z, vz * scale, velocityBlend)
                );
                body.angularVelocity.set(0, 0, 0);
                // Tangkis graviti SEPENUHNYA utk langkah fizik ni selagi digenggam —
                // tanpa ni, physicsWorld.step() tambah graviti (-9.82/60 ≈ -0.16 m/s
                // SETIAP bingkai) ATAS velocity P-controller di atas, yang bagi objek
                // berehat atas permukaan Pepejal, saiznya hampir SAMA dgn velocity
                // sasaran bila cuba angkat perlahan — nyaris membatalkan terus (punca
                // laporan "objek berat/x mampu diangkat" utk controller KANAN/mod
                // 'move' — mod 'rotate' controller KIRI tak kena isu ni sebab ia set
                // quaternion terus, tak pernah lalui integrasi fizik langsung). Cuma
                // tangkis DAYA LUAR (graviti) — respons pelanggaran dgn objek Pepejal
                // lain (sekatan tembus) KEKAL terpakai sebab jenis/jisim badan tak ubah.
                body.applyForce(new CANNON.Vec3(0, -physicsWorld.gravity.y * body.mass, 0), body.position);
            } else {
                obj.position.copy(newWorldPos);
            }
        }
    }

    return { updateGrabbedObjectTransform };
}
