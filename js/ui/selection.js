// Pilih/nyahpilih objek (sync panel Inspector + hierarchy + gizmo) — diekstrak dari
// index.html. Getter dipakai utk elak andaian urutan declare DOM const di index.html.
export function createSelection({
    getIsPreviewMode, setSelectedModel,
    getTransformControls, getChkInitialHidden, getChkColliderActiveWhenHidden,
    getChkIsCutter, getChkExcludeFromCutout, getChkGrabbable, getChkSolid, getChkReturnOnRelease,
    getInputBounciness, getSelectAction, getInfoPopup,
    syncReturnOnReleaseAvailability, syncColliderTrimInputsFromModel, syncShapeAppearanceFromModel,
    updateTransformInputsFromModel, clearTransformInputs,
    updateWatchObjectDropdown, updateHierarchyUISelection, renderSavedActionsList, closeAnimModal
}) {
    function selectObject(model) {
        if (getIsPreviewMode()) return;

        setSelectedModel(model);
        getTransformControls().attach(model);
        document.getElementById('selected-object-name').textContent = model.userData.fileName || model.name;
        document.getElementById('object-editing-fields').classList.remove('panel-disabled');

        getChkInitialHidden().checked = (model.userData.initialVisibility === false);
        getChkColliderActiveWhenHidden().checked = !!model.userData.colliderActiveWhenHidden;
        getChkIsCutter().checked = !!model.userData.isCutter;
        getChkExcludeFromCutout().checked = !!model.userData.excludeFromCutout;
        getChkGrabbable().checked = !!model.userData.isGrabbable;
        getChkSolid().checked = !!model.userData.isSolid;
        getChkReturnOnRelease().checked = !!model.userData.returnToOriginalOnRelease;
        syncReturnOnReleaseAvailability();
        getInputBounciness().value = (typeof model.userData.bounciness === 'number') ? model.userData.bounciness : 0.4;
        syncColliderTrimInputsFromModel(model);
        syncShapeAppearanceFromModel(model);
        updateTransformInputsFromModel(model);

        if (model.userData.interaction && (!model.userData.interactions || model.userData.interactions.length === 0)) {
            model.userData.interactions = [
                { ...model.userData.interaction, id: Date.now() + Math.random() }
            ];
            delete model.userData.interaction;
        }

        if (!model.userData.interactions) {
            model.userData.interactions = [];
        }

        const selectAction = getSelectAction();
        selectAction.value = 'popInfo';
        selectAction.dispatchEvent(new Event('change'));
        // Segar semula senarai "Objek Dipantau" kalau trigger kekal di onPlaceInZone
        // merentasi tukar pilihan objek (cth: pilih Zon lain untuk konfigurasi).
        if (document.getElementById('select-trigger').value === 'onPlaceInZone') {
            updateWatchObjectDropdown();
        }
        updateHierarchyUISelection();
        renderSavedActionsList();
    }

    function deselectObject() {
        setSelectedModel(null);
        getTransformControls().detach();
        document.getElementById('selected-object-name').textContent = "No Object Selected";
        document.getElementById('object-editing-fields').classList.add('panel-disabled');
        getChkInitialHidden().checked = false;
        getChkColliderActiveWhenHidden().checked = false;
        getChkIsCutter().checked = false;
        getChkExcludeFromCutout().checked = false;
        getChkGrabbable().checked = false;
        getChkSolid().checked = false;
        getChkReturnOnRelease().checked = false;
        syncReturnOnReleaseAvailability();
        getInputBounciness().value = 0.4;
        syncColliderTrimInputsFromModel(null);
        syncShapeAppearanceFromModel(null);
        clearTransformInputs();
        getInfoPopup().style.display = 'none';
        closeAnimModal();
        updateHierarchyUISelection();
        renderSavedActionsList();
    }

    return { selectObject, deselectObject };
}
