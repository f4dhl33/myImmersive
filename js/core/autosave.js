// Status simpan (teks UI) + auto-save berdebounce — diekstrak dari index.html. Dipanggil
// dari HAMPIR SETIAP titik perubahan objek di seluruh app (togol flag, transform, tambah/
// padam objek, tukar scene, dll), jadi turut jadi tempat selamat utk "cuba bina semula"
// paparan debug collider (Show Colliders) masa Editing — lihat komen dalam
// scheduleAutoSave().
export function createAutosave({
    getIsPreviewMode, getIsRestoringProject, getActiveProjectId,
    buildEditColliderDebug, saveCurrentProject
}) {
    function setSaveStatusText(text) {
        const el = document.getElementById('save-status-text');
        if (el) el.innerText = text;
    }

    let editColliderDebugTimer = null;
    let autoSaveTimer = null;

    function scheduleAutoSave() {
        clearTimeout(editColliderDebugTimer);
        editColliderDebugTimer = setTimeout(buildEditColliderDebug, 150);

        // PENTING: JANGAN simpan semasa Pratonton aktif — posisi/putaran objek masa tu
        // adalah hasil fizik/interaksi UJIAN sahaja (grab/drop, graviti, bounce...), bukan
        // layout yang pengguna sahkan dalam Editor. Grab-release dsb. turut panggil
        // scheduleAutoSave(), jadi tanpa gari ni, keadaan "rosak" masa test (cth: objek
        // terbalik) akan ditulis terus ke Supabase sebelum sempat dipulihkan bila keluar
        // Pratonton — refresh/masuk balik lepas tu akan muatkan keadaan rosak tu secara KEKAL.
        if (getIsPreviewMode()) return;

        if (getIsRestoringProject() || !getActiveProjectId()) return;
        setSaveStatusText('⏳ Saving...');
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            saveCurrentProject();
        }, 800);
    }

    return { setSaveStatusText, scheduleAutoSave };
}
