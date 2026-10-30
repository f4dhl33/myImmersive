// Cipta/padam/duplicate objek (primitif, imej 2D, teks) — diekstrak dari index.html.
// restoreModelFromUrl/restorePrimitiveFromData (model GLB/FBX & primitif projek tersimpan)
// dihantar sebagai callback — belum/tak diekstrak ke modul berasingan, kekal index.html.
export function createObjectFactory({
    THREE, contentRoot, getLoadedModelsList,
    getCurrentUser, uploadAssetToStorage,
    getSelectedModel, getPreviewCameraMarker, getIsPreviewMode,
    deselectObject, selectObject, renderObjectsList,
    recenterOrbitPivot, rebuildWaypointPath, refreshCutterEditVisuals,
    scheduleAutoSave, setSaveStatusText,
    restoreModelFromUrl, restorePrimitiveFromData
}) {
    function addPrimitive(type, options) {
        options = options || {};
        const loadedModelsList = getLoadedModelsList();
        let geometry, material, mesh, nameStr;
        let isText = false;
        let fullUserText = null;

        material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });

        if (type === 'box') {
            geometry = new THREE.BoxGeometry(1, 1, 1);
            nameStr = 'Cube';
        } else if (type === 'sphere') {
            geometry = new THREE.SphereGeometry(0.6, 32, 32);
            nameStr = 'Sphere';
        } else if (type === 'cylinder') {
            geometry = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
            nameStr = 'Cylinder';
        } else if (type === 'plane') {
            geometry = new THREE.PlaneGeometry(2, 2);
            nameStr = 'Plane';
        } else if (type === 'zone') {
            geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
            material = new THREE.MeshBasicMaterial({ color: 0x61ff33, wireframe: true, transparent: true, opacity: 0.8 });
            nameStr = 'Target Zone';
        } else if (type === 'waypoint') {
            geometry = new THREE.CircleGeometry(0.15, 24);
            material = new THREE.MeshBasicMaterial({ color: 0x2196f3, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
            nameStr = 'Waypoint';
        } else if (type === 'text') {
            const userText = options.presetText !== undefined ? options.presetText : prompt("Please type the text to display:", "Info Text");
            if (!userText) return null;

            isText = true;
            fullUserText = userText;
            nameStr = userText.length > 15 ? userText.substring(0, 15) + '...' : userText;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 1024;
            canvas.height = 256;

            ctx.fillStyle = 'rgba(20, 20, 20, 0.8)';
            ctx.roundRect ? ctx.roundRect(0, 0, canvas.width, canvas.height, 30) : ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fill();

            ctx.strokeStyle = '#007acc';
            ctx.lineWidth = 15;
            ctx.strokeRect(0, 0, canvas.width, canvas.height);

            ctx.font = 'bold 80px "Segoe UI", sans-serif';
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(userText, canvas.width / 2, canvas.height / 2);

            const texture = new THREE.CanvasTexture(canvas);
            material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
            geometry = new THREE.PlaneGeometry(4, 1);
        }

        mesh = new THREE.Mesh(geometry, material);
        const offsetCount = loadedModelsList.length;
        mesh.position.set((offsetCount % 3) - 1, isText ? 1.5 : 0.5, (offsetCount % 2) - 0.5);

        if (type === 'waypoint') {
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = 0.02;
        }

        mesh.userData = {
            id: options.id || (Date.now() + Math.random()),
            fileName: (isText ? '🔤 Text: ' : type === 'zone' ? '🎯 ' : type === 'waypoint' ? '📍 ' : '🧊 ') + nameStr,
            kind: 'primitive',
            primType: type,
            textContent: fullUserText,
            initialPosition: new THREE.Vector3().copy(mesh.position),
            initialRotation: new THREE.Euler().copy(mesh.rotation),
            initialScale: new THREE.Vector3().copy(mesh.scale),
            initialVisibility: type !== 'zone',
            colliderActiveWhenHidden: false,
            isCutter: false,
            excludeFromCutout: false,
            interactions: [],
            isGrabbable: false,
            isSolid: false,
            returnToOriginalOnRelease: false,
            bounciness: 0.4,
            colliderTrim: null,
            customColor: null,
            customTextureUrl: null,
            isRotating: false,
            mixer: null,
            animAction: null,
            animState: 'stopped',
            stepStateToggle: false
        };

        contentRoot.add(mesh);
        loadedModelsList.push(mesh);

        if (type === 'waypoint') rebuildWaypointPath();

        if (!options.skipSelect) {
            renderObjectsList();
            selectObject(mesh);
            recenterOrbitPivot();
        }

        scheduleAutoSave();
        return mesh;
    }

    // GAMBAR 2D (satah bertekstur dari fail imej dimuat naik)
    function buildImagePlaneMesh(url, fileName, fileExt, options) {
        options = options || {};
        return new Promise((resolve) => {
            const loader = new THREE.TextureLoader();

            loader.load(url, (texture) => {
                texture.encoding = THREE.sRGBEncoding;

                const imgW = texture.image ? texture.image.width : 0;
                const imgH = texture.image ? texture.image.height : 0;
                const aspect = (imgW && imgH) ? (imgW / imgH) : 1;
                const height = 2;
                const width = height * aspect;

                const geometry = new THREE.PlaneGeometry(width, height);
                const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geometry, material);

                const loadedModelsList = getLoadedModelsList();
                const offsetCount = loadedModelsList.length;
                mesh.position.set((offsetCount % 3) - 1, height / 2, (offsetCount % 2) - 0.5);

                mesh.userData = {
                    id: options.id || (Date.now() + Math.random()),
                    fileName: fileName,
                    kind: 'image',
                    sourceUrl: url,
                    fileExt: fileExt,
                    initialPosition: new THREE.Vector3().copy(mesh.position),
                    initialRotation: new THREE.Euler().copy(mesh.rotation),
                    initialScale: new THREE.Vector3().copy(mesh.scale),
                    initialVisibility: true,
                    colliderActiveWhenHidden: false,
                    isCutter: false,
                    excludeFromCutout: false,
                    interactions: [],
                    isGrabbable: false,
                    isSolid: false,
                    returnToOriginalOnRelease: false,
                    bounciness: 0.4,
                    colliderTrim: null,
                    isRotating: false,
                    mixer: null,
                    animAction: null,
                    animState: 'stopped',
                    stepStateToggle: false
                };

                contentRoot.add(mesh);
                loadedModelsList.push(mesh);

                if (!options.skipSelect) {
                    renderObjectsList();
                    selectObject(mesh);
                    recenterOrbitPivot();
                }

                scheduleAutoSave();
                resolve(mesh);
            }, undefined, (err) => {
                console.error('Ralat memuat gambar:', err);
                resolve(null);
            });
        });
    }

    // Upload gambar BAHARU ke Supabase Storage dahulu, kemudian papar.
    async function addImagePlane(file, options) {
        const url = await uploadAssetToStorage(getCurrentUser().id, file);
        const fileExt = (file.name.split('.').pop() || 'png').toLowerCase();
        return buildImagePlaneMesh(url, '🖼️ ' + file.name, fileExt, options);
    }

    // Muat semula gambar SEDIA ADA terus dari URL Storage (tiada upload semula).
    function restoreImageFromUrl(objData) {
        if (!objData.fileUrl) return Promise.resolve(null);

        return buildImagePlaneMesh(objData.fileUrl, objData.fileName, objData.fileExt, { id: objData.id, skipSelect: true }).then(mesh => {
            if (mesh) {
                mesh.position.fromArray(objData.position);
                mesh.rotation.set(objData.rotation[0], objData.rotation[1], objData.rotation[2]);
                mesh.scale.fromArray(objData.scale);
                mesh.userData.initialPosition.fromArray(objData.initialPosition);
                mesh.userData.initialRotation.set(objData.initialRotation[0], objData.initialRotation[1], objData.initialRotation[2]);
                mesh.userData.initialScale.fromArray(objData.initialScale);
                mesh.userData.initialVisibility = objData.initialVisibility;
                mesh.userData.colliderActiveWhenHidden = objData.colliderActiveWhenHidden || false;
                mesh.userData.isCutter = objData.isCutter || false;
                mesh.userData.excludeFromCutout = objData.excludeFromCutout || false;
                mesh.userData.interactions = objData.interactions || [];
                mesh.userData.isGrabbable = objData.isGrabbable || false;
                mesh.userData.isSolid = objData.isSolid || false;
                mesh.userData.returnToOriginalOnRelease = objData.returnToOriginalOnRelease || false;
                mesh.userData.bounciness = (typeof objData.bounciness === 'number') ? objData.bounciness : 0.4;
                mesh.userData.colliderTrim = objData.colliderTrim || null;
            }
            return mesh;
        });
    }

    function deleteObject(model) {
        const previewCameraMarker = getPreviewCameraMarker();
        if (model === previewCameraMarker) {
            alert("The Main Camera cannot be deleted!");
            return;
        }

        const wasWaypoint = model.userData.primType === 'waypoint';

        if (getSelectedModel() === model) {
            deselectObject();
        }
        contentRoot.remove(model);

        model.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (!mat) return;
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                });
            }
        });

        const loadedModelsList = getLoadedModelsList();
        const index = loadedModelsList.indexOf(model);
        if (index > -1) {
            loadedModelsList.splice(index, 1);
        }
        if (wasWaypoint) rebuildWaypointPath();
        renderObjectsList();
        recenterOrbitPivot();
        scheduleAutoSave();
    }

    // ---------------------------------------------------------------
    // DUPLICATE OBJEK — serialize objek dipilih ke format objData yang SAMA dengan
    // simpan/muat projek, lepas tu bina semula terus guna fungsi sedia ada
    // (restoreModelFromUrl/restoreImageFromUrl/restorePrimitiveFromData) dengan ID
    // baharu & kedudukan diselar sedikit, supaya salinan konsisten dengan cara projek
    // sebenar dimuat (tak perlu tulis logik berasingan).
    // ---------------------------------------------------------------
    function serializeOneObjectForCopy(m) {
        const ud = m.userData;
        return {
            fileName: ud.fileName,
            kind: ud.kind || 'model',
            primType: ud.primType || null,
            textContent: ud.textContent !== undefined ? ud.textContent : null,
            fileUrl: (ud.kind === 'model' || ud.kind === 'image') ? (ud.sourceUrl || null) : null,
            fileExt: ud.fileExt || null,
            position: m.position.toArray(),
            rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
            scale: m.scale.toArray(),
            initialVisibility: ud.initialVisibility,
            colliderActiveWhenHidden: ud.colliderActiveWhenHidden || false,
            isCutter: ud.isCutter || false,
            excludeFromCutout: ud.excludeFromCutout || false,
            interactions: JSON.parse(JSON.stringify(ud.interactions || [])),
            isGrabbable: ud.isGrabbable || false,
            isSolid: ud.isSolid || false,
            returnToOriginalOnRelease: ud.returnToOriginalOnRelease || false,
            bounciness: (typeof ud.bounciness === 'number') ? ud.bounciness : 0.4,
            colliderTrim: ud.colliderTrim ? JSON.parse(JSON.stringify(ud.colliderTrim)) : null,
            customColor: ud.customColor || null,
            customTextureUrl: ud.customTextureUrl || null
        };
    }

    async function duplicateSelectedObject() {
        const isPreviewMode = getIsPreviewMode();
        const selectedModel = getSelectedModel();
        const previewCameraMarker = getPreviewCameraMarker();
        if (isPreviewMode) return;
        if (!selectedModel || selectedModel === previewCameraMarker) {
            alert('Please select an object first (the Main Camera cannot be duplicated).');
            return;
        }

        const objData = serializeOneObjectForCopy(selectedModel);
        objData.id = Date.now() + Math.random();
        // Anjak sedikit (bukan bertindih terus di atas asal) supaya nampak terus ada 2 objek.
        objData.position = [objData.position[0] + 0.4, objData.position[1], objData.position[2] + 0.4];
        objData.initialPosition = objData.position.slice();
        objData.initialRotation = objData.rotation.slice();
        objData.initialScale = objData.scale.slice();
        // targetObjectIds dalam interactions kekal menunjuk ke objek LAIN yang disasarkan
        // (contoh: "onClick, hide object X") — objek itu tak berubah, jadi tak perlu diselaraskan.
        // Cuma beri id baharu pada setiap interaction entry itu sendiri.
        objData.interactions = (objData.interactions || []).map(act => ({
            ...act,
            id: Date.now() + Math.random()
        }));

        let newMesh = null;
        if (objData.kind === 'model') {
            newMesh = await restoreModelFromUrl(objData);
        } else if (objData.kind === 'image') {
            newMesh = await restoreImageFromUrl(objData);
        } else {
            newMesh = await restorePrimitiveFromData(objData);
        }

        if (newMesh) {
            renderObjectsList();
            selectObject(newMesh);
            recenterOrbitPivot();
            refreshCutterEditVisuals(isPreviewMode);
            scheduleAutoSave();
            setSaveStatusText('📄 Duplicated "' + (newMesh.userData.fileName || 'object') + '"');
        }
    }

    // BETULKAN COLOR SPACE TEKSTUR MODEL DIMUAT NAIK (ELAK TERLALU TERANG/PUDAR)
    function fixModelMaterialLighting(root) {
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

    return {
        addPrimitive, buildImagePlaneMesh, addImagePlane, restoreImageFromUrl,
        deleteObject, serializeOneObjectForCopy, duplicateSelectedObject, fixModelMaterialLighting
    };
}
