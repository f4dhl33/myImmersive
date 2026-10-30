// Panel resize handle (kiri/kanan/bawah) + kumpulan boleh-minimize (collapsible) — diekstrak
// dari index.html. Tiada kebergantungan THREE/fizik/appState — DOM & localStorage sahaja.
export function makeResizable(handle, targetPanel, axis, opts) {
    opts = opts || {};
    const min = opts.min || 150;
    const max = opts.max || 700;
    const invert = !!opts.invert;
    const storageKey = 'webxr_panel_size_' + handle.id;

    function applySize(size) {
        size = Math.max(min, Math.min(max, size));
        if (axis === 'horizontal') {
            targetPanel.style.width = size + 'px';
            targetPanel.style.minWidth = size + 'px';
        } else {
            targetPanel.style.flexBasis = size + 'px';
        }
        return size;
    }

    const savedSize = parseFloat(localStorage.getItem(storageKey));
    if (Number.isFinite(savedSize)) applySize(savedSize);

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handle.classList.add('resizing');

        const startPos = axis === 'horizontal' ? e.clientX : e.clientY;
        const startSize = axis === 'horizontal' ? targetPanel.offsetWidth : targetPanel.offsetHeight;
        document.body.style.userSelect = 'none';

        function onMouseMove(ev) {
            const currentPos = axis === 'horizontal' ? ev.clientX : ev.clientY;
            const delta = currentPos - startPos;
            const finalSize = applySize(startSize + (invert ? -delta : delta));
            localStorage.setItem(storageKey, finalSize);
            window.dispatchEvent(new Event('resize'));
        }

        function onMouseUp() {
            handle.classList.remove('resizing');
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// KUMPULAN BOLEH MINIMIZE (panel kiri + sub-seksyen panel kanan) — klik header untuk
// togol, state kekal lepas reload (localStorage). Kalau tiada state tersimpan lagi,
// kekalkan default yang dah ditetapkan dalam HTML (class "collapsed" sedia ada).
export function initCollapsibles() {
    document.querySelectorAll('.collapsible').forEach(el => {
        const header = el.querySelector('.collapsible-header');
        const body = el.querySelector('.collapsible-body');
        if (!header || !body) return;
        const key = 'uiCollapsed_' + (el.dataset.key || '');
        const stored = localStorage.getItem(key);
        if (stored === '1') el.classList.add('collapsed');
        else if (stored === '0') el.classList.remove('collapsed');
        header.addEventListener('click', () => {
            el.classList.toggle('collapsed');
            localStorage.setItem(key, el.classList.contains('collapsed') ? '1' : '0');
        });
    });
}
