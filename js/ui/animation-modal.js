// Dropdown sasaran (objek/scene/audio/zon) + modal preview/scrub animasi 3D-bina-dalam —
// diekstrak dari index.html. Semua rujukan DOM/state dihantar sebagai getter (byk
// diisytiharkan LEWAT dlm index.html) — lihat nota serupa dalam inspector.js/hierarchy.js.
export function createAnimationModal({
    getSelectAction, getSelectTargetObjects, getLoadedModelsList, getSelectedModel,
    getSelectTargetScene, getProjectScenesMeta, getActiveSceneId,
    getSelectAudioFile, getUploadedAudios, getSelectWatchObjects, getPreviewCameraMarker,
    getAnimModal, getAnimModalTitle, getAnimScrubber, getAnimSpeedSelect, getAnimBtnPlayPause,
    getAnimModalTarget, setAnimModalTarget
}) {
    function getAnimPreviewTarget() {
        const selectAction = getSelectAction();
        const selectedModel = getSelectedModel();
        if (selectAction.value === 'toggleModelAnim') {
            const selectTargetObjects = getSelectTargetObjects();
            const targetIds = Array.from(selectTargetObjects.selectedOptions).map(opt => opt.value).filter(v => v !== "");
            if (targetIds.length > 0) {
                const loadedModelsList = getLoadedModelsList();
                const found = loadedModelsList.find(o => String(o.userData.id) === String(targetIds[0]));
                if (found) return found;
            }
        }
        return selectedModel;
    }

    function updateTargetSceneDropdown() {
        const selectTargetScene = getSelectTargetScene();
        const activeSceneId = getActiveSceneId();
        selectTargetScene.innerHTML = '';
        getProjectScenesMeta().forEach(meta => {
            const opt = document.createElement('option');
            opt.value = meta.id;
            const isCurrent = meta.id === activeSceneId;
            opt.textContent = isCurrent ? `🎬 ${meta.name} (Scene Semasa)` : `🎬 ${meta.name}`;
            selectTargetScene.appendChild(opt);
        });
    }

    function updateAudioDropdown() {
        const selectAudioFile = getSelectAudioFile();
        selectAudioFile.innerHTML = "";
        const keys = Object.keys(getUploadedAudios());
        if (keys.length === 0) {
            selectAudioFile.innerHTML = `<option value="">-- No Audio File Uploaded --</option>`;
            return;
        }

        keys.forEach(fileName => {
            const opt = document.createElement('option');
            opt.value = fileName;
            opt.textContent = fileName;
            selectAudioFile.appendChild(opt);
        });
    }

    function updateTargetObjectDropdown(animOnly) {
        const selectTargetObjects = getSelectTargetObjects();
        const selectedModel = getSelectedModel();
        selectTargetObjects.innerHTML = "";

        let candidates = getLoadedModelsList();
        if (animOnly) {
            candidates = candidates.filter(obj => obj.userData.mixer && obj.userData.animAction);
        }

        candidates.forEach(obj => {
            const opt = document.createElement('option');
            opt.value = obj.userData.id;
            const isSelf = selectedModel && obj.userData.id === selectedModel.userData.id;
            opt.textContent = isSelf ? `🎯 ${obj.userData.fileName} (This Object)` : `📦 ${obj.userData.fileName}`;
            if (isSelf) opt.selected = true;
            selectTargetObjects.appendChild(opt);
        });

        if (animOnly && candidates.length === 0) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "-- No objects with animation to play --";
            opt.disabled = true;
            selectTargetObjects.appendChild(opt);
        }
    }

    // ZON SASARAN — dropdown pilih objek "Boleh Diambil" yang dipantau oleh zon ni
    function updateWatchObjectDropdown() {
        const selectWatchObjects = getSelectWatchObjects();
        const selectedModel = getSelectedModel();
        selectWatchObjects.innerHTML = "";

        getLoadedModelsList().forEach(obj => {
            if (!obj.userData.isGrabbable) return;
            if (selectedModel && obj.userData.id === selectedModel.userData.id) return;
            const opt = document.createElement('option');
            opt.value = obj.userData.id;
            opt.textContent = `🤏 ${obj.userData.fileName}`;
            selectWatchObjects.appendChild(opt);
        });

        if (selectWatchObjects.options.length === 0) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "-- No 'Grabbable' objects yet --";
            opt.disabled = true;
            selectWatchObjects.appendChild(opt);
        }
    }

    function getTargetObjects(sourceModel, targetIdsArray) {
        if (!targetIdsArray || !Array.isArray(targetIdsArray) || targetIdsArray.length === 0) {
            return [sourceModel];
        }

        const previewCameraMarker = getPreviewCameraMarker();
        const loadedModelsList = getLoadedModelsList();
        const targets = [];
        targetIdsArray.forEach(id => {
            if (id === 'self') {
                if (!targets.includes(sourceModel)) targets.push(sourceModel);
            } else if (previewCameraMarker && id == previewCameraMarker.userData.id) {
                if (!targets.includes(previewCameraMarker)) targets.push(previewCameraMarker);
            } else {
                const found = loadedModelsList.find(o => o.userData.id == id);
                if (found && !targets.includes(found)) targets.push(found);
            }
        });

        return targets.length > 0 ? targets : [sourceModel];
    }

    // -------------------------------------------------------------
    // LOGIK MODAL INSPECTOR & PREVIEW MASA ANIMASI
    // -------------------------------------------------------------
    function openAnimModal() {
        const target = getAnimPreviewTarget();
        if (!target || !target.userData.mixer || !target.userData.animAction) {
            alert("This object has no built-in 3D animation to test.");
            return;
        }
        setAnimModalTarget(target);
        const animModalTarget = target;

        const action = animModalTarget.userData.animAction;
        const duration = action.getClip().duration;

        getAnimModalTitle().innerText = animModalTarget.userData.fileName;
        const animScrubber = getAnimScrubber();
        animScrubber.max = duration;
        animScrubber.value = action.time || 0;
        getAnimSpeedSelect().value = action.timeScale || 1.0;

        action.play();
        action.paused = false;

        getAnimModal().style.display = "block";
        getAnimBtnPlayPause().innerText = "⏸ Pause";
    }

    function closeAnimModal() {
        getAnimModal().style.display = "none";
        const animModalTarget = getAnimModalTarget();
        if (animModalTarget && animModalTarget.userData.animAction) {
            animModalTarget.userData.animAction.timeScale = 1.0;
        }
        setAnimModalTarget(null);
    }

    return {
        getAnimPreviewTarget, updateTargetSceneDropdown, updateAudioDropdown,
        updateTargetObjectDropdown, updateWatchObjectDropdown, getTargetObjects,
        openAnimModal, closeAnimModal
    };
}
