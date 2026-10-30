// Butang masuk VR/AR (WebXR) — cross-platform: headset VR, headset AR (passthrough),
// telefon Android Chrome (ARCore). Diekstrak dari index.html. Fungsi tulen — cuma guna
// parameter sendiri + navigator/document/window (tiada kebergantungan state app).
// VRButton/ARButton — versi r128 cuma sedia sebagai ES module (examples/jsm/), bukan
// classic script (examples/js/) macam pustaka lain dalam app ni, jadi ditulis semula
// di sini (logik sama seperti THREE.VRButton/ARButton rasmi) supaya tak perlu load
// fail luar. Digeneralize untuk sokong immersive-vr DAN immersive-ar (cross-platform:
// headset VR, headset AR/passthrough, telefon Android Chrome dgn ARCore).
export function createXRButton(renderer, sessionMode, label) {
    const button = document.createElement('button');
    const isAR = sessionMode === 'immersive-ar';

    function stylizeElement(element) {
        element.style.position = 'absolute';
        element.style.bottom = '20px';
        element.style.padding = '12px 6px';
        element.style.border = '1px solid #fff';
        element.style.borderRadius = '4px';
        element.style.background = 'rgba(0,0,0,0.1)';
        element.style.color = '#fff';
        element.style.font = 'normal 13px sans-serif';
        element.style.textAlign = 'center';
        element.style.opacity = '0.5';
        element.style.outline = 'none';
        element.style.zIndex = '999';
    }

    // Peranti/browser tak sokong sesi XR ni (contoh: tiada ARCore, atau
    // VR/AR session type tak disokong) — sorok terus butang (bukan papar
    // "NOT SUPPORTED") supaya pengguna automatik teruskan dengan 3D biasa
    // (OrbitControls) yang dah berfungsi sejak awal, tanpa nampak macam ralat.
    function showXRNotFound() {
        console.info(label + ' session not supported on this device/browser — falling back to regular 3D view.');
        button.style.display = 'none';
    }

    function showEnterXR() {
        let currentSession = null;

        async function onSessionStarted(session) {
            session.addEventListener('end', onSessionEnded);
            await renderer.xr.setSession(session);
            button.textContent = 'EXIT ' + label;
            currentSession = session;
        }

        function onSessionEnded() {
            currentSession.removeEventListener('end', onSessionEnded);
            button.textContent = 'ENTER ' + label;
            currentSession = null;
        }

        button.style.display = '';
        button.style.cursor = 'pointer';
        button.style.left = 'calc(50% - 50px)';
        button.style.width = '100px';
        button.textContent = 'ENTER ' + label;

        button.onmouseenter = () => { button.style.opacity = '1.0'; };
        button.onmouseleave = () => { button.style.opacity = '0.5'; };
        button.onclick = () => {
            if (currentSession === null) {
                // 'dom-overlay' disenaraikan dlm optionalFeatures tapi spec WebXR DOM
                // Overlays PERLUKAN `domOverlay: {root}` turut dihantar utk feature tu
                // SEBENARNYA diaktifkan — tanpa ni, browser terus SOROK semua DOM biasa
                // (info-popup, HUD diagnostik, dll) sepanjang sesi AR/VR immersive,
                // walaupun fitur disenaraikan. Punca "HUD diagnostik tak nampak
                // langsung" di AR telefon (2026-10-29).
                const sessionInit = isAR
                    ? { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay', 'hit-test'], domOverlay: { root: document.body } }
                    : { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
                navigator.xr.requestSession(sessionMode, sessionInit).then(onSessionStarted);
            } else {
                currentSession.end();
            }
        };
    }

    if ('xr' in navigator) {
        button.id = sessionMode + '-button';
        button.style.display = 'none';
        stylizeElement(button);

        navigator.xr.isSessionSupported(sessionMode).then(function (supported) {
            supported ? showEnterXR() : showXRNotFound();
        }).catch(() => showXRNotFound());

        return button;
    } else {
        // Browser ni langsung tiada WebXR API (contoh: Safari/iOS) — jangan
        // papar sebarang mesej/link yang nampak macam ralat. Just sorokkan
        // sepenuhnya dan biar 3D view (OrbitControls) jadi pengalaman default.
        console.info('WebXR API not available in this browser' + (window.isSecureContext === false ? ' (page is not HTTPS)' : '') + ' — falling back to regular 3D view.');
        const placeholder = document.createElement('div');
        placeholder.style.display = 'none';
        return placeholder;
    }
}
