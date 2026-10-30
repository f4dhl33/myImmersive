// WAYPOINT / LALUAN PANDU ARAH (garis anak panah biru mengalir antara waypoint) — diekstrak
// dari index.html. Waypoint disambung ikut turutan ia muncul dalam loadedModelsList (turutan
// cipta/muat). Setiap segmen ialah satah bertekstur anak panah berulang (bukan THREE.Line —
// linewidth WebGL selalunya dipaksa 1px, jadi susah nampak dalam AR) — texture.repeat dikira
// ikut jarak sebenar supaya anak panah kekal saiz tetap (tak regang) walau segmen
// panjang/pendek.
//
// waypointArrowTexture/waypointPathMeshes KEKAL sebagai variable `let` di index.html (bukan
// dipindah ke sini) — occluder.js (createOccluder) dan animate() loop di index.html turut
// baca/tulis dua-dua ni, jadi index.html kena kekal SATU sumber kebenaran. Getter/setter di
// sini cuma baca/tulis balik ke variable yang SAMA tu.
export function createWaypoint({
    THREE, contentRoot, getLoadedModelsList,
    getCachedArrowTexture, setCachedArrowTexture,
    getWaypointPathMeshesList, setWaypointPathMeshesList
}) {
    function getWaypointArrowTexture() {
        const cached = getCachedArrowTexture();
        if (cached) return cached;
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.strokeStyle = '#29b6f6';
        ctx.lineWidth = size * 0.16;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(size * 0.2, size * 0.15);
        ctx.lineTo(size * 0.7, size * 0.5);
        ctx.lineTo(size * 0.2, size * 0.85);
        ctx.stroke();

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        setCachedArrowTexture(tex);
        return tex;
    }

    const WAYPOINT_PATH_TILE_SIZE = 0.4; // saiz dunia (meter) setiap ubin anak panah — kekal tetap walau segmen panjang/pendek
    const WAYPOINT_PATH_WIDTH = 0.25;
    const WAYPOINT_WORLD_UP = new THREE.Vector3(0, 1, 0);

    function clearWaypointPath() {
        // NOTA: material.map ialah tekstur BERKONGSI (waypointArrowTexture) — jangan dispose()
        // di sini, hanya geometri & material setiap segmen.
        getWaypointPathMeshesList().forEach(m => {
            contentRoot.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        setWaypointPathMeshesList([]);
    }

    function rebuildWaypointPath() {
        clearWaypointPath();

        const loadedModelsList = getLoadedModelsList();
        const waypoints = loadedModelsList.filter(o => o.userData.primType === 'waypoint');
        if (waypoints.length < 2) return;

        const baseTexture = getWaypointArrowTexture();
        const newMeshes = [];

        for (let i = 0; i < waypoints.length - 1; i++) {
            const a = waypoints[i].position;
            const b = waypoints[i + 1].position;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            // Jarak 3D sebenar (bukan hanya X/Z) — supaya laluan boleh condong/naik-turun
            // ikut tangga, bukan sentiasa rata.
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length < 0.001) continue;

            const forward = new THREE.Vector3(dx, dy, dz).multiplyScalar(1 / length);
            let right = new THREE.Vector3().crossVectors(forward, WAYPOINT_WORLD_UP);
            if (right.lengthSq() < 1e-6) {
                // "forward" hampir menegak (contoh tangga sangat curam) — guna rujukan lain
                right.crossVectors(forward, new THREE.Vector3(1, 0, 0));
            }
            right.normalize();
            const up = new THREE.Vector3().crossVectors(right, forward).normalize();

            const segGeometry = new THREE.PlaneGeometry(length, WAYPOINT_PATH_WIDTH);
            segGeometry.rotateX(-Math.PI / 2);

            // Skalakan UV terus (bukan clone tekstur per segmen) — semua segmen kongsi
            // SATU tekstur (murah untuk drag hidup / live-drag), anak panah kekal saiz tetap
            // sebab repeatX dikira ikut jarak sebenar segmen.
            const repeatX = Math.max(1, length / WAYPOINT_PATH_TILE_SIZE);
            const uvAttr = segGeometry.attributes.uv;
            for (let vi = 0; vi < uvAttr.count; vi++) {
                uvAttr.setX(vi, uvAttr.getX(vi) * repeatX);
            }
            uvAttr.needsUpdate = true;

            const segMaterial = new THREE.MeshBasicMaterial({
                map: baseTexture,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const segMesh = new THREE.Mesh(segGeometry, segMaterial);
            segMesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            segMesh.position.addScaledVector(up, 0.01);
            segMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, right));
            segMesh.renderOrder = 10;
            segMesh.userData.isWaypointPathSegment = true;
            // Segmen ikut flag "Exclude From Cutout" objek waypoint yang disambungkannya
            // (boleh pilih sama seperti objek biasa) — jika salah satu hujung ditanda
            // immune, segmen antara mereka pun immune.
            segMesh.userData.excludeFromCutout = !!(waypoints[i].userData.excludeFromCutout || waypoints[i + 1].userData.excludeFromCutout);

            contentRoot.add(segMesh);
            newMeshes.push(segMesh);
        }

        setWaypointPathMeshesList(newMeshes);
    }

    function maybeRebuildWaypointPathFor(target) {
        if (target && target.userData && target.userData.primType === 'waypoint') {
            rebuildWaypointPath();
        }
    }

    return { getWaypointArrowTexture, clearWaypointPath, rebuildWaypointPath, maybeRebuildWaypointPathFor };
}
