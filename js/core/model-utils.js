// Utiliti model KONGSI editor (index.html) + viewer (view.html) — modul daun (tiada import),
// THREE dihantar eksplisit sebab kedua-dua halaman bina objek THREE jambatan sendiri.

// BETULKAN COLOR SPACE TEKSTUR MODEL DIMUAT NAIK (ELAK TERLALU TERANG/PUDAR)
export function fixModelMaterialLighting(THREE, root) {
    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
            if (mat.map) mat.map.encoding = THREE.sRGBEncoding;
            if (mat.emissiveMap) mat.emissiveMap.encoding = THREE.sRGBEncoding;
            if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.8;

            // Material VFX (api/glow/asap): alpha SANGAT rendah + emissive kuat
            // (contoh diffuse alpha 0.07, emissiveFactor putih penuh) — shader
            // piawai darab KESELURUHAN piksel (termasuk glow terang) dengan
            // alpha rendah tu, jadi glow yang patut terang jadi hampir tak
            // nampak. Tukar jadi additive blending supaya glow terbit penuh
            // tanpa terikat alpha asap (macam software/viewer asal render dia).
            const hasEmissiveGlow = mat.emissiveMap && mat.emissive &&
                (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0);
            if (mat.transparent && mat.opacity < 0.2 && hasEmissiveGlow) {
                mat.blending = THREE.AdditiveBlending;
                mat.depthWrite = false;
            }

            // Tone mapping ACES mampatkan bahagian terang — material additive
            // (glow/particle) patut "terbit" penuh tanpa kena mampatan ni.
            if (mat.blending === THREE.AdditiveBlending) {
                mat.toneMapped = false;
            }

            mat.needsUpdate = true;
        });
    });
}

export function setupAnimationMixerFor(THREE, object3D, animations) {
    let mixer = null, animAction = null;
    if (animations && animations.length > 0) {
        mixer = new THREE.AnimationMixer(object3D);
        animAction = mixer.clipAction(animations[0]);

        mixer.addEventListener('finished', function (e) {
            if (e.action === animAction) {
                if (object3D.userData.interactions) {
                    const animAct = object3D.userData.interactions.find(a => a.action === 'toggleModelAnim');
                    if (animAct && animAct.animMode === 'toggleReverse') {
                        if (object3D.userData.animState === 'playing_fwd') {
                            object3D.userData.animState = 'atEnd';
                        } else if (object3D.userData.animState === 'playing_rev') {
                            object3D.userData.animState = 'atStart';
                        }
                    } else {
                        object3D.userData.animState = 'stopped';
                    }
                }
            }
        });
    }
    return { mixer, animAction };
}
