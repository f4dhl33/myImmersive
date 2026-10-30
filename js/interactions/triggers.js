// Sistem trigger/interaksi (onClick, onHover, onStart, zon) — diekstrak dari index.html.
// changeSceneDuringInteraction/getTargetObjects dihantar sebagai CALLBACK (bukan import
// terus) sebab fungsi tu sendiri belum (atau tak akan) diekstrak ke modul berasingan —
// elak circular/forward-reference, index.html kekal "punca kebenaran" utk wiring tu.
export function createTriggers({
    THREE, container, mainCamera, uploadedAudios, previewCameraMarker, savedActionsList,
    getSelectedModel, getLoadedModelsList, getProjectScenesMeta, getPreviewObjectSnapshot,
    showPopupMessage, showInfoPopupAtPointer, scheduleAutoSave,
    changeSceneDuringInteraction, getTargetObjects
}) {
    // TRIGGER LOGIC
    function triggerInteraction(model, eventType, clientX, clientY) {
        if (!model.userData.interactions || !Array.isArray(model.userData.interactions)) return;

        const matchingActions = model.userData.interactions.filter(act => act.trigger === eventType);
        if (matchingActions.length === 0) return;

        matchingActions.forEach(config => {
            const targets = getTargetObjects(model, config.targetObjectIds);

            // 1. ANIMATION TOGGLE
            if (config.action === 'toggleModelAnim') {
                targets.forEach(targetObj => {
                    if (targetObj.userData.mixer && targetObj.userData.animAction) {
                        const action = targetObj.userData.animAction;
                        const state = targetObj.userData.animState;
                        const clipDuration = action.getClip().duration;

                        const startTime = Math.max(0, config.animStartTime || 0);
                        const endTime = (config.animEndTime && config.animEndTime > startTime)
                            ? Math.min(config.animEndTime, clipDuration)
                            : clipDuration;

                        targetObj.userData.customStartTime = startTime;
                        targetObj.userData.customEndTime = endTime;
                        targetObj.userData.animDir = config.animDir;

                        if (config.animMode === 'toggleReverse') {
                            action.setLoop(THREE.LoopOnce, 1);
                            action.clampWhenFinished = true;

                            if (state === 'stopped' || state === 'atStart') {
                                action.reset();
                                action.time = startTime;
                                action.timeScale = 1;
                                action.play();
                                action.paused = false;
                                targetObj.userData.animState = 'playing_fwd';
                            } else if (state === 'atEnd' || state === 'playing_fwd') {
                                action.paused = false;
                                action.timeScale = -1;
                                if (action.time >= endTime) action.time = endTime;
                                action.play();
                                targetObj.userData.animState = 'playing_rev';
                            } else if (state === 'playing_rev') {
                                action.paused = false;
                                action.timeScale = 1;
                                action.play();
                                targetObj.userData.animState = 'playing_fwd';
                            }
                        } else {
                            if (config.animMode === 'once') {
                                action.setLoop(THREE.LoopOnce, 1);
                                action.clampWhenFinished = true;
                            } else {
                                action.setLoop(THREE.LoopRepeat, Infinity);
                            }

                            if (state === 'stopped' || state === 'paused') {
                                if (state === 'stopped') action.reset();
                                if (action.time < startTime || action.time >= endTime) action.time = startTime;
                                action.timeScale = (config.animDir === 'reverse') ? -1 : 1;
                                action.play();
                                action.paused = false;
                                targetObj.userData.animState = 'playing';
                            } else {
                                action.paused = true;
                                targetObj.userData.animState = 'paused';
                            }
                        }
                    }
                });
            }
            // 2. STEP MOVE / SHIFT
            else if (config.action === 'stepMove') {
                targets.forEach(targetObj => {
                    const stepVec = new THREE.Vector3(config.stepX || 0, config.stepY || 0, config.stepZ || 0);
                    stepVec.applyQuaternion(targetObj.quaternion);

                    if (config.stepMode === 'toggle') {
                        if (!targetObj.userData.stepStateToggle) {
                            targetObj.position.add(stepVec);
                            targetObj.userData.stepStateToggle = true;
                        } else {
                            targetObj.position.sub(stepVec);
                            targetObj.userData.stepStateToggle = false;
                        }
                    } else {
                        targetObj.position.add(stepVec);
                    }
                });
            }
            // 3. TOGGLE TARGET VISIBILITY
            else if (config.action === 'toggleTargetVisibility') {
                targets.forEach(targetObj => {
                    targetObj.visible = !targetObj.visible;
                });
            }
            else if (config.action === 'changeColor') {
                targets.forEach(targetObj => {
                    targetObj.traverse((child) => {
                        if (child.isMesh && child.material && child.material.color) {
                            child.material.color.setHex(Math.random() * 0xffffff);
                        }
                    });
                });
            }
            else if (config.action === 'rotateAnim') {
                targets.forEach(targetObj => {
                    targetObj.userData.isRotating = !targetObj.userData.isRotating;
                });
            }
            else if (config.action === 'popInfo') {
                const containerRect = container.getBoundingClientRect();
                const px = (typeof clientX === 'number') ? clientX : (containerRect.left + container.clientWidth / 2);
                const py = (typeof clientY === 'number') ? clientY : (containerRect.top + container.clientHeight / 2);
                // onHover: kekal terpapar selagi kursor di atas objek (hilang bila hover tamat, lihat pointermove).
                // onClick: kekal guna timer tetap sebab ia tindakan sekali klik, bukan status berterusan.
                const popupDuration = (eventType === 'onHover') ? 3600000 : 3000;
                showInfoPopupAtPointer(config.noteTitle, config.note || "Object Information", popupDuration, px, py);
            }
            else if (config.action === 'playSound') {
                if (config.audioFile && uploadedAudios[config.audioFile]) {
                    const audio = new Audio(uploadedAudios[config.audioFile]);
                    audio.play();
                }
            }
            else if (config.action === 'changeScene') {
                changeSceneDuringInteraction(config.targetSceneId);
            }
        });

        const hasPopInfo = matchingActions.some(a => a.action === 'popInfo');
        if (!hasPopInfo) {
            showPopupMessage(`⚡ ${matchingActions.length} Action(s) Executed!`, 1500);
        }
    }

    // Selesaikan senarai ID sasaran jadi NAMA sebenar (bukan sekadar kiraan) — supaya
    // "Registered Actions" cukup terperinci untuk debug (cth: toggle visibility ni
    // sasar objek MANA sebenarnya), tanpa perlu buka modal/ubah pilihan dulu.
    function resolveTargetNamesText(sourceModel, targetObjectIds) {
        if (!targetObjectIds || targetObjectIds.length === 0) {
            return `🎯 ${sourceModel ? sourceModel.userData.fileName : 'This Object'} (self)`;
        }
        const loadedModelsList = getLoadedModelsList();
        const names = targetObjectIds.map(id => {
            if (previewCameraMarker && id == previewCameraMarker.userData.id) {
                return previewCameraMarker.userData.fileName + (sourceModel && id == sourceModel.userData.id ? ' (self)' : '');
            }
            const found = loadedModelsList.find(o => o.userData.id == id);
            if (!found) return '⚠️(deleted object)';
            return found.userData.fileName + (sourceModel && id == sourceModel.userData.id ? ' (self)' : '');
        });
        return names.join(', ');
    }

    function getActionSummaryText(act, sourceModel) {
        if (act.action === 'popInfo') return `💬 ${act.noteTitle ? act.noteTitle + ': ' : ''}"${act.note || ''}"`;
        if (act.action === 'toggleModelAnim') return `🎬 Animation (${act.animMode}) → ${resolveTargetNamesText(sourceModel, act.targetObjectIds)}`;
        if (act.action === 'stepMove') return `🚗 Step Move (${act.stepX}, ${act.stepY}, ${act.stepZ}) → ${resolveTargetNamesText(sourceModel, act.targetObjectIds)}`;
        if (act.action === 'toggleTargetVisibility') return `👁️ Toggle Visibility → ${resolveTargetNamesText(sourceModel, act.targetObjectIds)}`;
        if (act.action === 'playSound') return `🎵 Audio: ${act.audioFile}`;
        if (act.action === 'changeColor') return `🎨 Change Color → ${resolveTargetNamesText(sourceModel, act.targetObjectIds)}`;
        if (act.action === 'rotateAnim') return `↻ Manual Rotation → ${resolveTargetNamesText(sourceModel, act.targetObjectIds)}`;
        if (act.action === 'changeScene') {
            const projectScenesMeta = getProjectScenesMeta();
            const meta = projectScenesMeta.find(s => s.id === act.targetSceneId);
            return `🎬 Switch Scene: ${meta ? meta.name : '(scene deleted)'}`;
        }
        return `⚡ Action`;
    }

    function renderSavedActionsList() {
        const selectedModel = getSelectedModel();
        savedActionsList.innerHTML = "";

        if (!selectedModel || !selectedModel.userData.interactions || selectedModel.userData.interactions.length === 0) {
            savedActionsList.innerHTML = `<li class="hierarchy-empty-msg">No actions registered</li>`;
            return;
        }

        selectedModel.userData.interactions.forEach((act) => {
            const li = document.createElement('li');
            li.className = 'hierarchy-item';

            let badgeClass = 'badge-hover';
            let badgeText = 'HOVER';
            if (act.trigger === 'onClick') {
                badgeClass = 'badge-click';
                badgeText = 'CLICK';
            } else if (act.trigger === 'onPlaceInZone' || act.trigger === 'onUserEnterZone') {
                badgeClass = 'badge-zone';
                badgeText = 'ZONE';
            } else if (act.trigger === 'onStart') {
                badgeClass = 'badge-start';
                badgeText = 'START';
            }

            li.innerHTML = `
                <div style="display:flex; align-items:flex-start; gap:5px; flex:1; min-width:0;">
                    <span class="trigger-badge ${badgeClass}">${badgeText}</span>
                    <span class="action-item-desc" title="${getActionSummaryText(act, selectedModel)}">${getActionSummaryText(act, selectedModel)}</span>
                </div>
                <button class="btn-delete-obj" title="Delete This Action">✕</button>
            `;

            const btnDel = li.querySelector('.btn-delete-obj');
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedModel.userData.interactions = selectedModel.userData.interactions.filter(a => a.id !== act.id);
                renderSavedActionsList();
                scheduleAutoSave();
            });

            savedActionsList.appendChild(li);
        });
    }

    // Cetuskan semua tindakan "onStart" (Sebaik Scene Dimulakan) sekali sahaja setiap
    // kali kandungan scene benar-benar jadi aktif/kelihatan pada pengguna — dipanggil
    // dari applyPreviewVisibilityAndCamera (non-AR) dan placeContentAtDefault/Reticle (AR),
    // supaya ia tercetus betul-betul "sebaik shj link/QR view diaktifkan".
    function fireSceneStartTriggers() {
        const loadedModelsList = getLoadedModelsList();
        // Reset status animasi (play/pause/toggleReverse) ke keadaan asal SETIAP
        // kali scene "bermula" (Pratonton dimasuki, AR diletak semula, dll) —
        // kalau tidak, status main/jeda terbawa dari sesi sebelumnya, jadi
        // tindakan "Mula/Henti Animasi" yang dipasang pada onStart akan
        // selang-seli (sekali main, sekali jeda) bukan sentiasa main semula
        // dari permulaan macam sepatutnya bila "scene baru bermula".
        loadedModelsList.forEach(m => {
            if (m.userData.mixer && m.userData.animAction) {
                m.userData.animAction.stop();
                m.userData.animAction.reset();
                m.userData.animAction.paused = false;
                m.userData.animState = 'stopped';
                m.userData.mixer.update(0);
            }
        });

        loadedModelsList.forEach(m => {
            if (m.userData.interactions && m.userData.interactions.some(act => act.trigger === 'onStart')) {
                triggerInteraction(m, 'onStart');
            }
        });
    }

    // ZON SASARAN — semak sama ada objek yang baru dilepas bertindih/berada dalam
    // mana-mana zon yang memantaunya, guna kotak sempadan (Box3) sebenar bukan
    // anggaran jarak-ke-radius. Setiap tindakan boleh pilih syarat sendiri:
    // "collision" (bersentuh/bertindih sahaja) atau "fullyInside" (objek perlu
    // sepenuhnya berada dalam zon).
    // Pulangkan true kalau objek berjaya "terdok" dalam sekurang-kurangnya satu zon
    // (dipakai oleh onControllerSelectEnd untuk putuskan sama ada perlu kembalikan
    // objek ke kedudukan asal — kalau dah terdok, jangan kembalikan).
    function checkPlacementZones(droppedObject) {
        let docked = false;
        const loadedModelsList = getLoadedModelsList();

        loadedModelsList.forEach(zoneObj => {
            if (zoneObj.userData.primType !== 'zone' || !zoneObj.userData.interactions) return;

            const matches = zoneObj.userData.interactions.filter(act =>
                act.trigger === 'onPlaceInZone' &&
                Array.isArray(act.watchObjectIds) &&
                act.watchObjectIds.some(wid => wid == droppedObject.userData.id)
            );
            if (matches.length === 0) return;

            const zoneBox = new THREE.Box3().setFromObject(zoneObj);
            const objBox = new THREE.Box3().setFromObject(droppedObject);
            const isColliding = zoneBox.intersectsBox(objBox);
            const isFullyInside = isColliding && zoneBox.containsBox(objBox);

            const satisfied = matches.some(act =>
                act.zoneTriggerMode === 'fullyInside' ? isFullyInside : isColliding
            );
            if (!satisfied) return;

            droppedObject.position.copy(zoneObj.position);
            droppedObject.quaternion.copy(zoneObj.quaternion);

            // Objek "terdok" dalam zon — kunci badan fiziknya jadi statik supaya ia
            // kekal di situ (tak jatuh/terlantun lagi disebabkan graviti/pelanggaran).
            const dockedBody = droppedObject.userData._physicsBody;
            if (dockedBody) {
                dockedBody.position.set(zoneObj.position.x, zoneObj.position.y, zoneObj.position.z);
                dockedBody.quaternion.set(zoneObj.quaternion.x, zoneObj.quaternion.y, zoneObj.quaternion.z, zoneObj.quaternion.w);
                dockedBody.velocity.set(0, 0, 0);
                dockedBody.angularVelocity.set(0, 0, 0);
                dockedBody.type = CANNON.Body.STATIC;
                dockedBody.mass = 0;
                dockedBody.updateMassProperties();
            }

            triggerInteraction(zoneObj, 'onPlaceInZone');
            docked = true;
        });

        return docked;
    }

    // KEMBALIKAN OBJEK KE KEDUDUKAN/PUTARAN ASAL (bila "Kembali ke Asal Bila Dilepas"
    // ditanda) — kekal DINAMIK (bukan statik) supaya graviti/pelanggaran tetap terpakai
    // selepas kembali (contoh: kalau tempat asal tu di atas meja, ia terus berehat di situ).
    function returnObjectToOriginalTransform(obj) {
        // Guna snapshot kedudukan SEBELUM Pratonton dimasuki (previewObjectSnapshot) —
        // itu "kedudukan asal" yang pengguna maksudkan (macam dalam Editor sebelum test),
        // BUKAN userData.initialPosition (itu posisi masa objek PERTAMA kali dicipta/
        // upload, boleh dah lapuk/jauh berbeza lepas objek digerakkan dalam Editor —
        // field tu reserved untuk butang "↺ Reset Position/Reset Entire Object").
        const previewObjectSnapshot = getPreviewObjectSnapshot();
        const snap = previewObjectSnapshot && previewObjectSnapshot.get(obj.userData.id);
        if (snap) {
            obj.position.copy(snap.position);
            obj.quaternion.copy(snap.quaternion);
        } else {
            obj.position.copy(obj.userData.initialPosition);
            obj.quaternion.setFromEuler(obj.userData.initialRotation);
        }

        const body = obj.userData._physicsBody;
        if (body) {
            body.position.set(obj.position.x, obj.position.y, obj.position.z);
            body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);
        }
    }

    // ZON KEHADIRAN PENGGUNA — semak setiap bingkai sama ada kamera (pengguna sendiri,
    // bukan sesuatu objek) baru masuk ke dalam mana-mana Zon Sasaran yang ada trigger
    // "onUserEnterZone" (untuk wayfinding: pengguna sampai satu blok/titik -> tukar scene).
    // Dicetus SEKALI sahaja pada peralihan luar->dalam (edge-triggered), bukan setiap bingkai.
    function checkUserZoneEntryTriggers() {
        const loadedModelsList = getLoadedModelsList();
        const camPos = new THREE.Vector3();
        mainCamera.getWorldPosition(camPos);

        loadedModelsList.forEach(zoneObj => {
            if (zoneObj.userData.primType !== 'zone' || !zoneObj.userData.interactions) return;
            const hasEnterTrigger = zoneObj.userData.interactions.some(act => act.trigger === 'onUserEnterZone');
            if (!hasEnterTrigger) return;

            const zoneBox = new THREE.Box3().setFromObject(zoneObj);
            const isInside = zoneBox.containsPoint(camPos);
            const wasInside = !!zoneObj.userData._userInsideZone;
            zoneObj.userData._userInsideZone = isInside;

            if (isInside && !wasInside) {
                triggerInteraction(zoneObj, 'onUserEnterZone');
            }
        });
    }

    return {
        triggerInteraction, resolveTargetNamesText, getActionSummaryText, renderSavedActionsList,
        fireSceneStartTriggers, checkPlacementZones, returnObjectToOriginalTransform, checkUserZoneEntryTriggers
    };
}
