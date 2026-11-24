// Action "Change Material Color" — dikongsi oleh js/interactions/triggers.js (editor)
// dan view.html (viewer). Modul daun: tiada import (THREE.Color dihantar oleh pemanggil
// melalui material.color sedia ada), jadi tiada risiko circular dependency.
//
// Mod (config.colorMode):
//   'toggle' — klik 1: tukar ke config.colorHex, klik 2: balik ke warna asal, berulang.
//   'once'   — tukar ke config.colorHex dan kekal (klik seterusnya tiada kesan nampak).
//   'random' — warna rawak setiap kali (tingkah laku lama). Action lama yg disimpan
//              sebelum pilihan warna wujud (tiada colorHex) jatuh ke mod ni.
//
// Kenapa sentuh LEBIH dari node.material: occluder (js/physics/occluder.js) menukar
// material mesh antara asal (_cutoutOrigMaterials) & klon ber-shader cutout
// (_cutoutShaderMaterials) mengikut sama ada ada cutter aktif. Kalau warna cuma ditulis
// pd material semasa, ia "hilang" bila occluder tukar ke pasangan satu lagi.

// Warna asal disimpan dlm WeakMap (node → [{mat, hex}]), BUKAN node.userData — Object3D
// .clone()/copy() buat JSON.stringify(userData), dan rujukan material di situ akan ikut
// diserialisasi (berat) / bocor ke salinan objek.
const originalColors = new WeakMap();

function nodeMaterials(root, node) {
    const out = [];
    const add = (m) => {
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach(x => { if (x && x.color && !out.includes(x)) out.push(x); });
    };
    add(node.material);
    add(root.userData._cutoutOrigMaterials && root.userData._cutoutOrigMaterials.get(node));
    add(root.userData._cutoutShaderMaterials && root.userData._cutoutShaderMaterials.get(node));
    return out;
}

function rememberOriginal(root, node) {
    if (originalColors.has(node)) return;
    originalColors.set(node, nodeMaterials(root, node).map(m => ({ mat: m, hex: m.color.getHex() })));
}

export function applyColorAction(targets, config) {
    const mode = config.colorHex ? (config.colorMode || 'toggle') : 'random';
    targets.forEach(root => {
        let hex;
        if (mode === 'random') {
            hex = Math.floor(Math.random() * 0xffffff);
        } else if (mode === 'toggle' && root.userData.colorActionToggled) {
            hex = null; // balik ke warna asal
        } else {
            hex = parseInt(String(config.colorHex).replace('#', ''), 16);
        }

        root.traverse(node => {
            if (!node.isMesh) return;
            rememberOriginal(root, node);
            const origs = originalColors.get(node);
            nodeMaterials(root, node).forEach(m => {
                if (hex !== null) { m.color.setHex(hex); return; }
                const o = origs.find(e => e.mat === m) || origs[0];
                if (o) m.color.setHex(o.hex);
            });
        });

        if (mode === 'toggle') root.userData.colorActionToggled = !root.userData.colorActionToggled;
    });
}

// Pulihkan warna asal + reset status togol (cth. bila keluar Pratonton) — tanpa ni,
// warna yg ditukar semasa Pratonton kekal dlm editor.
export function resetColorAction(root) {
    root.traverse(node => {
        const origs = originalColors.get(node);
        if (!origs) return;
        nodeMaterials(root, node).forEach(m => {
            const o = origs.find(e => e.mat === m) || origs[0];
            if (o) m.color.setHex(o.hex);
        });
        originalColors.delete(node);
    });
    root.userData.colorActionToggled = false;
}
