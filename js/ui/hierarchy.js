// Senarai hierarki (objek 3D + media audio) dalam panel kiri — diekstrak dari index.html.
// Banyak getter/setter/callback sebab senarai ni "live" terhadap hampir semua state app
// (selectedModel, loadedModelsList, uploadedAudios, hideCameraHelperPref, activeAudioElement)
// dan setiap baris ada butang yang panggil balik ke sistem lain (selectObject, deleteObject,
// scheduleAutoSave, updateAudioDropdown) — index.html kekal punca kebenaran utk semua tu.
export function createHierarchy({
    getSelectedModel, getPreviewCameraMarker, getLoadedModelsList, getUploadedAudios,
    getHideCameraHelperPref, setHideCameraHelperPref, getIsPreviewMode, getCameraHelper,
    getActiveAudioElement, setActiveAudioElement,
    selectObject, deleteObject, scheduleAutoSave, updateAudioDropdown
}) {
    function renderObjectsList() {
        const selectedModel = getSelectedModel();
        const previewCameraMarker = getPreviewCameraMarker();
        const loadedModelsList = getLoadedModelsList();

        const tree = document.getElementById('hierarchy-tree-objects');
        tree.innerHTML = "";

        const liCam = document.createElement('li');
        liCam.className = `hierarchy-item camera-item ${selectedModel === previewCameraMarker ? 'selected' : ''}`;
        liCam.dataset.id = previewCameraMarker.userData.id;
        liCam.innerHTML = `
            <span>${previewCameraMarker.userData.fileName}</span>
            <label class="camera-row-toggle" title="Hide the camera frustum helper (yellow/white lines in the 3D viewport) while editing — doesn't affect the camera object itself.">
                <input type="checkbox" id="chk-hide-camera-row">📷
            </label>
        `;
        liCam.addEventListener('click', (e) => {
            e.stopPropagation();
            selectObject(previewCameraMarker);
        });

        const chkHideCameraHelper = liCam.querySelector('#chk-hide-camera-row');
        chkHideCameraHelper.checked = getHideCameraHelperPref();
        chkHideCameraHelper.addEventListener('click', (e) => e.stopPropagation());
        chkHideCameraHelper.addEventListener('change', () => {
            setHideCameraHelperPref(chkHideCameraHelper.checked);
            localStorage.setItem('hideCameraHelperInViewport', chkHideCameraHelper.checked ? '1' : '0');
            if (!getIsPreviewMode()) getCameraHelper().visible = !chkHideCameraHelper.checked;
        });

        tree.appendChild(liCam);

        if (loadedModelsList.length === 0) return;

        loadedModelsList.forEach((model) => {
            const li = document.createElement('li');
            li.className = `hierarchy-item ${selectedModel === model ? 'selected' : ''}`;
            li.dataset.id = model.userData.id;

            // Nota: togol "visible/hidden initial" (👁️) sengaja dibuang dari sini — dah
            // ada dalam panel kanan (Physics Settings → Visibility), tak perlu duplikat.
            li.innerHTML = `
                <span class="media-title-text">${model.userData.fileName} ${model.userData.mixer ? '🎬' : ''}</span>
                <div class="hierarchy-item-actions">
                    <button class="btn-rename-obj" title="Rename Object">✏️</button>
                    <button class="btn-delete-obj" title="Delete This Model">✕</button>
                </div>
            `;

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                selectObject(model);
            });

            const btnRename = li.querySelector('.btn-rename-obj');
            btnRename.addEventListener('click', (e) => {
                e.stopPropagation();
                const newName = prompt('New name for this object:', model.userData.fileName);
                if (!newName || newName.trim() === '') return;
                model.userData.fileName = newName.trim();
                if (getSelectedModel() === model) {
                    document.getElementById('selected-object-name').textContent = model.userData.fileName;
                }
                renderObjectsList();
                scheduleAutoSave();
            });

            const btnDel = li.querySelector('.btn-delete-obj');
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                const objLabel = model.userData.fileName || 'this object';
                if (!confirm(`Delete "${objLabel}"?\n\nThis action cannot be undone.`)) return;
                deleteObject(model);
            });

            tree.appendChild(li);
        });
    }

    function renderMediaList() {
        const uploadedAudios = getUploadedAudios();
        const tree = document.getElementById('hierarchy-tree-media');
        tree.innerHTML = "";

        const keys = Object.keys(uploadedAudios);
        if (keys.length === 0) {
            tree.innerHTML = `<li class="hierarchy-empty-msg">No media files imported</li>`;
            return;
        }

        keys.forEach((fileName) => {
            const li = document.createElement('li');
            li.className = 'hierarchy-item';

            li.innerHTML = `
                <span class="media-title-text">🎵 ${fileName}</span>
                <div class="hierarchy-item-actions">
                    <button class="btn-play-audio" title="Test This Sound">▶</button>
                    <button class="btn-delete-obj" title="Delete This Audio">✕</button>
                </div>
            `;

            const btnPlay = li.querySelector('.btn-play-audio');
            btnPlay.addEventListener('click', (e) => {
                e.stopPropagation();
                const activeAudioElement = getActiveAudioElement();
                if (activeAudioElement) {
                    activeAudioElement.pause();
                }
                setActiveAudioElement(new Audio(uploadedAudios[fileName]));
                getActiveAudioElement().play();
            });

            const btnDel = li.querySelector('.btn-delete-obj');
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm(`Delete audio file "${fileName}"?\n\nThis action cannot be undone. Any "Play Audio" action using this file will fail.`)) return;
                delete uploadedAudios[fileName];
                updateAudioDropdown();
                renderMediaList();
                scheduleAutoSave();
            });

            tree.appendChild(li);
        });
    }

    function updateHierarchyUISelection() {
        const selectedModel = getSelectedModel();
        const items = document.querySelectorAll('#hierarchy-tree-objects .hierarchy-item');
        items.forEach(item => {
            if (selectedModel && item.dataset.id == selectedModel.userData.id) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    return { renderObjectsList, renderMediaList, updateHierarchyUISelection };
}
