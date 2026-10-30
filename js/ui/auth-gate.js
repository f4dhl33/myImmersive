// Skrin gate (Auth & Senarai Projek) — diekstrak dari index.html. Pendaftaran/log masuk
// sebenar (signUpUser/signInUser/dll) & wiring borang kekal di index.html (byk rujukan
// silang dgn currentUser/authMode terus) — fail ni cuma fungsi paparan/navigasi gate.
export function createAuthGate({
    getCurrentUser,
    getActiveProjectIsPublic,
    setActiveProjectId, setActiveProjectName, setActiveProjectIsPublic,
    loadProjectIntoEditor,
    fetchMyProjects, renameProjectRow, deleteProjectRow,
    setAuthModeVar
}) {
    function showAuthGate() {
        document.getElementById('auth-gate').style.display = 'flex';
        document.getElementById('project-gate').style.display = 'none';
    }

    function showProjectGate() {
        const currentUser = getCurrentUser();
        document.getElementById('auth-gate').style.display = 'none';
        document.getElementById('project-gate').style.display = 'flex';
        document.getElementById('gate-email-display').textContent = currentUser ? currentUser.email : '-';
        renderProjectGateList();
    }

    function updatePublicToggleButton() {
        const btn = document.getElementById('btn-toggle-public');
        if (getActiveProjectIsPublic()) {
            btn.textContent = '🌐 Public';
            btn.style.background = '#28a745';
        } else {
            btn.textContent = '🔒 Private';
            btn.style.background = '';
        }
    }

    async function openProjectById(projectId, name, isPublic) {
        setActiveProjectId(projectId);
        setActiveProjectName(name);
        setActiveProjectIsPublic(!!isPublic);
        document.getElementById('project-name-label').innerText = name;
        updatePublicToggleButton();

        await loadProjectIntoEditor(projectId);

        document.getElementById('auth-gate').style.display = 'none';
        document.getElementById('project-gate').style.display = 'none';
    }

    async function renderProjectGateList() {
        const currentUser = getCurrentUser();
        const list = document.getElementById('project-gate-list');
        list.innerHTML = '<li style="cursor:default; color:#666;">Loading...</li>';

        const projects = await fetchMyProjects(currentUser.id);

        if (projects.length === 0) {
            list.innerHTML = '<li style="cursor:default; color:#666; font-style:italic;">No projects yet — create one below.</li>';
            return;
        }

        list.innerHTML = '';
        projects.forEach(p => {
            const li = document.createElement('li');
            const updated = p.updated_at ? new Date(p.updated_at).toLocaleString() : '';
            li.innerHTML = `
                <span class="media-title-text" style="max-width:180px;">📁 ${p.name}${p.is_public ? ' 🌐' : ''}<span class="project-meta">Updated: ${updated}</span></span>
                <div class="hierarchy-item-actions">
                    <button class="btn-vis-obj" title="Rename Project">✏️</button>
                    <button class="btn-delete-obj" title="Delete Project">✕</button>
                </div>
            `;

            li.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-obj') || e.target.closest('.btn-vis-obj')) return;
                openProjectById(p.id, p.name, p.is_public);
            });

            const btnRename = li.querySelector('.btn-vis-obj');
            btnRename.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newName = prompt('New name for this project:', p.name);
                if (!newName || newName.trim() === '') return;
                await renameProjectRow(p.id, newName.trim());
                renderProjectGateList();
            });

            const btnDel = li.querySelector('.btn-delete-obj');
            btnDel.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete project "${p.name}"?\n\nAll scenes & files in this project will be lost. This action cannot be undone.`)) return;
                await deleteProjectRow(p.id);
                renderProjectGateList();
            });

            list.appendChild(li);
        });
    }

    function showAuthNormalFields() {
        document.getElementById('auth-forgot-fields').style.display = 'none';
        document.getElementById('auth-newpass-fields').style.display = 'none';
        document.getElementById('auth-normal-fields').style.display = 'block';
    }

    function setAuthMode(mode) {
        setAuthModeVar(mode);
        const authErrorEl = document.getElementById('auth-error');
        const authSubmitBtn = document.getElementById('auth-submit-btn');
        const authModeToggleQuestion = document.getElementById('auth-mode-toggle-question');
        const linkToggleAuthMode = document.getElementById('link-toggle-auth-mode');
        authErrorEl.textContent = '';
        if (mode === 'signup') {
            authSubmitBtn.textContent = 'Sign Up';
            authModeToggleQuestion.textContent = 'Already have an account?';
            linkToggleAuthMode.textContent = 'Sign In';
        } else {
            authSubmitBtn.textContent = 'Sign In';
            authModeToggleQuestion.textContent = "Don't have an account?";
            linkToggleAuthMode.textContent = 'Create one';
        }
        showAuthNormalFields();
    }

    return {
        showAuthGate, showProjectGate, updatePublicToggleButton, openProjectById,
        renderProjectGateList, showAuthNormalFields, setAuthMode
    };
}
