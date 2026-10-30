// Setup Cannon.js world & broadphase — diekstrak dari index.html.
// Import TERUS 'cannon-es' (bukan bergantung pada window.CANNON global macam colliders.js/
// grab-core.js/pointer-grab.js) — fail ni guna CANNON pada tahap ATAS modul (module-eval
// time, `new CANNON.World()` di bawah jalan serta-merta bila modul ni diimport), SEBELUM
// index.html/view.html sendiri sempat jalankan baris jambatan `window.CANNON = ...` di
// bawah import mereka. cannon-es (fork ESM cannon.js yg diselenggara, API serasi — World/
// Body/Box/Sphere/Material/ContactMaterial/NaiveBroadphase/Vec3 nama sama) TIADA build UMD/
// global pun, jadi mustahil guna <script src> klasik lagi macam cannon.js 0.6.2 dulu.
import * as CANNON from 'cannon-es';
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
