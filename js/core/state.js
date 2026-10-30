// Satu state dikongsi SELURUH app — supaya modul ciri (feature module, cth grab-core.js)
// tak perlu import modul ciri LAIN semata-mata untuk capai flag/objek yang sepatutnya
// app-wide (punca biasa circular dependency: fail A import fail B, fail B import fail A).
// Import `appState` di mana perlu, baca/tulis PROPERTY terus (`appState.grabbedObject = x`)
// — JANGAN reassign `appState` itu sendiri (ia const; cuma field dalamnya yang berubah).
//
// SKOP SETAKAT NI: cuma grabbedObject/grabStartState diwayar hidup (dipakai index.html +
// js/interactions/grab-core.js) — keperluan ekstrak sistem grab. Field lain (isPreviewMode,
// selectedModel, loadedModelsList, dll) SENGAJA belum ditambah di sini walaupun disebut
// dalam perbincangan asal — index.html masih pegang versi tempatan sendiri utk field tu.
// Tambah field baru di sini HANYA bila modul yang betul-betul perlukannya diekstrak (supaya
// tiada field "nampak hidup" tapi sebenarnya tak disegerakkan dgn apa-apa).
export const appState = {
    grabbedObject: null,
    grabStartState: null,
    physicsBodies: [], // [{ mesh, body, debugMesh, inWorld }] — lihat js/physics/colliders.js
    physicsActive: false,
    editColliderDebugMeshes: [] // [{ mesh, debugMesh, localOffset }] — "Show Colliders" mod Editing
};
