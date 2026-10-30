// Gelung animate() — teras render, dipanggil renderer.setAnimationLoop(). Diekstrak dari
// index.html. Ini SENTUH HAMPIR SEMUA subsistem app (fizik, grab, occluder, trigger,
// waypoint, hover controller VR, animation mixer, hit-test AR) setiap bingkai — byk
// getter/setter sebab kebanyakan state yang disentuh diisytiharkan LEWAT berbanding titik
// asal fungsi ni dalam index.html. physicsWorld/AR_GRAB_VELOCITY_BLEND/appState/arDebug
// diimport TERUS (leaf module, selamat, bukan circular).
import { physicsWorld } from '../physics/world.js';
import { AR_GRAB_VELOCITY_BLEND } from '../interactions/grab-ar.js';
import { appState } from './state.js';
import { arDebug } from '../ui/ar-debug-hud.js';

export function createLoop({
    THREE,
    getClock, getControls, getRenderer, getScene, getMainCamera,
    getGridHelper, GRID_CELL_SIZE,
    getWaypointPathMeshes, getWaypointArrowTexture, WAYPOINT_PATH_SCROLL_SPEED,
    getIsPreviewMode, getIsARSession, getIsPlaced,
    checkUserZoneEntryTriggers,
    getChkArAutoPlace, placeContentAtDefault,
    getHitTestSourceRequested, setHitTestSourceRequested,
    getHitTestSource, setHitTestSource,
    getReticle,
    checkARTouchAwaitingGrab, checkVRPendingGrabCommit,
    getController1, getController2,
    updateARDebugHud,
    getVrPendingGrabCandidate,
    updateARGrabProxy, updateGrabbedObjectTransform,
    getControllerRaycastHit,
    getHoveredModel, setHoveredModel,
    triggerInteraction,
    updateCutoutCameraGating, syncPhysicsBodiesWithVisibility, syncEditColliderDebugPositions,
    getAnimModal, getAnimModalTarget, getIsModalScrubbing, getAnimScrubber, getAnimTimeDisplay,
    getLoadedModelsList
}) {
    function animate(timestamp, frame) {
        const renderer = getRenderer();
        const controls = getControls();
        const mainCamera = getMainCamera();
        const scene = getScene();
        const delta = getClock().getDelta();

        // OrbitControls.update() akan "rampas" balik posisi kamera drpd tracking headset
        // kalau dipanggil semasa sesi VR aktif — skip semasa presenting.
        if (!renderer.xr.isPresenting) {
            controls.update();
        }

        // Senyapkan grid ke kedudukan kamera (snap ke saiz sel) supaya kekal kelihatan
        // "tanpa hujung" tak kira sejauh mana kamera pan — hanya relevan semasa Editing
        // (grid disorok semasa Preview/AR/VR, lihat gridHelper.visible di tempat lain).
        const gridHelper = getGridHelper();
        if (gridHelper.visible) {
            gridHelper.position.x = Math.round(mainCamera.position.x / GRID_CELL_SIZE) * GRID_CELL_SIZE;
            gridHelper.position.z = Math.round(mainCamera.position.z / GRID_CELL_SIZE) * GRID_CELL_SIZE;
        }

        // ALIRAN ANAK PANAH LALUAN WAYPOINT — tekstur berkongsi, jadi satu offset menggerakkan
        // semua segmen serentak (nampak macam anak panah mengalir ke arah destinasi).
        const waypointPathMeshes = getWaypointPathMeshes();
        if (waypointPathMeshes.length > 0) {
            getWaypointArrowTexture().offset.x -= delta * WAYPOINT_PATH_SCROLL_SPEED;
        }

        const isPreviewMode = getIsPreviewMode();
        const isARSession = getIsARSession();
        let isPlaced = getIsPlaced();

        // "Pengguna masuk zon" cuma bermakna bila kamera = kedudukan sebenar
        // pengguna di dunia nyata (sesi AR/VR sebenar sedang presenting). Dalam
        // mod Pratonton desktop/mobile biasa, kamera cuma ikut orbit tetikus —
        // kalau check di sini juga, kamera yang "lalu" dekat zon semasa drag
        // rotate boleh tercetus tukar scene/reset tanpa diingini pada bila-bila
        // masa (nampak macam kamera "lompat" semasa pusing).
        if (isPreviewMode && renderer.xr.isPresenting) {
            checkUserZoneEntryTriggers();
        }

        const reticle = getReticle();

        // TAP-TO-PLACE (hit-test) — hanya semasa AR aktif & belum diletak lagi.
        // Scene boleh pilih untuk skip langkah ni terus ("Auto Letak AR") — sesuai untuk
        // scene waypoint/wayfinding yang tak perlukan pengguna tap permukaan dulu.
        if (renderer.xr.isPresenting && isPreviewMode && isARSession && !isPlaced && getChkArAutoPlace().checked) {
            placeContentAtDefault();
        } else if (renderer.xr.isPresenting && isPreviewMode && isARSession && !isPlaced && frame) {
            const referenceSpace = renderer.xr.getReferenceSpace();
            const session = renderer.xr.getSession();

            if (!getHitTestSourceRequested()) {
                setHitTestSourceRequested(true);

                if (session.requestHitTestSource) {
                    session.requestReferenceSpace('viewer').then((viewerSpace) => {
                        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                            setHitTestSource(source);
                        }).catch(() => placeContentAtDefault());
                    }).catch(() => placeContentAtDefault());

                    session.addEventListener('end', () => {
                        setHitTestSourceRequested(false);
                        setHitTestSource(null);
                    });
                } else {
                    placeContentAtDefault();
                }
            }

            const hitTestSource = getHitTestSource();
            if (hitTestSource) {
                const hitTestResults = frame.getHitTestResults(hitTestSource);
                if (hitTestResults.length > 0) {
                    const pose = hitTestResults[0].getPose(referenceSpace);
                    if (pose) {
                        reticle.visible = true;
                        reticle.matrix.fromArray(pose.transform.matrix);
                    }
                } else {
                    reticle.visible = false;
                }
            }
        } else if (!isPlaced) {
            reticle.visible = false;
        }

        const controller1 = getController1();
        const controller2 = getController2();

        // Semak calon genggam VR tertunda (klik lwn genggam) SETIAP bingkai — lihat
        // checkVRPendingGrabCommit/onControllerSelectStart.
        if (isPreviewMode) { checkARTouchAwaitingGrab(controller1, controller2); checkVRPendingGrabCommit(); }

        // HUD DIAGNOSTIK SEMENTARA — lihat nota penuh dekat deklarasi `arDebug`/
        // `updateARDebugHud` di atas. BUANG lepas bug AR grab ni disahkan selesai.
        updateARDebugHud({
            isPreviewMode, isARSession, isPresenting: renderer.xr.isPresenting,
            vrPendingGrabCandidate: getVrPendingGrabCandidate(), grabbedObject: appState.grabbedObject, grabStartState: appState.grabStartState
        });

        // Proksi genggam AR (jarak-tetap) — kemaskan SEBELUM updateGrabbedObjectTransform
        // supaya formula deltaPos sedia ada (dikira dari kedudukan "controller", dlm
        // AR ialah proksi ni) dapat kedudukan proksi TERKINI, bukan lapuk satu bingkai.
        if (isPreviewMode && appState.grabbedObject && appState.grabStartState && appState.grabStartState.arRawController) {
            updateARGrabProxy(appState.grabStartState, { mainCamera, arDebug });
        }

        let hoveredModel = getHoveredModel();

        // Objek sedang digenggam — kemaskan kedudukan/putarannya ikut "pemegang" (controller
        // VR ATAU proksi mouse desktop, dua-dua guna fungsi sama). Diperiksa dulu di luar
        // syarat isPresenting supaya grab mouse desktop (bukan sesi XR) turut jalan.
        if (isPreviewMode && appState.grabbedObject) {
            updateGrabbedObjectTransform(appState.grabbedObject, appState.grabStartState, delta, { physicsWorld, arVelocityBlend: AR_GRAB_VELOCITY_BLEND });
        } else if (renderer.xr.isPresenting && isPreviewMode) {
            // HOVER GUNA CONTROLLER VR (laser pointer) — setara logik hover tetikus desktop.
            const vrHit1 = getControllerRaycastHit(controller1);
            const vrHit2 = getControllerRaycastHit(controller2);
            const vrHit = vrHit1 || vrHit2;
            if (vrHit !== hoveredModel) {
                hoveredModel = vrHit;
                setHoveredModel(hoveredModel);
                if (hoveredModel) {
                    triggerInteraction(hoveredModel, 'onHover');
                }
            }
        }

        // FIZIK (graviti/pelanggaran/bounce) — hanya jalan bila Pratonton aktif, dan
        // dalam AR tunggu content diletak dulu (elak simulasi "tak nampak" berjalan
        // sebelum pengguna tap-to-place).
        if (appState.physicsActive && isPreviewMode && (!isARSession || isPlaced)) {
            updateCutoutCameraGating();
            syncPhysicsBodiesWithVisibility();
            if (appState.grabbedObject) {
                // PUNCA SEBENAR "trail"/"berat" semasa genggam: step(1/60, delta, 10)
                // guna accumulator langkah-tetap 1/60s — kalau delta bingkai render
                // (VR ~90Hz, atau monitor PC 120/144Hz) TAK sepadan tepat dgn 1/60,
                // accumulator skip langkah sesetengah bingkai (0 langkah) lalu kejar 2
                // langkah sekaligus di bingkai lain. updateGrabbedObjectTransform() plak
                // hanya set velocity sasaran SEKALI setiap bingkai RENDER (bukan setiap
                // langkah fizik) — jadi di bingkai "0 langkah", objek fizik tak bergerak
                // langsung walaupun kursor/controller dah gerak, punca jurang/"trail"
                // kelihatan & rasa "berat". Semasa SESUATU digenggam, step guna delta
                // SEBENAR terus (satu langkah tepat sepadan satu bingkai render, tiada
                // accumulator/skip) supaya objek genggam 1:1 ikut kelajuan
                // kursor/controller — kekal guna velocity (bukan teleport terus) supaya
                // sekatan pelanggaran dgn objek Pepejal lain KEKAL terpakai (lihat nota
                // GENGGAM + FIZIK di atas). Had atas 1/20s elak lonjakan/tak stabil kalau
                // ada bingkai tersekat/lag semasa drag.
                physicsWorld.step(Math.min(delta || 1 / 60, 1 / 20));
            } else {
                physicsWorld.step(1 / 60, delta, 10);
            }
            appState.physicsBodies.forEach(pb => {
                if (!pb.inWorld) return; // objek tersembunyi — tiada badan dlm dunia fizik, tiada posisi utk disegerak
                if (pb.body.type !== CANNON.Body.STATIC) {
                    pb.mesh.position.copy(pb.body.position);
                    pb.mesh.quaternion.copy(pb.body.quaternion);
                }
                if (pb.debugMesh && pb.debugMesh.visible) {
                    const worldOffset = pb.debugMesh.userData._localOffset.clone().applyQuaternion(pb.body.quaternion);
                    pb.debugMesh.position.set(
                        pb.body.position.x + worldOffset.x,
                        pb.body.position.y + worldOffset.y,
                        pb.body.position.z + worldOffset.z
                    );
                    pb.debugMesh.quaternion.copy(pb.body.quaternion);
                }
            });
        } else if (appState.editColliderDebugMeshes.length > 0) {
            // Mod Editing (bukan Pratonton) — tiada simulasi fizik, cuma ikut
            // kedudukan/putaran SEMASA objek supaya collider "live" semasa drag.
            syncEditColliderDebugPositions();
        }

        // SINKRONIKAN SCRUBBER MODAL JIKA UTILITY MODAL SEDANG DIBUKA
        const animModalTarget = getAnimModalTarget();
        if (getAnimModal().style.display === "block" && animModalTarget && animModalTarget.userData.animAction) {
            const action = animModalTarget.userData.animAction;
            const clipDuration = action.getClip().duration;

            const isModalScrubbing = getIsModalScrubbing();
            const drivenByInteraction = ['playing', 'playing_fwd', 'playing_rev'].includes(animModalTarget.userData.animState);
            if (!isModalScrubbing && !action.paused && !drivenByInteraction) {
                animModalTarget.userData.mixer.update(delta);
            }

            const animScrubber = getAnimScrubber();
            if (!isModalScrubbing) {
                animScrubber.value = action.time;
            }
            getAnimTimeDisplay().innerText = `${action.time.toFixed(2)}s / ${clipDuration.toFixed(2)}s`;
        }

        getLoadedModelsList().forEach(m => {
            if (m.userData.mixer && m.userData.animAction && (m.userData.animState === 'playing' || m.userData.animState === 'playing_fwd' || m.userData.animState === 'playing_rev')) {
                const action = m.userData.animAction;
                const startTime = m.userData.customStartTime || 0;
                const endTime = m.userData.customEndTime || action.getClip().duration;
                const dir = m.userData.animDir || 'forward';

                if (action.timeScale > 0 && action.time >= endTime) {
                    if (dir === 'pingpong') {
                        action.timeScale = -1;
                    } else if (m.userData.interactions) {
                        const act = m.userData.interactions.find(a => a.action === 'toggleModelAnim');
                        if (act && act.animMode === 'toggleReverse') {
                            action.paused = true;
                            action.time = endTime;
                            m.userData.animState = 'atEnd';
                        } else if (act && act.animMode === 'once') {
                            action.paused = true;
                            action.time = endTime;
                            m.userData.animState = 'stopped';
                        } else {
                            action.time = startTime;
                        }
                    }
                }
                else if (action.timeScale < 0 && action.time <= startTime) {
                    if (dir === 'pingpong') {
                        action.timeScale = 1;
                    } else if (m.userData.interactions) {
                        const act = m.userData.interactions.find(a => a.action === 'toggleModelAnim');
                        if (act && act.animMode === 'toggleReverse') {
                            action.paused = true;
                            action.time = startTime;
                            m.userData.animState = 'atStart';
                        } else if (act && act.animMode === 'once') {
                            action.paused = true;
                            action.time = startTime;
                            m.userData.animState = 'stopped';
                        } else {
                            action.time = endTime;
                        }
                    }
                }

                m.userData.mixer.update(delta);
            }

            if (m.userData.isRotating) {
                m.rotation.y += 0.01;
            }
        });

        renderer.render(scene, mainCamera);
    }

    return { animate };
}
