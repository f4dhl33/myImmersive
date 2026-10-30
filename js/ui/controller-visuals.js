// Laser/dot/ring visual pada controller VR/AR + raycast hover/grab-candidate — diekstrak
// dari index.html. Factory sebab byk objek THREE SEMENTARA (curve, raycaster, matrix) yang
// dikitar semula setiap bingkai, dan geometri/material laser kena dicipta SELEPAS THREE
// (bridge ESM index.html) sedia.
export function createControllerVisuals({ THREE, mainCamera, scene, contentRoot, getLoadedModelsList }) {
    const CONTROLLER_LASER_MAX_LENGTH = 5;
    const CONTROLLER_LASER_IDLE_LENGTH = 1.6;
    const CONTROLLER_LASER_RADIUS = 0.005;
    const CONTROLLER_TRIGGER_FLASH_MS = 180;

    const controllerLaserCurveP0 = new THREE.Vector3();
    const controllerLaserCurveP1 = new THREE.Vector3();
    const controllerLaserCurveP2 = new THREE.Vector3();
    const controllerLaserCurve = new THREE.QuadraticBezierCurve3(controllerLaserCurveP0, controllerLaserCurveP1, controllerLaserCurveP2);

    function buildLaserTubeGeometry(curve, tubularSegments, baseRadius, radialSegments, taperFn) {
        const frames = curve.computeFrenetFrames(tubularSegments, false);
        const points = curve.getPoints(tubularSegments);
        const positions = [];
        const indices = [];

        for (let i = 0; i <= tubularSegments; i++) {
            const t = i / tubularSegments;
            const radius = baseRadius * taperFn(t);
            const normal = frames.normals[i];
            const binormal = frames.binormals[i];
            const center = points[i];
            for (let j = 0; j <= radialSegments; j++) {
                const angle = (j / radialSegments) * Math.PI * 2;
                const sin = Math.sin(angle), cos = -Math.cos(angle);
                const x = cos * normal.x + sin * binormal.x;
                const y = cos * normal.y + sin * binormal.y;
                const z = cos * normal.z + sin * binormal.z;
                positions.push(center.x + radius * x, center.y + radius * y, center.z + radius * z);
            }
        }

        for (let i = 1; i <= tubularSegments; i++) {
            for (let j = 1; j <= radialSegments; j++) {
                const a = (radialSegments + 1) * (i - 1) + (j - 1);
                const b = (radialSegments + 1) * i + (j - 1);
                const c = (radialSegments + 1) * i + j;
                const d = (radialSegments + 1) * (i - 1) + j;
                indices.push(a, b, d, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        return geometry;
    }

    const laserTaperFull = () => 1;
    // Idle: jejari kekal penuh untuk 60% awal, lepas tu menirus terus ke 0 di
    // hujung — nampak "hilang" secara natural, bukan terputus tiba-tiba.
    function laserTaperIdle(t) {
        const taperStart = 0.6;
        if (t < taperStart) return 1;
        return 1 - (t - taperStart) / (1 - taperStart);
    }

    function buildControllerLaserCurveGeometry(distance, isIdle) {
        // Idle: tangen/lengkung dikurangkan supaya nampak lebih lurus (sebab
        // laser ni belum "mengunci" apa-apa sasaran). Bila kena objek, kekal
        // lengkung lembut asal.
        const arc = isIdle ? Math.min(distance * 0.03, 0.06) : Math.min(distance * 0.12, 0.25);
        controllerLaserCurveP0.set(0, 0, 0);
        controllerLaserCurveP1.set(0, arc, -distance * 0.5);
        controllerLaserCurveP2.set(0, 0, -distance);
        return buildLaserTubeGeometry(controllerLaserCurve, 12, CONTROLLER_LASER_RADIUS, 6, isIdle ? laserTaperIdle : laserTaperFull);
    }

    // depthTest AKTIF — laser mesti hormat kedalaman SEBENAR dalam scene (ter-
    // sorok di belakang objek yang lebih dekat dengan kamera berbanding titik
    // yang disasar), supaya perspektif/occlusion antara dua objek berbeza jarak
    // kekal betul. depthWrite dimatikan supaya laser (nipis & lutsinar) sendiri
    // tak "menghalang" ujian kedalaman objek lut sinar lain di belakangnya.
    const controllerLaserMaterial = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    });

    const controllerDotGeometry = new THREE.SphereGeometry(0.025, 16, 16);
    // Cincin padat (bukan bebola lut sinar/halo kabur) di sekeliling titik —
    // penanda TEGAS & jelas supaya hujung laser tak nampak macam terapung
    // tanpa kena mengena dengan objek, walaupun titik sendiri kecil dari jauh.
    const controllerRingGeometry = new THREE.RingGeometry(0.032, 0.044, 24);

    // Dipanggil sekali setiap controller (lihat index.html) — lekat laser/dot/ring + daftar
    // listener 'connected' yang rekod handedness/targetRayMode controller tu.
    function setupControllerLaserVisuals(ctrl) {
        ctrl.addEventListener('connected', (event) => {
            ctrl.userData.handedness = event.data && event.data.handedness;
            // 'screen' = tap input tanpa jejak kedudukan sebenar (telefon AR, pegang-skrin
            // tanpa controller fizikal) — kedudukan dunia KEKAL statik, cuma arah ray
            // berubah. 'tracked-pointer' = controller 6DOF SEBENAR (VR ATAU headset AR
            // guna controller fizikal, cth Quest passthrough) — kedudukan dunia BERGERAK
            // sebenar sama macam VR, proksi ray-plane AR TAK diperlukan/TAK sesuai utk ni.
            ctrl.userData.targetRayMode = event.data && event.data.targetRayMode;
        });

        // Bahan laser KLON berasingan setiap controller (bukan kongsi satu
        // instance) — sebab opacity dia berubah ikut status hit SETIAP
        // controller secara berasingan (idle vs kena objek).
        const laser = new THREE.Mesh(buildControllerLaserCurveGeometry(CONTROLLER_LASER_IDLE_LENGTH, true), controllerLaserMaterial.clone());
        laser.name = 'controller-laser';
        laser.renderOrder = 998;
        ctrl.add(laser);

        // Titik pada hujung laser — tunjuk dengan jelas objek apa yang sedang disasar,
        // dan laser sendiri akan pendek mengikut jarak sasaran (bukan sentiasa nampak infinity)
        const dot = new THREE.Mesh(controllerDotGeometry, new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false,
            blending: THREE.AdditiveBlending, toneMapped: false
        }));
        dot.name = 'controller-laser-dot';
        dot.position.set(0, 0, -CONTROLLER_LASER_IDLE_LENGTH);
        dot.renderOrder = 999;
        ctrl.add(dot);

        const ring = new THREE.Mesh(controllerRingGeometry, new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 1, depthTest: true, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false
        }));
        ring.name = 'controller-laser-ring';
        ring.position.set(0, 0, -CONTROLLER_LASER_IDLE_LENGTH);
        ring.renderOrder = 999;
        ring.visible = false;
        ctrl.add(ring);

        ctrl.userData.laser = laser;
        ctrl.userData.laserDot = dot;
        ctrl.userData.laserRing = ring;
        ctrl.userData.triggerFlashUntil = 0;
    }

    // Kilauan kuning/putih SEKETIKA pada hujung laser bila trigger ditekan —
    // bukan status hover berterusan (hover kekal biru). Ini bagi maklum balas
    // visual yang jelas untuk tindakan "klik" itu sendiri.
    function flashControllerTrigger(event) {
        const controller = event.target;
        const hitModel = getControllerRaycastHit(controller);
        if (hitModel) {
            controller.userData.triggerFlashUntil = performance.now() + CONTROLLER_TRIGGER_FLASH_MS;
        }
    }

    const controllerRaycaster = new THREE.Raycaster();
    const controllerTempMatrix = new THREE.Matrix4();
    const controllerTempCamPos = new THREE.Vector3();

    function getControllerRaycastHit(controller) {
        const loadedModelsList = getLoadedModelsList();
        controllerTempMatrix.identity().extractRotation(controller.matrixWorld);
        controllerRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        controllerRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(controllerTempMatrix);

        let hitModel = null;
        let hitDistance = CONTROLLER_LASER_MAX_LENGTH;

        if (loadedModelsList.length > 0) {
            const visibleObjects = loadedModelsList.filter(o => o.visible);
            const intersects = controllerRaycaster.intersectObjects(visibleObjects, true);
            if (intersects.length > 0) {
                hitDistance = Math.min(intersects[0].distance, CONTROLLER_LASER_MAX_LENGTH);
                hitModel = intersects[0].object;
                while (hitModel.parent && hitModel.parent !== scene && hitModel.parent !== contentRoot) {
                    hitModel = hitModel.parent;
                }
            }
        }

        // TIADA sasaran — laser "hilang" pada jarak pendek yang sesuai (bukan
        // sentiasa sampai jarak maksimum 5m macam rod tegar). ADA sasaran — laser
        // sambung terus ke titik hit sebenar, berapa jauh sekalipun.
        const didHit = !!hitModel;
        const displayDistance = didHit ? hitDistance : CONTROLLER_LASER_IDLE_LENGTH;

        const laser = controller.userData.laser;
        if (laser) {
            laser.geometry.dispose();
            laser.geometry = buildControllerLaserCurveGeometry(displayDistance, !didHit);
            laser.material.opacity = didHit ? 0.9 : 0.3;
        }

        // Kilauan kuning/putih HANYA seketika lepas trigger ditekan (lihat
        // flashControllerTrigger) — selain tu laser/titik kekal biru tak kira
        // sedang hover objek atau tidak.
        const isFlashing = performance.now() < (controller.userData.triggerFlashUntil || 0);
        const hitColor = isFlashing ? 0xffffff : 0x00e5ff;

        // Saiz titik berkadar SONGSANG dengan jarak — lebih besar untuk objek
        // dekat, lebih kecil untuk objek jauh (macam perspektif sebenar).
        const distT = THREE.MathUtils.clamp(displayDistance / CONTROLLER_LASER_MAX_LENGTH, 0, 1);
        const distanceScale = THREE.MathUtils.lerp(1.5, 0.7, distT);
        const flashScale = isFlashing ? 1.3 : 1;
        const markerScale = didHit ? distanceScale * flashScale : 0.55;

        // Tarik penanda sikit ke arah controller (bukan tepat di permukaan) bila
        // kena objek — elak z-fighting/kelipan dengan permukaan tu sekarang
        // depthTest dah aktif. Tak perlu kalau tiada objek dikena.
        const markerDistance = didHit ? Math.max(hitDistance - 0.01, 0.001) : displayDistance;

        const dot = controller.userData.laserDot;
        if (dot) {
            dot.visible = didHit;
            if (didHit) {
                dot.position.z = -markerDistance;
                dot.material.color.setHex(hitColor);
                dot.scale.setScalar(markerScale);
            }
        }
        const ring = controller.userData.laserRing;
        if (ring) {
            ring.visible = didHit;
            if (didHit) {
                ring.position.z = -markerDistance;
                ring.material.color.setHex(hitColor);
                ring.scale.setScalar(markerScale);
                // Billboard — cincin sentiasa hadap kamera supaya nampak sebagai
                // reticle tegas dari mana-mana sudut, bukan nipis/hilang dari tepi.
                mainCamera.getWorldPosition(controllerTempCamPos);
                ring.lookAt(controllerTempCamPos);
            }
        }

        return hitModel;
    }

    // Guna KHUSUS untuk mula genggam (bukan laser visual/klik) — skip objek
    // bukan-grabbable yang menghalang ray (cth. zon/platform tumpang-tindih
    // depan objek sebenar) dan terus cari objek grabbable paling dekat selepasnya.
    // SENGAJA tiada had jarak (CONTROLLER_LASER_MAX_LENGTH) di sini — constant tu
    // cuma clamp PANJANG VISUAL laser dalam getControllerRaycastHit (bukan tolak
    // hit yang lebih jauh; intersects[0].object situ diterima tanpa syarat jarak
    // langsung). Versi awal fungsi ni (attempt #16) tersilap tambah had jarak yang
    // tiada dlm logik asal — punca sebenar "selalu tiada hit grabbable" (hit@start)
    // walhal objek yg SAMA sentiasa kena di hit@click/laser (fungsi tu): objek
    // terletak lebih jauh drpd 5m (CONTROLLER_LASER_MAX_LENGTH), jadi loop ni asyik
    // break awal sebelum sempat check isGrabbable. Disahkan drpd data HUD sebenar
    // 2026-10-29 — lihat attempt #19 dlm memori.
    function getControllerGrabRaycastHit(controller) {
        const loadedModelsList = getLoadedModelsList();
        controllerTempMatrix.identity().extractRotation(controller.matrixWorld);
        controllerRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        controllerRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(controllerTempMatrix);

        if (loadedModelsList.length === 0) return null;
        const visibleObjects = loadedModelsList.filter(o => o.visible);
        const intersects = controllerRaycaster.intersectObjects(visibleObjects, true);
        for (let i = 0; i < intersects.length; i++) {
            let root = intersects[i].object;
            while (root.parent && root.parent !== scene && root.parent !== contentRoot) {
                root = root.parent;
            }
            if (root.userData.isGrabbable) return root;
        }
        return null;
    }

    return {
        setupControllerLaserVisuals,
        flashControllerTrigger,
        getControllerRaycastHit,
        getControllerGrabRaycastHit
    };
}
