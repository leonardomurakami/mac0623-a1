// MAC0623 — A1 Desktop Docking Testbed — STARTER
//
// Provided: scene setup, target-pose generation, the tolerance check, the
// trial state machine, and the CSV logger/downloader.
//
// You implement: the control mapping(s) that move/rotate the cube in
// response to input. Everything you need to touch is inside blocks marked
//   // ===== STUDENT TODO ===== ... // ===== END STUDENT TODO =====
// Do not need to touch anything outside those blocks to get a working
// baseline mapping — but you may, if your design requires it (e.g. extra
// HUD state for a second input mode). If you do, note it in your README.

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Module-scope state — provided
//
// Populated once, by main() (via buildScene() for scene/cube/target), before
// any trial starts or any frame renders. Everything below this point —
// generateTargetPose(), checkTolerance(), updateControlMapping(), animate()
// — reads and writes these directly, the same way it would if they were
// still declared inline where they're first used.
// ---------------------------------------------------------------------------

let scene, camera, renderer, cube, target, gizmo, translationGizmo, rotationGizmo;

/**
 * buildScene()
 *
 * Builds the static contents of the 3D scene: background color, lighting,
 * the reference grid/axes, the student-controlled cube, and the translucent
 * target mesh (the goal pose). Does not create the camera or renderer —
 * that's main()'s job — and does not start the render loop.
 *
 * Pure with respect to the rest of the app: it only touches the THREE.Scene
 * it creates and returns, so it's safe to read top-to-bottom on its own.
 *
 * @returns {{ scene: THREE.Scene, cube: THREE.Mesh, target: THREE.Mesh }}
 *   The new scene, plus direct references to the two meshes the rest of the
 *   app needs: `cube` (control mappings write to `cube.position` /
 *   `cube.quaternion`) and `target` (`generateTargetPose()` writes to it
 *   every trial).
 */
function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2, 4, 3);
  scene.add(dirLight);

  scene.add(new THREE.GridHelper(6, 24, 0x444444, 0x2a2a2a));
  scene.add(new THREE.AxesHelper(0.6));

  // Cube (student-controlled) and target (goal pose) share one geometry —
  // the target clones it so the two meshes can have independent materials
  // (opaque vs. translucent) without sharing a single Mesh instance.
  const cubeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);

  const cube = new THREE.Mesh(
    cubeGeometry,
    new THREE.MeshStandardMaterial({ color: 0x3d8bfd })
  );
  cube.position.set(0, 0.5, 0);
  scene.add(cube);

  const target = new THREE.Mesh(
    cubeGeometry.clone(),
    new THREE.MeshStandardMaterial({
      color: 0x2ecc71,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  scene.add(target);

  return { scene, cube, target };
}

/**
 * main()
 *
 * Entry point for the whole app. Order matters here:
 *   1. Build the scene (`buildScene()`) — cube and target must exist before
 *      anything below tries to read their position/quaternion.
 *   2. Create the camera and renderer, and wire the window resize handler.
 *   3. Start the trial state machine (`startTrial()`), which generates the
 *      first target pose.
 *   4. Start the render loop (`animate()`).
 *
 * Called once, at the bottom of this file. Everything it sets up
 * (`scene`, `camera`, `renderer`, `cube`, `target`) is written into the
 * module-scope variables declared above, so the rest of the file can keep
 * referring to them as plain names instead of threading them through every
 * function call.
 */
function main() {
  ({ scene, cube, target } = buildScene());
  gizmo = createGizmo();
  scene.add(gizmo);

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.05,
    100
  );
  camera.position.set(0, 1.4, 4);
  camera.lookAt(0, 0.5, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.localClippingEnabled = true;
  document.body.appendChild(renderer.domElement);
  syncMappingUi();

  window.addEventListener("resize", handleWindowResize);

  startTrial();
  animate();
}

/**
 * handleWindowResize()
 *
 * Keeps the camera's aspect ratio and the renderer's output size in sync
 * with the browser window. Registered as the "resize" listener in main().
 */
function handleWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Target-pose generation — provided
//
// Uses Shoemake's algorithm for a uniformly-random unit quaternion (uniform
// over SO(3)), rather than converting random Euler angles, which would bias
// the sampled orientations. Position is uniform within a bounding box in
// front of the camera.
// ---------------------------------------------------------------------------

function randomQuaternionShoemake() {
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();

  const sqrt1MinusU1 = Math.sqrt(1 - u1);
  const sqrtU1 = Math.sqrt(u1);

  const theta1 = 2 * Math.PI * u2;
  const theta2 = 2 * Math.PI * u3;

  return new THREE.Quaternion(
    sqrt1MinusU1 * Math.sin(theta1),
    sqrt1MinusU1 * Math.cos(theta1),
    sqrtU1 * Math.sin(theta2),
    sqrtU1 * Math.cos(theta2)
  );
}

const TARGET_BOUNDS = {
  x: [-1.0, 1.0],
  y: [0.2, 1.6],
  z: [-0.6, 0.6],
};

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

function generateTargetPose() {
  target.position.set(
    randomInRange(TARGET_BOUNDS.x),
    randomInRange(TARGET_BOUNDS.y),
    randomInRange(TARGET_BOUNDS.z)
  );
  target.quaternion.copy(randomQuaternionShoemake());
}

// ---------------------------------------------------------------------------
// Tolerance check — provided
//
// Position tolerance: 0.05 units (world units == meters, at this scene
// scale). Orientation tolerance: 10 degrees, measured via
// Quaternion.angleTo(), which is robust to double-cover (q and -q represent
// the same rotation) — do not compute orientation error from Euler angles.
// ---------------------------------------------------------------------------

const POSITION_TOLERANCE = 0.05;
const ORIENTATION_TOLERANCE_DEG = 10;

function checkTolerance() {
  const positionError = cube.position.distanceTo(target.position);
  const orientationErrorRad = cube.quaternion.angleTo(target.quaternion);
  const orientationErrorDeg = THREE.MathUtils.radToDeg(orientationErrorRad);

  const withinTolerance =
    positionError <= POSITION_TOLERANCE &&
    orientationErrorDeg <= ORIENTATION_TOLERANCE_DEG;

  return { positionError, orientationErrorDeg, withinTolerance };
}

// ---------------------------------------------------------------------------
// HUD references — provided
// ---------------------------------------------------------------------------

const participantIdInput = document.getElementById("participantId");
const mappingSelect = document.getElementById("mappingSelect");
const trialCountEl = document.getElementById("trialCount");
const confirmBtn = document.getElementById("confirmBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");

// ---------------------------------------------------------------------------
// Trial state machine — provided
//
// presentation_order counts trials within the *current* mapping selection
// since the page loaded — it does not reset when you switch mapping in the
// dropdown mid-session, since order-of-presentation across mappings is part
// of what you're counterbalancing across participants (see A1's ABBA
// counterbalancing note). trial_number is a simple running counter of every
// trial confirmed this session, regardless of mapping.
// ---------------------------------------------------------------------------

let trialNumber = 0;
let presentationOrderByMapping = { 1: 0, 2: 0 };
let trialStartTime = performance.now();
let pathLength = 0; // accumulated cube-position travel distance this trial
// Placeholder — cube doesn't exist yet at module-load time (main() creates
// it via buildScene()). startTrial() calls lastCubePosition.copy(cube.position)
// before this value is ever read, so the zero vector here is never used.
let lastCubePosition = new THREE.Vector3();

// ===== STUDENT TODO =====
// Increment this from your own mapping code every time the user switches
// input mode (e.g. toggling translate/rotate mode in the baseline mapping).
// It is read (and reset) when a trial is confirmed.
let modeSwitches = 0;
// ===== END STUDENT TODO =====

const rows = [];
const CSV_HEADER = [
  "participant_id",
  "mapping",
  "trial_number",
  "presentation_order",
  "completion_time_s",
  "final_position_error",
  "final_orientation_error_deg",
  "mode_switches",
  "path_length",
];

function currentMapping() {
  return mappingSelect.value;
}

function startTrial() {
  trialStartTime = performance.now();
  pathLength = 0;
  lastCubePosition.copy(cube.position);
  modeSwitches = 0;
  generateTargetPose();
  trialCountEl.textContent = `Trial ${trialNumber + 1}`;
}

function confirmTrial() {
  const { positionError, orientationErrorDeg } = checkTolerance();
  const completionTimeS = (performance.now() - trialStartTime) / 1000;
  const mapping = currentMapping();

  trialNumber += 1;
  presentationOrderByMapping[mapping] = (presentationOrderByMapping[mapping] || 0) + 1;

  rows.push({
    participant_id: participantIdInput.value.trim() || "UNKNOWN",
    mapping,
    trial_number: trialNumber,
    presentation_order: presentationOrderByMapping[mapping],
    completion_time_s: completionTimeS.toFixed(3),
    final_position_error: positionError.toFixed(4),
    final_orientation_error_deg: orientationErrorDeg.toFixed(2),
    mode_switches: modeSwitches,
    path_length: pathLength.toFixed(4),
  });

  startTrial();
}

confirmBtn.addEventListener("click", confirmTrial);
window.addEventListener("keydown", handleKeydown);

/**
 * handleKeydown(e)
 *
 * Keyboard shortcut for Confirm: Enter does the same thing as clicking
 * #confirmBtn. Registered as the "keydown" listener above.
 */
function handleKeydown(e) {
  if (e.key === "Enter") confirmTrial();
}

// ---------------------------------------------------------------------------
// CSV download — provided
// ---------------------------------------------------------------------------

function buildCsv() {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_HEADER.map(function (key) {
        return row[key];
      }).join(",")
    );
  }
  return lines.join("\n");
}

downloadBtn.addEventListener("click", handleDownloadClick);

/**
 * handleDownloadClick()
 *
 * Builds the CSV from `rows` (via buildCsv()), then triggers a browser
 * download through a temporary Blob URL and an off-DOM `<a>` click.
 * Registered as the "click" listener on #downloadBtn above.
 */
function handleDownloadClick() {
  const csv = buildCsv();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const pid = participantIdInput.value.trim() || "UNKNOWN";
  a.href = url;
  a.download = `a1_${pid}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Status indicator — provided
// ---------------------------------------------------------------------------

function updateStatus() {
  const { positionError, orientationErrorDeg, withinTolerance } = checkTolerance();
  statusEl.textContent = `dPos ${positionError.toFixed(3)} | dRot ${orientationErrorDeg.toFixed(1)}deg`;
  statusEl.classList.toggle("in-tolerance", withinTolerance);
}

// ---------------------------------------------------------------------------
// Control mapping — STUDENT TODO
//
// updateControlMapping(delta) is called once per animation frame. This is
// where mouse/keyboard input should translate into changes to cube.position
// and cube.quaternion. The baseline mapping (mapping "1") is the translate-rotation
// toggled by TAB/Spacebar.
// Mapping "2" is your own design.
//
// Whatever you build:
//   - Read currentMapping() to branch between mapping 1 and mapping 2.
//   - Update cube.position / cube.quaternion directly.
//   - Increment modeSwitches whenever the user changes input mode.
//   - Accumulate pathLength (see the render loop below, which already does
//     this generically by measuring cube.position deltas frame-to-frame —
//     you likely don't need to touch that part).
//
// ===== STUDENT TODO =====

// Nothing here moves the cube yet, so it will sit still on load. Wire up
// your own mouse/keyboard listeners (mousemove, keydown/keyup, etc.) above
// this function as needed, and drive cube.position / cube.quaternion from
// updateControlMapping() below.
let isDragging = false;
let isRotateMode = false;
let lastX = 0, lastY = 0;
let mouseDX = 0, mouseDY = 0;
let wheelDY = 0;
const _q = new THREE.Quaternion();
const YAW_AXIS   = new THREE.Vector3(0, 1, 0);
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);
const ROLL_AXIS  = new THREE.Vector3(0, 0, 1);

let gizmoRotateMode = false;
let activeGizmoHandle = null;
let hoveredGizmoHandle = null;
const translationHandles = [];
const rotationHandles = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragPoint = new THREE.Vector3();
const dragStartPoint = new THREE.Vector3();
const dragStartPosition = new THREE.Vector3();
const dragAxis = new THREE.Vector3();
const rotationTangent = new THREE.Vector3();
const projectedCenter = new THREE.Vector3();
const projectedTangentEnd = new THREE.Vector3();
const rotationDragDirection = new THREE.Vector2();
const rotationMovement = new THREE.Vector2();
const clipWorldAxis = new THREE.Vector3();
const clipToCamera = new THREE.Vector3();
const clipNormal = new THREE.Vector3();
const GIZMO_AXES = [
  { name: "X", vector: new THREE.Vector3(1, 0, 0), color: 0xef5b5b },
  { name: "Y", vector: new THREE.Vector3(0, 1, 0), color: 0x61c878 },
  { name: "Z", vector: new THREE.Vector3(0, 0, 1), color: 0x5598ed },
];

function createHandleMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.50,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function registerHandle(mesh, axis, type, collection) {
  mesh.userData.axis = axis.vector.clone();
  mesh.userData.axisName = axis.name;
  mesh.userData.type = type;
  mesh.userData.baseColor = axis.color;
  mesh.renderOrder = 2;
  collection.push(mesh);
}

function createGizmo() {
  const group = new THREE.Group();
  translationGizmo = new THREE.Group();
  rotationGizmo = new THREE.Group();
  const shaftGeometry = new THREE.CylinderGeometry(0.014, 0.014, 0.27, 10); // TODO: fix the magic numbers, eventually
  const tipGeometry = new THREE.ConeGeometry(0.042, 0.1, 12);
  const ringGeometry = new THREE.TorusGeometry(0.34, 0.018, 10, 72);

  for (const axis of GIZMO_AXES) {
    const material = createHandleMaterial(axis.color);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeometry, material);
    const tip = new THREE.Mesh(tipGeometry, material);
    shaft.position.y = 0.17;
    tip.position.y = 0.355;
    arrow.quaternion.setFromUnitVectors(YAW_AXIS, axis.vector);
    registerHandle(shaft, axis, "translate", translationHandles);
    registerHandle(tip, axis, "translate", translationHandles);
    arrow.add(shaft, tip);
    translationGizmo.add(arrow);

    const ringMaterial = createHandleMaterial(axis.color);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    if (axis.name === "X") ring.rotation.y = Math.PI / 2;
    if (axis.name === "Y") ring.rotation.x = -Math.PI / 2;
    registerHandle(ring, axis, "rotate", rotationHandles);
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    ringMaterial.clippingPlanes = [clipPlane];
    ring.userData.clipPlane = clipPlane;
    rotationGizmo.add(ring);
  }

  group.add(translationGizmo, rotationGizmo);
  group.visible = false;
  return group;
}

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function resetGizmoColors() {
  for (const handle of [...translationHandles, ...rotationHandles]) {
    handle.material.color.setHex(handle.userData.baseColor);
    handle.material.opacity = 0.50;
  }
}

function setHighlightedHandle(handle) {
  resetGizmoColors();
  if (handle) {
    handle.material.color.setHex(0xffffff);
    handle.material.opacity = 1;
  }
}

function setHandleVisibility(activeHandle = null) {
  for (const handle of translationHandles) {
    handle.visible = !gizmoRotateMode &&
      (!activeHandle || handle.userData.axisName === activeHandle.userData.axisName);
  }
  for (const handle of rotationHandles) {
    handle.visible = gizmoRotateMode &&
      (!activeHandle || handle.userData.axisName === activeHandle.userData.axisName);
  }
}

function updateGizmoHover(e) {
  if (currentMapping() !== "2" || activeGizmoHandle) return;
  setPointerFromEvent(e);
  const handles = gizmoRotateMode ? rotationHandles : translationHandles;
  const hit = raycaster.intersectObjects(handles, false)[0];
  const nextHandle = hit ? hit.object : null;
  if (nextHandle === hoveredGizmoHandle) return;
  hoveredGizmoHandle = nextHandle;
  setHighlightedHandle(hoveredGizmoHandle);
  renderer.domElement.style.cursor = hoveredGizmoHandle ? "grab" : "default";
}

function beginGizmoDrag(e) {
  setPointerFromEvent(e);
  const handles = gizmoRotateMode ? rotationHandles : translationHandles;
  const hit = raycaster.intersectObjects(handles, false)[0];
  if (!hit) return false;

  activeGizmoHandle = hit.object;
  dragStartPosition.copy(cube.position);
  dragAxis.copy(activeGizmoHandle.userData.axis);
  if (activeGizmoHandle.userData.type === "rotate") {
    dragAxis.applyQuaternion(cube.quaternion).normalize();
  }
  lastX = e.clientX;
  lastY = e.clientY;

  if (activeGizmoHandle.userData.type === "translate") {
    const cameraDirection = camera.position.clone().sub(cube.position).normalize();
    const planeNormal = dragAxis.clone().cross(cameraDirection).cross(dragAxis).normalize();
    if (planeNormal.lengthSq() < 0.001) planeNormal.copy(PITCH_AXIS);
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, cube.position);
    if (!raycaster.ray.intersectPlane(dragPlane, dragStartPoint)) {
      activeGizmoHandle = null;
      return false;
    }
  } else {
    rotationTangent.copy(hit.point).sub(cube.position);
    rotationTangent.addScaledVector(dragAxis, -rotationTangent.dot(dragAxis));
    rotationTangent.normalize();
    rotationTangent.crossVectors(dragAxis, rotationTangent).normalize();
    projectedCenter.copy(cube.position).project(camera);
    projectedTangentEnd.copy(cube.position).add(rotationTangent).project(camera);
    rotationDragDirection.set(
      projectedTangentEnd.x - projectedCenter.x,
      projectedCenter.y - projectedTangentEnd.y
    ).normalize();
    if (Math.abs(rotationDragDirection.x) >= Math.abs(rotationDragDirection.y)) {
      rotationDragDirection.set(Math.sign(rotationDragDirection.x) || 1, 0);
    } else {
      rotationDragDirection.set(0, Math.sign(rotationDragDirection.y) || 1);
    }
  }

  setHandleVisibility(activeGizmoHandle);
  setHighlightedHandle(activeGizmoHandle);
  renderer.domElement.style.cursor = "grabbing";
  return true;
}

function dragGizmo(e) {
  if (activeGizmoHandle.userData.type === "translate") {
    setPointerFromEvent(e);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    const distance = dragPoint.sub(dragStartPoint).dot(dragAxis);
    cube.position.copy(dragStartPosition).addScaledVector(dragAxis, distance);
    return;
  }

  const movementX = document.pointerLockElement === renderer.domElement
    ? e.movementX
    : e.clientX - lastX;
  const movementY = document.pointerLockElement === renderer.domElement
    ? e.movementY
    : e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const angle = rotationDragDirection.dot(rotationMovement.set(movementX, movementY)) * 0.008;
  if (angle === 0) return;
  _q.setFromAxisAngle(activeGizmoHandle.userData.axis, angle);
  cube.quaternion.multiply(_q).normalize();
}

function endGizmoDrag(e) {
  if (!activeGizmoHandle) return;
  activeGizmoHandle = null;
  hoveredGizmoHandle = null;
  setHighlightedHandle(null);
  renderer.domElement.style.cursor = "default";
  if (e && renderer.domElement.hasPointerCapture(e.pointerId)) {
    renderer.domElement.releasePointerCapture(e.pointerId);
  }
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  syncMappingUi();
}

function syncMappingUi() {
  if (!gizmo) return;
  gizmo.visible = currentMapping() === "2";
  translationGizmo.visible = !gizmoRotateMode;
  rotationGizmo.visible = gizmoRotateMode;
  rotationGizmo.quaternion.copy(cube.quaternion);
  setHandleVisibility(activeGizmoHandle);
}

window.addEventListener("pointerdown", (e) => {
  if (e.target !== renderer.domElement) return;
  if (currentMapping() === "2") {
    if (beginGizmoDrag(e)) {
      e.preventDefault();
      renderer.domElement.setPointerCapture(e.pointerId);
      if (activeGizmoHandle.userData.type === "rotate") {
        const lockRequest = renderer.domElement.requestPointerLock();
        if (lockRequest) lockRequest.catch(() => {});
      }
    }
    return;
  }
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("pointerup", (e) => {
  isDragging = false;
  endGizmoDrag(e);
});

window.addEventListener("pointermove", (e) => {
  if (activeGizmoHandle) {
    dragGizmo(e);
    return;
  }
  if (currentMapping() === "2") {
    updateGizmoHover(e);
    return;
  }
  if (!isDragging) return;
  mouseDX = e.clientX - lastX;
  mouseDY = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("wheel", (e) => {
  if (currentMapping() !== "1") return;
  e.preventDefault();
  wheelDY += e.deltaY;
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if ((e.code !== "Space" && e.code !== "Tab") || e.repeat) return;
  if (["INPUT", "BUTTON"].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  modeSwitches += 1;
  if (currentMapping() === "1") {
    isRotateMode = !isRotateMode;
  } else {
    endGizmoDrag();
    gizmoRotateMode = !gizmoRotateMode;
  }
  syncMappingUi();
});

mappingSelect.addEventListener("change", () => {
  isDragging = false;
  isRotateMode = false;
  gizmoRotateMode = false;
  mouseDX = 0;
  mouseDY = 0;
  wheelDY = 0;
  endGizmoDrag();
  syncMappingUi();
});

function updateControlMapping(delta) {
  const mapping = currentMapping();
  if (mapping === "1") {
    if (isRotateMode) {
      const s = 0.005;
      _q.setFromAxisAngle(PITCH_AXIS, -mouseDX * s);
      cube.quaternion.multiplyQuaternions(cube.quaternion, _q);
      _q.setFromAxisAngle(YAW_AXIS, -mouseDY * s);
      cube.quaternion.multiplyQuaternions(cube.quaternion, _q);
      _q.setFromAxisAngle(ROLL_AXIS, -wheelDY * s);
      cube.quaternion.multiplyQuaternions(cube.quaternion, _q);
    } else {
      const s = 0.005;
      cube.position.x += mouseDX * s;
      cube.position.y -= mouseDY * s;
      cube.position.z -= wheelDY * s;
    }
    mouseDX = 0; mouseDY = 0; wheelDY = 0;
  } else {
    gizmo.position.copy(cube.position);
    rotationGizmo.quaternion.copy(cube.quaternion);
    updateRingClipping();
  }
}

// imrprove ring visibility/experience by only showing half-arcs
// similar to how blender display their gizmo, as showing the "back-half" of
// the arc makes it really confusing.
function updateRingClipping() {
  clipToCamera.copy(camera.position).sub(cube.position).normalize();
  for (const ring of rotationHandles) {
    clipWorldAxis.copy(ring.userData.axis).applyQuaternion(cube.quaternion).normalize();
    clipNormal.copy(clipToCamera);
    clipNormal.addScaledVector(clipWorldAxis, -clipToCamera.dot(clipWorldAxis));
    if (clipNormal.lengthSq() < 1e-6) continue;
    clipNormal.normalize();
    ring.userData.clipPlane.setFromNormalAndCoplanarPoint(clipNormal, cube.position);
  }
}



// ===== END STUDENT TODO =====

// ---------------------------------------------------------------------------
// Render loop — provided
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateControlMapping(delta);

  // Generic path-length accumulation — measures how far the cube has
  // physically travelled this trial, regardless of mapping.
  pathLength += cube.position.distanceTo(lastCubePosition);
  lastCubePosition.copy(cube.position);

  updateStatus();
  renderer.render(scene, camera);
}

main();
