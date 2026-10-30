// Undo/redo (sejarah transform global) — diekstrak dari index.html. undoStack/redoStack
// KEKAL sebagai variable `let` di index.html (bukan dipindah) — handler butang Undo/Redo
// serta reset projek (buka/tukar projek) turut baca/tulis terus, lihat getter/setter di sini.
export function createHistory({
    getUndoStack, setRedoStack,
    getPreviewCameraMarker, getCameraHelper,
    scheduleAutoSave, updateTransformInputsFromModel, maybeRebuildWaypointPathFor
}) {
    function pushGlobalHistory(action) {
        getUndoStack().push(action);
        setRedoStack([]);
        scheduleAutoSave();
    }

    function recordAndApplyTransform(target, applyTransformFn) {
        if (!target) return;

        const oldState = {
            position: target.position.clone(),
            rotation: target.rotation.clone(),
            scale: target.scale.clone()
        };

        applyTransformFn();

        const newState = {
            position: target.position.clone(),
            rotation: target.rotation.clone(),
            scale: target.scale.clone()
        };

        pushGlobalHistory({
            target: target,
            oldState: oldState,
            newState: newState
        });

        if (target === getPreviewCameraMarker()) getCameraHelper().update();
        updateTransformInputsFromModel(target);
        maybeRebuildWaypointPathFor(target);
    }

    return { pushGlobalHistory, recordAndApplyTransform };
}
