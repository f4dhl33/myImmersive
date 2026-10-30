// Simpan/muat projek + urus scene (tukar/tambah/namakan semula/padam/susun semula) —
// diekstrak dari index.html. SEMUA rujukan state/DOM dihantar sebagai getter/setter (byk
// diisytiharkan LEWAT dlm index.html, cth gltfLoader/fbxLoader/bgColorPicker) — lihat nota
// serupa dalam modul lain. draggedSceneId (drag-reorder scene) KEKAL tempatan dalam fail ni
// sahaja — tiada kod lain di index.html perlukannya.
//
// PENTING — saveCurrentProject() ada SEKATAN isPreviewMode (PENJAGA PUSAT, satu-satunya
// fungsi yang tulis `data` projek ke Supabase). JANGAN alih keluar/kurangkan sekatan ni —
// insiden kehilangan data 2026-10-27 punca laluan simpan TANPA sekatan ni. Lihat nota penuh
// pada fungsi tu.
export function createProjectStore({
    THREE, contentRoot,
    getScene, getRenderer, getPreviewCameraMarker, getCameraHelper,
    getLoadedModelsList, getUploadedAudios,
    getBgColorPicker, getChkArAutoPlace, getShapeTextureLoader, getGltfLoader, getFbxLoader,
    getActiveProjectId, getIsPreviewMode, getIsARSession,
    getIsRestoringProject, setIsRestoringProject,
    getActiveSceneId, setActiveSceneId,
    getSceneDataCache, setSceneDataCache,
    getProjectScenesMeta, setProjectScenesMeta,
    getSavedSceneBackgroundForAR, setSavedSceneBackgroundForAR,
    getUndoStack, setUndoStack, getRedoStack, setRedoStack,
    getHoveredModel, setHoveredModel,
    loadProjectRow, saveProjectRow,
    deleteObject, deselectObject, selectObject,
    renderObjectsList, renderMediaList, updateAudioDropdown,
    addPrimitive, isBasicShapeMesh, fixModelMaterialLighting, restoreImageFromUrl,
    rebuildWaypointPath, refreshCutterEditVisuals, recenterOrbitPivot,
    buildPhysicsWorldFromScene, fireSceneStartTriggers, applyPreviewVisibilityAndCamera,
    scheduleAutoSave, setSaveStatusText
}) {
    function getDefaultSceneData() {
        return {
            bgColor: '#87ceeb',
            arAutoPlace: false,
            camera: {
                position: [0, 2, 6],
                rotation: [0, 0, 0],
                interactions: []
            },
            objects: []
        };
    }

    // Serialize HANYA objek/kamera/latar scene yang SEDANG hidup dalam viewport
    // (tidak termasuk audio — audio dikongsi sepanjang projek, bukan per-scene).
    function serializeSceneObjectsCameraColor() {
        const previewCameraMarker = getPreviewCameraMarker();
        const objects = getLoadedModelsList().map(m => {
            const ud = m.userData;
            return {
                id: ud.id,
                fileName: ud.fileName,
                kind: ud.kind || 'model',
                primType: ud.primType || null,
                textContent: ud.textContent !== undefined ? ud.textContent : null,
                fileUrl: (ud.kind === 'model' || ud.kind === 'image') ? (ud.sourceUrl || null) : null,
                fileExt: ud.fileExt || null,
                position: m.position.toArray(),
                rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
                scale: m.scale.toArray(),
                initialPosition: ud.initialPosition.toArray(),
                initialRotation: [ud.initialRotation.x, ud.initialRotation.y, ud.initialRotation.z],
                initialScale: ud.initialScale.toArray(),
                initialVisibility: ud.initialVisibility,
                colliderActiveWhenHidden: ud.colliderActiveWhenHidden || false,
                isCutter: ud.isCutter || false,
                excludeFromCutout: ud.excludeFromCutout || false,
                interactions: ud.interactions || [],
                isGrabbable: ud.isGrabbable || false,
                isSolid: ud.isSolid || false,
                returnToOriginalOnRelease: ud.returnToOriginalOnRelease || false,
                bounciness: (typeof ud.bounciness === 'number') ? ud.bounciness : 0.4,
                colliderTrim: ud.colliderTrim || null,
                customColor: ud.customColor || null,
                customTextureUrl: ud.customTextureUrl || null
            };
        });

        return {
            bgColor: getBgColorPicker().value,
            arAutoPlace: getChkArAutoPlace().checked,
            camera: {
                position: previewCameraMarker.position.toArray(),
                rotation: [previewCameraMarker.rotation.x, previewCameraMarker.rotation.y, previewCameraMarker.rotation.z],
                interactions: previewCameraMarker.userData.interactions || []
            },
            objects: objects
        };
    }

    // Serialize KESELURUHAN projek (semua scene + audio dikongsi) untuk disimpan ke profile.
    function serializeSceneForSave() {
        const activeSceneId = getActiveSceneId();
        const sceneDataCache = getSceneDataCache();
        if (activeSceneId) {
            sceneDataCache[activeSceneId] = serializeSceneObjectsCameraColor();
        }

        const uploadedAudios = getUploadedAudios();
        const audios = Object.keys(uploadedAudios).map(fileName => ({
            fileName: fileName,
            url: uploadedAudios[fileName]
        }));

        const scenesOut = getProjectScenesMeta().map(meta => {
            const sd = sceneDataCache[meta.id] || getDefaultSceneData();
            return {
                id: meta.id,
                name: meta.name,
                bgColor: sd.bgColor,
                arAutoPlace: sd.arAutoPlace || false,
                camera: sd.camera,
                objects: sd.objects
            };
        });

        return {
            activeSceneId: activeSceneId,
            scenes: scenesOut,
            audios: audios
        };
    }

    // PENJAGA PUSAT — SATU-SATUNYA fungsi yang benar-benar menulis `data` (kandungan
    // scene/objek) projek ke Supabase (saveProjectRow() cuma dipanggil dari sini).
    // Sekatan `isPreviewMode` di sini bermakna TIADA laluan/butang/kod lain — tak kira
    // scheduleAutoSave(), klik butang, atau apa-apa yang akan ditambah pada masa depan —
    // boleh terlepas pandang simpan keadaan fizik/ujian Pratonton/VR/AR secara TAK
    // SENGAJA. (Insiden 2026-10-27: butang "My Projects" panggil saveCurrentProject()
    // terus TANPA sekatan ni, jadi keadaan rosak semasa ujian VR grab [objek jatuh tembus
    // lantai akibat bug fizik] berjaya tersimpan kekal ke Supabase, nyaris kehilangan
    // seluruh projek pengguna — cuma dapat dipulihkan sebab kebetulan ada fail eksport
    // HTML standalone projek tu. Jangan alih keluar/kurangkan sekatan ni — kalau satu
    // laluan/butang BENAR-BENAR perlu simpan semasa Pratonton aktif pada masa depan,
    // kena keluar Pratonton (setPreviewMode(false), yg pulihkan snapshot dulu) SEBELUM
    // simpan, bukan buang sekatan ni.)
    async function saveCurrentProject() {
        const activeProjectId = getActiveProjectId();
        if (!activeProjectId) return;
        if (getIsPreviewMode()) {
            console.warn('[Save] Blocked — refusing to save while Preview/VR/AR mode is active (would persist test-only physics/interaction state).');
            return;
        }
        const dataObj = serializeSceneForSave();
        try {
            await saveProjectRow(activeProjectId, dataObj);
            const now = new Date();
            setSaveStatusText('💾 Saved ' + now.toLocaleTimeString());
        } catch (err) {
            console.error('Auto-save gagal:', err);
            setSaveStatusText('⚠️ Save failed!');
        }
    }

    function setupAnimationMixerFor(object3D, animations) {
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

    function restoreModelFromUrl(objData) {
        return new Promise((resolve) => {
            const url = objData.fileUrl;
            if (!url) { resolve(null); return; }

            const ext = objData.fileExt || 'glb';

            const onLoaded = (loadedRoot, animations) => {
                const mixerInfo = setupAnimationMixerFor(loadedRoot, animations);

                loadedRoot.userData = {
                    id: objData.id,
                    fileName: objData.fileName,
                    kind: 'model',
                    sourceUrl: url,
                    fileExt: ext,
                    initialPosition: new THREE.Vector3().fromArray(objData.initialPosition),
                    initialRotation: new THREE.Euler(objData.initialRotation[0], objData.initialRotation[1], objData.initialRotation[2]),
                    initialScale: new THREE.Vector3().fromArray(objData.initialScale),
                    initialVisibility: objData.initialVisibility,
                    colliderActiveWhenHidden: objData.colliderActiveWhenHidden || false,
                    isCutter: objData.isCutter || false,
                    excludeFromCutout: objData.excludeFromCutout || false,
                    interactions: objData.interactions || [],
                    isGrabbable: objData.isGrabbable || false,
                    isSolid: objData.isSolid || false,
                    returnToOriginalOnRelease: objData.returnToOriginalOnRelease || false,
                    bounciness: (typeof objData.bounciness === 'number') ? objData.bounciness : 0.4,
                    colliderTrim: objData.colliderTrim || null,
                    isRotating: false,
                    mixer: mixerInfo.mixer,
                    animAction: mixerInfo.animAction,
                    animState: 'stopped',
                    stepStateToggle: false
                };

                loadedRoot.position.fromArray(objData.position);
                loadedRoot.rotation.set(objData.rotation[0], objData.rotation[1], objData.rotation[2]);
                loadedRoot.scale.fromArray(objData.scale);

                fixModelMaterialLighting(loadedRoot);

                contentRoot.add(loadedRoot);
                getLoadedModelsList().push(loadedRoot);

                resolve(loadedRoot);
            };

            const onErr = (err) => {
                console.error('Ralat memuat semula model dari Storage:', err);
                resolve(null);
            };

            if (ext === 'fbx') {
                getFbxLoader().load(url, (fbx) => onLoaded(fbx, fbx.animations), undefined, onErr);
            } else {
                getGltfLoader().load(url, (gltf) => onLoaded(gltf.scene, gltf.animations), undefined, onErr);
            }
        });
    }

    function clearViewportObjects() {
        // Henti & nyahcache AnimationMixer SEBELUM objek dipadam — deleteObject() lupus
        // geometry/material tapi tak pernah uruskan mixer, jadi tanpa ni mixer animasi
        // (THREE.AnimationMixer) terus hidup memegang rujukan ke root model yg dah
        // dibuang dari scene bila tukar babak, punca kebocoran memori senyap.
        const modelsSnapshot = [...getLoadedModelsList()];
        modelsSnapshot.forEach(m => {
            if (m.userData.mixer) {
                m.userData.mixer.stopAllAction();
                m.userData.mixer.uncacheRoot(m);
            }
        });
        modelsSnapshot.forEach(m => deleteObject(m));
        setHoveredModel(null);
        setUndoStack([]);
        setRedoStack([]);
    }

    // Papar satu set data scene (bgColor/camera/objects) ke dalam viewport semasa.
    // TIDAK clear dulu — panggil clearViewportObjects() sebelum ni kalau perlu.
    async function applySceneDataToViewport(sceneData) {
        const renderer = getRenderer();
        const bg = (sceneData && sceneData.bgColor) || '#87ceeb';
        // Semasa sesi AR (passthrough) aktif, scene.background MESTI kekal null
        // supaya kamera dunia sebenar kelihatan — jangan timpa dengan warna latar
        // scene baru (itu akan "tutup" passthrough, tinggal objek je kelihatan).
        // Simpan warna baru tu untuk dipulihkan bila sesi AR tamat nanti.
        if (renderer.xr.isPresenting && getIsARSession()) {
            setSavedSceneBackgroundForAR(new THREE.Color(bg));
        } else {
            getScene().background = new THREE.Color(bg);
        }
        getBgColorPicker().value = bg;
        getChkArAutoPlace().checked = !!(sceneData && sceneData.arAutoPlace);

        const previewCameraMarker = getPreviewCameraMarker();
        const cam = (sceneData && sceneData.camera) || getDefaultSceneData().camera;
        previewCameraMarker.position.fromArray(cam.position);
        previewCameraMarker.rotation.set(cam.rotation[0], cam.rotation[1], cam.rotation[2]);
        previewCameraMarker.userData.interactions = cam.interactions || [];
        getCameraHelper().update();

        for (const objData of ((sceneData && sceneData.objects) || [])) {
            if (objData.kind === 'model') {
                await restoreModelFromUrl(objData);
            } else if (objData.kind === 'image') {
                await restoreImageFromUrl(objData);
            } else {
                await restorePrimitiveFromData(objData);
            }
        }
        recenterOrbitPivot();
        refreshCutterEditVisuals(getIsPreviewMode());
    }

    // Bina semula primitif (box/sphere/cylinder/plane/zone/waypoint/text) daripada
    // objData — dikongsi antara applySceneDataToViewport() (muat scene) DAN
    // duplicateSelectedObject() (duplicate), elak duplikasi logik.
    //
    // Pulangkan PROMISE (bukan mesh terus) — sama macam restoreModelFromUrl/
    // restoreImageFromUrl — supaya applySceneDataToViewport() boleh await ia. SEBAB:
    // texture custom (shapeTextureLoader.load) dimuat secara ASYNC; kalau fungsi ni
    // pulang serta-merta sebelum texture siap muat, applyCutoutEffect() (dipanggil
    // lepas semua objek scene siap dimuat) boleh terus clone material (lihat
    // ensureCutoutStencilMaterials) SEBELUM texture sempat terpasang — clone material
    // tu snapshot BEKU, texture yang terpasang LEPAS clone dibuat takkan terpapar pada
    // clone tu langsung, jadi bahagian objek yang kena cutout kekal base color je
    // (texture tak pernah sampai ke situ). Isu ni laporan pengguna: "selepas export,
    // cutter kena objek ada texture, keseluruhan texture terpotong tinggal base color".
    // Jarang nampak di editor sebab ada "jeda" semula jadi (load projek → pengguna
    // tengok-tengok → klik Preview) yang beri masa texture siap muat sebelum
    // applyCutoutEffect() jalan — tapi fail export/view.html terus jalan tanpa jeda tu,
    // jadi race condition ni selalu kena.
    function restorePrimitiveFromData(objData) {
        return new Promise((resolve) => {
            const mesh = addPrimitive(objData.primType, { presetText: objData.textContent, id: objData.id, skipSelect: true });
            if (!mesh) { resolve(null); return; }

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

            const finish = () => {
                if (objData.primType === 'waypoint') rebuildWaypointPath();
                resolve(mesh);
            };

            if (isBasicShapeMesh(mesh)) {
                if (objData.customColor) {
                    mesh.material.color.set(objData.customColor).convertSRGBToLinear();
                    mesh.userData.customColor = objData.customColor;
                }
                if (objData.customTextureUrl) {
                    mesh.userData.customTextureUrl = objData.customTextureUrl;
                    getShapeTextureLoader().load(objData.customTextureUrl, (tex) => {
                        mesh.material.map = tex;
                        mesh.material.needsUpdate = true;
                        finish();
                    }, undefined, (err) => {
                        console.error('Ralat memuat texture bentuk:', err);
                        finish();
                    });
                    return;
                }
            }
            finish();
        });
    }

    async function loadProjectIntoEditor(projectId) {
        setIsRestoringProject(true);
        setSaveStatusText('⏳ Loading project...');

        try {
            const row = await loadProjectRow(projectId);
            const data = row ? row.data : null;

            clearViewportObjects();
            const uploadedAudios = getUploadedAudios();
            Object.keys(uploadedAudios).forEach(fn => delete uploadedAudios[fn]);
            updateAudioDropdown();
            renderMediaList();

            let sceneDataCache = {};
            let projectScenesMeta = [];
            setSceneDataCache(sceneDataCache);
            setProjectScenesMeta(projectScenesMeta);
            setActiveSceneId(null);

            if (!data || !data.scenes) {
                const newId = 'scene_' + (Date.now() + Math.random());
                projectScenesMeta = [{ id: newId, name: 'Scene 1' }];
                setProjectScenesMeta(projectScenesMeta);
                sceneDataCache[newId] = getDefaultSceneData();
                setActiveSceneId(newId);

                await applySceneDataToViewport(sceneDataCache[newId]);
                renderScenesList();
                renderObjectsList();
                deselectObject();
                setSaveStatusText('New project.');
                return;
            }

            (data.audios || []).forEach(a => {
                uploadedAudios[a.fileName] = a.url;
            });
            updateAudioDropdown();
            renderMediaList();

            projectScenesMeta = data.scenes.map(s => ({ id: s.id, name: s.name || 'Scene' }));
            setProjectScenesMeta(projectScenesMeta);
            data.scenes.forEach(s => {
                sceneDataCache[s.id] = { bgColor: s.bgColor, camera: s.camera, objects: s.objects || [] };
            });

            const resolvedActiveSceneId = (data.activeSceneId && projectScenesMeta.some(s => s.id === data.activeSceneId))
                ? data.activeSceneId
                : projectScenesMeta[0].id;
            setActiveSceneId(resolvedActiveSceneId);

            await applySceneDataToViewport(sceneDataCache[resolvedActiveSceneId]);

            renderScenesList();
            renderObjectsList();
            deselectObject();
            setSaveStatusText('💾 Project loaded.');
        } finally {
            setIsRestoringProject(false);
        }
    }

    async function switchToScene(sceneId) {
        const activeSceneId = getActiveSceneId();
        const projectScenesMeta = getProjectScenesMeta();
        if (sceneId === activeSceneId) return;
        if (!projectScenesMeta.some(s => s.id === sceneId)) return;

        setIsRestoringProject(true);
        try {
            const sceneDataCache = getSceneDataCache();
            if (activeSceneId) {
                sceneDataCache[activeSceneId] = serializeSceneObjectsCameraColor();
            }

            clearViewportObjects();
            deselectObject();

            setActiveSceneId(sceneId);
            const target = sceneDataCache[sceneId] || getDefaultSceneData();
            await applySceneDataToViewport(target);

            renderScenesList();
            renderObjectsList();
        } finally {
            setIsRestoringProject(false);
        }
        scheduleAutoSave();
    }

    // Tukar scene dicetus oleh tindakan interaksi (onClick/onHover) semasa Pratonton/VR/AR
    // sedang aktif — bukan dari klik senarai scene dalam editor. Selepas scene bertukar,
    // letak semula visibility awal & kamera ikut Kedudukan Awal Kamera scene baru tu
    // (macam "portal"/teleport ke scene lain).
    async function changeSceneDuringInteraction(targetSceneId) {
        const activeSceneId = getActiveSceneId();
        if (!targetSceneId || targetSceneId === activeSceneId) return;
        if (!getProjectScenesMeta().some(s => s.id === targetSceneId)) return;

        await switchToScene(targetSceneId);

        if (getIsPreviewMode()) {
            if (getIsARSession()) {
                // ANCHOR: guna kedudukan/orientasi penjangkaran YANG SAMA dari
                // penempatan scene pertama untuk SEMUA scene lain dalam sesi AR
                // ni — pengguna tak perlu tap-to-place berulang kali setiap kali
                // tukar scene (lokasi fizikal pengguna di dunia sebenar tak
                // berubah hanya sebab kandungan/scene bertukar).
                getLoadedModelsList().forEach(m => {
                    m.visible = (m.userData.primType === 'zone') ? false : (m.userData.initialVisibility !== false);
                });
                buildPhysicsWorldFromScene();
                fireSceneStartTriggers();
            } else {
                applyPreviewVisibilityAndCamera();
            }
        }
    }

    function addNewScene() {
        const projectScenesMeta = getProjectScenesMeta();
        const name = prompt('New Scene Name:', 'Scene ' + (projectScenesMeta.length + 1));
        if (!name) return;

        const newId = 'scene_' + (Date.now() + Math.random());
        projectScenesMeta.push({ id: newId, name: name });
        getSceneDataCache()[newId] = getDefaultSceneData();
        switchToScene(newId);
    }

    function renameScene(sceneId) {
        const meta = getProjectScenesMeta().find(s => s.id === sceneId);
        if (!meta) return;

        const newName = prompt('New name for this scene:', meta.name);
        if (!newName) return;

        meta.name = newName;
        renderScenesList();
        scheduleAutoSave();
    }

    function deleteSceneUI(sceneId) {
        let projectScenesMeta = getProjectScenesMeta();
        if (projectScenesMeta.length <= 1) {
            alert('Cannot delete — the project must have at least one scene.');
            return;
        }
        const meta = projectScenesMeta.find(s => s.id === sceneId);
        if (!meta) return;

        if (!confirm(`Delete scene "${meta.name}"?\n\nAll objects & actions in this scene will be lost. This action cannot be undone.`)) return;

        const wasActive = sceneId === getActiveSceneId();
        projectScenesMeta = projectScenesMeta.filter(s => s.id !== sceneId);
        setProjectScenesMeta(projectScenesMeta);
        delete getSceneDataCache()[sceneId];

        if (wasActive) {
            setActiveSceneId(null);
            switchToScene(projectScenesMeta[0].id);
        } else {
            renderScenesList();
            scheduleAutoSave();
        }
    }

    function reorderScene(draggedId, targetId) {
        const projectScenesMeta = getProjectScenesMeta();
        const fromIndex = projectScenesMeta.findIndex(s => s.id === draggedId);
        const toIndex = projectScenesMeta.findIndex(s => s.id === targetId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

        const [moved] = projectScenesMeta.splice(fromIndex, 1);
        projectScenesMeta.splice(toIndex, 0, moved);

        renderScenesList();
        scheduleAutoSave();
    }

    let draggedSceneId = null;

    function renderScenesList() {
        const activeSceneId = getActiveSceneId();
        const projectScenesMeta = getProjectScenesMeta();
        const list = document.getElementById('scenes-list');
        list.innerHTML = '';

        if (projectScenesMeta.length === 0) {
            list.innerHTML = '<li class="hierarchy-empty-msg">No scenes yet</li>';
            return;
        }

        projectScenesMeta.forEach((meta, index) => {
            const li = document.createElement('li');
            li.className = 'hierarchy-item scene-drag-item' + (meta.id === activeSceneId ? ' selected' : '');
            li.draggable = true;

            const firstBadge = index === 0 ? ' <span class="hint-text" style="color:#ffcc00;">(Default)</span>' : '';

            li.innerHTML = `
                <span class="media-title-text">⠿ 🎬 ${meta.name}${firstBadge}</span>
                <div class="hierarchy-item-actions">
                    <button class="btn-vis-obj" title="Rename Scene">✏️</button>
                    <button class="btn-delete-obj" title="Delete This Scene">✕</button>
                </div>
            `;

            li.addEventListener('click', () => switchToScene(meta.id));

            li.addEventListener('dragstart', (e) => {
                draggedSceneId = meta.id;
                li.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', meta.id);
            });

            li.addEventListener('dragend', () => {
                draggedSceneId = null;
                document.querySelectorAll('#scenes-list .hierarchy-item').forEach(el => {
                    el.classList.remove('dragging', 'drag-over');
                });
            });

            li.addEventListener('dragover', (e) => {
                if (!draggedSceneId || draggedSceneId === meta.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                li.classList.add('drag-over');
            });

            li.addEventListener('dragleave', () => {
                li.classList.remove('drag-over');
            });

            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.classList.remove('drag-over');
                if (!draggedSceneId || draggedSceneId === meta.id) return;
                reorderScene(draggedSceneId, meta.id);
            });

            const btnRename = li.querySelector('.btn-vis-obj');
            btnRename.addEventListener('click', (e) => {
                e.stopPropagation();
                renameScene(meta.id);
            });

            const btnDel = li.querySelector('.btn-delete-obj');
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSceneUI(meta.id);
            });

            list.appendChild(li);
        });
    }

    return {
        getDefaultSceneData, serializeSceneObjectsCameraColor, serializeSceneForSave, saveCurrentProject,
        setupAnimationMixerFor, restoreModelFromUrl, clearViewportObjects, applySceneDataToViewport,
        restorePrimitiveFromData, loadProjectIntoEditor, switchToScene, changeSceneDuringInteraction,
        addNewScene, renameScene, deleteSceneUI, reorderScene, renderScenesList
    };
}
