// Setup Cannon.js world & broadphase — diekstrak dari index.html.
// CANNON (UMD classic script) mesti sudah dimuat sebelum modul ni jalan — dijamin sebab
// <script src=".../cannon.min.js"> di index.html bukan defer/module, jadi execute semasa
// parsing, sebelum mana-mana <script type="module"> (termasuk modul ni) yang sentiasa
// deferred sampai selepas dokumen siap di-parse.
//
// Simulasi berjalan dalam ruang LOKAL contentRoot (bukan dunia sebenar) — position/
// quaternion badan fizik terus sepadan dengan position/quaternion objek THREE (anak
// contentRoot), sama macam Zon Sasaran. Ini elak masalah penjajaran bila contentRoot
// sendiri berpindah (tap-to-place AR) — graviti "bawah tempatan" cukup tepat sebab
// contentRoot AR biasanya rata/hampir mengufuk. (Pendaftaran postStep yang zero-kan
// angularVelocity objek digenggam kekal di index.html — ia bergantung pada `grabbedObject`,
// state interaksi editor, bukan sebahagian dari setup world itu sendiri.)
export const physicsWorld = new CANNON.World();
physicsWorld.gravity.set(0, -9.82, 0);
physicsWorld.broadphase = new CANNON.NaiveBroadphase();
physicsWorld.solver.iterations = 10;

const physicsDefaultMaterial = new CANNON.Material('default');
const physicsContactMaterial = new CANNON.ContactMaterial(physicsDefaultMaterial, physicsDefaultMaterial, {
    friction: 0.4,
    restitution: 0.4
});
physicsWorld.addContactMaterial(physicsContactMaterial);
physicsWorld.defaultContactMaterial = physicsContactMaterial;

// Bahan fizik berasingan untuk setiap NILAI bounciness tersendiri (bukan setiap
// objek) — dicache ikut nilai supaya tak daftar ContactMaterial berulang-ulang
// setiap kali buildPhysicsWorldFromScene() jalan semula (contoh: setiap kali
// masuk Pratonton/tukar scene). Objek dengan bounciness lalai (0.4) kongsi
// physicsDefaultMaterial sedia ada — tiada perubahan untuk kes biasa.
const physicsBounceMaterialCache = new Map();
export function getPhysicsMaterialForBounciness(bounciness) {
    const key = Math.round(bounciness * 100) / 100;
    if (key === 0.4) return physicsDefaultMaterial;
    if (physicsBounceMaterialCache.has(key)) return physicsBounceMaterialCache.get(key);

    const mat = new CANNON.Material('bounce_' + key);
    physicsWorld.addContactMaterial(new CANNON.ContactMaterial(mat, physicsDefaultMaterial, {
        friction: 0.4,
        restitution: key
    }));
    physicsWorld.addContactMaterial(new CANNON.ContactMaterial(mat, mat, {
        friction: 0.4,
        restitution: key
    }));
    physicsBounceMaterialCache.set(key, mat);
    return mat;
}
