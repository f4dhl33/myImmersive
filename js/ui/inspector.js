// Panel Inspector (medan Transform, trim collider, rupa bentuk asas) — diekstrak dari
// index.html. Semua rujukan elemen DOM/state dihantar sebagai GETTER (bukan nilai terus)
// supaya factory ni boleh di-instantiate SEBELUM sesetengah elemen tu diisytiharkan dalam
// index.html (elak isu TDZ `const`) — kos tambahan getter ni kecil berbanding perlu jaga
// urutan declare yang tepat setiap kali index.html disusun semula.
export function createInspector({
    THREE,
    getTransformNumericInputs, getInputPosX, getInputPosY, getInputPosZ,
    getInputRotX, getInputRotY, getInputRotZ, getInputScaleX, getInputScaleY, getInputScaleZ,
    getColliderTrimInputs, getPreviewCameraMarker, getShapeAppearanceSection, getInputShapeColor,
    getSelectedModel, recordAndApplyTransform, scheduleAutoSave
}) {
    function updateTransformInputsFromModel(model) {
        const transformNumericInputs = getTransformNumericInputs();
        if (!model || document.activeElement && transformNumericInputs.includes(document.activeElement)) return;
        getInputPosX().value = model.position.x.toFixed(3);
        getInputPosY().value = model.position.y.toFixed(3);
        getInputPosZ().value = model.position.z.toFixed(3);
        getInputRotX().value = THREE.MathUtils.radToDeg(model.rotation.x).toFixed(1);
        getInputRotY().value = THREE.MathUtils.radToDeg(model.rotation.y).toFixed(1);
        getInputRotZ().value = THREE.MathUtils.radToDeg(model.rotation.z).toFixed(1);
        getInputScaleX().value = model.scale.x.toFixed(3);
        getInputScaleY().value = model.scale.y.toFixed(3);
        getInputScaleZ().value = model.scale.z.toFixed(3);
    }

    function clearTransformInputs() {
        getTransformNumericInputs().forEach(input => { input.value = ''; });
    }

    function applyTransformInputsToModel() {
        const selectedModel = getSelectedModel();
        if (!selectedModel) return;
        recordAndApplyTransform(selectedModel, () => {
            selectedModel.position.set(
                parseFloat(getInputPosX().value) || 0,
                parseFloat(getInputPosY().value) || 0,
                parseFloat(getInputPosZ().value) || 0
            );
            selectedModel.rotation.set(
                THREE.MathUtils.degToRad(parseFloat(getInputRotX().value) || 0),
                THREE.MathUtils.degToRad(parseFloat(getInputRotY().value) || 0),
                THREE.MathUtils.degToRad(parseFloat(getInputRotZ().value) || 0)
            );
            const sx = parseFloat(getInputScaleX().value);
            const sy = parseFloat(getInputScaleY().value);
            const sz = parseFloat(getInputScaleZ().value);
            selectedModel.scale.set(
                Number.isFinite(sx) && sx !== 0 ? sx : 1,
                Number.isFinite(sy) && sy !== 0 ? sy : 1,
                Number.isFinite(sz) && sz !== 0 ? sz : 1
            );
        });
        scheduleAutoSave();
    }

    // PEMBAIKAN OPACITY GIZMO
    function isAxisMatch(childName, activeAxis) {
        if (!childName || !activeAxis) return false;
        if (childName === activeAxis) return true;
        const normActive = activeAxis.replace(/^(R|S)/, '');
        const normChild = childName.replace(/^(R|S)/, '');
        return normActive === normChild;
    }

    function syncColliderTrimInputsFromModel(model) {
        const colliderTrimInputs = getColliderTrimInputs();
        const t = (model && model.userData.colliderTrim) || { nx: 0, px: 0, ny: 0, py: 0, nz: 0, pz: 0 };
        Object.keys(colliderTrimInputs).forEach(axis => { colliderTrimInputs[axis].value = (typeof t[axis] === 'number') ? t[axis] : 0; });
    }

    // Rupa (warna/tekstur) untuk bentuk asas (box/sphere/cylinder/plane sahaja) —
    // tak terpakai untuk model GLB/FBX (dah ada material sendiri) atau imej (dah tekstur).
    function isBasicShapeMesh(model) {
        const previewCameraMarker = getPreviewCameraMarker();
        if (!model || model === previewCameraMarker) return false;
        return model.userData.kind === 'primitive' && ['box', 'sphere', 'cylinder', 'plane'].includes(model.userData.primType);
    }

    function syncShapeAppearanceFromModel(model) {
        const shapeAppearanceSection = getShapeAppearanceSection();
        if (isBasicShapeMesh(model)) {
            shapeAppearanceSection.style.display = 'block';
            getInputShapeColor().value = model.userData.customColor || '#cccccc';
        } else {
            shapeAppearanceSection.style.display = 'none';
        }
    }

    return {
        updateTransformInputsFromModel, clearTransformInputs, applyTransformInputsToModel,
        isAxisMatch, syncColliderTrimInputsFromModel, isBasicShapeMesh, syncShapeAppearanceFromModel
    };
}
