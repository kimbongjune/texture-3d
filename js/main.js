import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

let drawingMode = true;
let moveMode = false;
let rotateMode = false;
// === 선택/하이라이트 오버레이 관련 전역 변수 ===
let selectedObject = null;
let highlightOverlayMesh = null;
// --- 스냅 관련 설정 ---
const snapDistance = 0.5; // 스냅이 활성화되는 최대 거리
let snapGuide = null; // 스냅 위치를 시각적으로 보여주는 도우미
let allVertices = []; // 스냅 대상이 되는 모든 꼭짓점

// 카메라 방향 표시를 위한 변수
let cameraDirectionCanvas = null;
let cameraDirectionCtx = null;

// 1. 기본 설정
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeeeee);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// controls 생성 전에는 camera만 초기화

const controls = new OrbitControls(camera, renderer.domElement);

// TransformControls 초기화
const transformControls = new TransformControls(camera, renderer.domElement);
scene.add(transformControls);
transformControls.size = 1.5; // 회전 가이드 크기 조정

let oldQuaternion = null;
const snapAngle = Math.PI / 12; // 15도 스냅

transformControls.addEventListener('objectChange', function () {
    if (transformControls.dragging && selectedObject) {
        // Shift 키 누를 때 스냅 적용
        if (isShiftDown) {
            const euler = new THREE.Euler().setFromQuaternion(selectedObject.quaternion, 'YXZ');
            euler.x = Math.round(euler.x / snapAngle) * snapAngle;
            euler.y = Math.round(euler.y / snapAngle) * snapAngle;
            euler.z = Math.round(euler.z / snapAngle) * snapAngle;
            selectedObject.quaternion.setFromEuler(euler);
        }
    }
});

transformControls.addEventListener('mouseUp', function () {
    if (selectedObject && oldQuaternion) {
        const newQuaternion = selectedObject.quaternion.clone();
        if (!oldQuaternion.equals(newQuaternion)) {
            history.execute(new RotationCommand(selectedObject, oldQuaternion, newQuaternion));
        }
    }
    oldQuaternion = null; // 상태 초기화
    controls.enabled = true;
});

transformControls.addEventListener('mouseDown', function() {
    if (selectedObject) {
        oldQuaternion = selectedObject.quaternion.clone();
    }
    controls.enabled = false;
});
controls.enableDamping = false; // 댐핑 비활성화
controls.mouseButtons = {
	LEFT: null, // 좌클릭은 그리기를 위해 비활성화
	MIDDLE: THREE.MOUSE.PAN, // 휠클릭으로 카메라 이동
	RIGHT: THREE.MOUSE.ROTATE // 우클릭으로 카메라 회전
};
controls.enableZoom = false; // OrbitControls의 기본 줌 비활성화
controls.enablePan = true;
controls.enableRotate = true;
controls.minDistance = 1;
controls.maxDistance = 30;
// === 카메라가 바닥 아래로 내려가지 않도록 제한 ===
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
// === 카메라/컨트롤 초기 위치/각도 ===
camera.position.set(0, 8, 8);
camera.lookAt(0, 0, 0);
controls.target.set(0, 0, 0);
controls.update();

// === 카메라 애니메이션 목표값 및 플래그 ===
let cameraTargetPos = new THREE.Vector3(0, 8, 8);
let cameraTargetLook = new THREE.Vector3(0, 0, 0);
let isCameraAnimating = false;

// === axis-orbit 클릭 시 카메라 목표값만 갱신 + 애니메이션 활성화 ===
let axisOrbitCanvas = document.getElementById('axis-orbit');
if (axisOrbitCanvas) {
  axisOrbitCanvas.addEventListener('click', () => {
    cameraTargetPos.set(0, 8, 8);
    cameraTargetLook.set(0, 0, 0);
    isCameraAnimating = true;
  });
}

// 2. 조명
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// === 추가: hemisphere light ===
const hemisphereLight = new THREE.HemisphereLight(0xcce6ff, 0xf0f0f0, 0.7);
hemisphereLight.visible = false;
scene.add(hemisphereLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.bias = -0.0005; // 그림자 아티팩트(shadow acne) 방지
directionalLight.shadow.normalBias = 0.02; // 그림자 가장자리 부드럽게
directionalLight.shadow.camera.near = 1;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
scene.add(directionalLight);

// 3. 그리기 환경 설정
const gridHelper = new THREE.GridHelper(100, 100);
scene.add(gridHelper);
// 바닥 그림자 받기용 plane 추가
const shadowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.18 })
);
shadowGround.rotation.x = -Math.PI / 2;
shadowGround.position.y = 0;
shadowGround.receiveShadow = true;
scene.add(shadowGround);
setupSnapGuide(); // 스냅 도우미 초기화

// --- History 관리 ---
const history = new History();

const drawableObjects = [];
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let activeDrawingPlane = groundPlane;

let isDrawing = false;
let startPoint = new THREE.Vector3();
let previewMesh = null;

let isExtruding = false;
let extrudeTarget = null;
let highlightMesh;
let lastMouseY = 0;
let axisGuideLines = []; // X/Z축 가이드 라인들 (높이 가이드는 제거됨)

let isExtrudingX = false; // x축 extrude 상태
let isExtrudingZ = false; // z축 extrude 상태

// --- Extrusion state for X and Z axes ---
let dragPlane = null; // Plane for calculating mouse movement in world space
let dragStartPoint = null; // Initial intersection point of the drag
let extrudeFixedPoint = null; // The world position of the face opposite to the one being dragged
let extrudeXFaceNormal = new THREE.Vector3(1, 0, 0); // World-space normal of the face being extruded
let extrudeZFaceNormal = new THREE.Vector3(0, 0, 1); // World-space normal of the face being extruded
let extrudeYFaceNormal = new THREE.Vector3(0, 1, 0); // World-space normal of the face being extruded

// 텍스처링 상태 관련 변수
let isTexturingMode = false;
const textureHighlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide });
let highlightedFaceInfo = {
    object: null,
    faceIndex: -1,
    originalMaterial: null
};

// 텍스처 적용 방식 (기본값: 원본 길이)
let textureApplyMode = 'original'; // 'original' 또는 'stretch'

let draggedTextureSrc = null; // 드래그 중인 텍스처의 src

// 4. 텍스처 선택 로직
const texturePalette = document.getElementById('texture-palette');
let selectedTextureSrc = null;

// 초기 상태에서 모든 텍스처 선택 해제
document.addEventListener('DOMContentLoaded', () => {
    const allTextureOptions = texturePalette.querySelectorAll('.texture-option');
    allTextureOptions.forEach(option => option.classList.remove('active'));
    selectedTextureSrc = null;
    isTexturingMode = false;
});

texturePalette.addEventListener('click', (event) => {
    // 그리기 모드(drawingMode)가 아닐 때는 텍스처 선택을 허용하지 않음
    if (!drawingMode) {
        return;
    }

    if (event.target.classList.contains('texture-option')) {
        const currentlyActive = texturePalette.querySelector('.active');
        
        if (currentlyActive && currentlyActive === event.target) {
            // 이미 선택된 텍스처를 다시 클릭 -> 선택 취소
            currentlyActive.classList.remove('active');
            selectedTextureSrc = null;
            isTexturingMode = false;
            clearTextureHighlight(); // 하이라이트 제거
        } else {
            // 다른 텍스처를 선택
            if (currentlyActive) {
                currentlyActive.classList.remove('active');
            }
            event.target.classList.add('active');
            selectedTextureSrc = event.target.dataset.texture;
            isTexturingMode = true;
            textureApplyMode = 'original'; // 텍스처 선택 시 기본값 'original'로 설정
        }
    }
});

// 텍스처 드래그 시작 이벤트
texturePalette.addEventListener('dragstart', (event) => {
    if (event.target.classList.contains('texture-option')) {
        draggedTextureSrc = event.target.dataset.texture;
        event.dataTransfer.setData('text/plain', draggedTextureSrc); // 데이터 전송 (필수)
    }
});

// 5. Raycaster 및 이벤트 리스너 설정
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const mouseDownPos = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
renderer.domElement.addEventListener('pointermove', onPointerMove, false);
renderer.domElement.addEventListener('pointerup', onPointerUp, false);
// renderer.domElement.addEventListener('click', onCanvasClick, false); // 분리된 클릭 리스너 제거
renderer.domElement.addEventListener('contextmenu', onRightClick, false);

// 드래그 앤 드롭 이벤트 리스너 추가
renderer.domElement.addEventListener('dragover', (event) => {
    event.preventDefault(); // 드롭을 허용하기 위해 기본 동작 방지
});

renderer.domElement.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!draggedTextureSrc) return; // 드래그된 텍스처가 없으면 리턴

    updateMouseAndRaycaster(event);
    const intersects = raycaster.intersectObjects(drawableObjects);

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        applyTextureToAllFaces(intersectedObject, draggedTextureSrc);
    }
    draggedTextureSrc = null; // 드래그 상태 초기화
});

// ... (existing code) ...

async function applyTextureToAllFaces(object, textureSrc) {
    const textureCommandPromises = [];
    // BoxGeometry는 6개의 면을 가집니다.
    for (let i = 0; i < 6; i++) {
        const oldMaterial = object.material[i].clone();
        // applyTextureToFace가 Promise를 반환하므로 await 사용
        textureCommandPromises.push(applyTextureToFace(object, i, textureSrc, 'original', oldMaterial));
    }
    // 모든 면에 대한 텍스처 적용을 하나의 그룹 커맨드로 묶어 실행
    const textureCommands = await Promise.all(textureCommandPromises);
    history.execute(new GroupTextureCommand(textureCommands));
}

// 커스텀 휠 줌 처리
renderer.domElement.addEventListener('wheel', (event) => {
    if (isDrawing || isExtruding || isExtrudingX || isExtrudingZ) {
        event.preventDefault();
        return;
    }
    
    event.preventDefault();
    
    // 적당한 줌 단위로 제어
    const zoomAmount = event.deltaY > 0 ? 1.05 : 0.95; // 5%씩 줌
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = camera.position.distanceTo(controls.target);
    
    const newDistance = Math.max(controls.minDistance, Math.min(controls.maxDistance, distance * zoomAmount));
    camera.position.copy(controls.target).add(direction.multiplyScalar(newDistance));
    
    controls.update();
}, { passive: false });

let isShiftDown = false;

// --- Undo/Redo 및 키보드 단축키 리스너 ---
window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') {
        isShiftDown = true;
    }

    // 입력 필드에 있을 때는 작동하지 않도록
    if (event.target.tagName.toUpperCase() === 'INPUT' || event.target.tagName.toUpperCase() === 'TEXTAREA') {
        return;
    }

    // 특정 작업이 진행 중일 때는 모드 전환 단축키 비활성화
    if (isDrawing || isExtruding || isExtrudingX || isExtrudingZ || isDraggingSelected || transformControls.dragging) {
        // Shift 키는 항상 감지해야 하므로 여기서 return하지 않음
    } else {
        // 모드 전환 단축키 처리
        const toolSelectBtn = document.getElementById('tool-select'); // 선택 모드 (s)
        const toolRefreshBtn = document.getElementById('tool-refresh'); // 회전 모드 (r)
        const toolScaleBtn = document.getElementById('tool-scale'); // 그리기 모드 (d)

        switch (event.key.toLowerCase()) {
            case 'r':
                if (toolRefreshBtn) toolRefreshBtn.click();
                break;
            case 's':
                if (toolSelectBtn) toolSelectBtn.click();
                break;
            case 'd':
                if (toolScaleBtn) toolScaleBtn.click();
                break;
            case 'm': // 객체 목록 토글
                toggleObjectListPanel();
                break;
            case 'l': // 조명 토글
                const toggleLightMenu = document.getElementById('toggle-light');
                if (toggleLightMenu) {
                    const isOn = !toggleLightMenu.querySelector('.check').textContent;
                    setLightMenuState(isOn);
                }
                break;
            case 'g': // 격자 토글
                toggleGridVisibility();
                break;
            case 'f11': // 전체화면 토글
                event.preventDefault(); // 브라우저 기본 전체화면 동작 방지
                toggleFullscreen();
                break;
        }
    }

    // Ctrl/Cmd + Z/Y (Undo/Redo) 처리
    if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
            event.preventDefault();
            history.undo();
        } else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            history.redo();
        }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedObject && !moveMode) { // 이동 모드가 아닐 때만 삭제
             // 사용자가 실수로 삭제하는 것을 방지하기 위해 추가적인 확인을 거치지 않음
        } else if (selectedObject && moveMode) {
            deleteObject(selectedObject);
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') {
        isShiftDown = false;
    }
});

// 전체화면 토글 함수
function toggleFullscreen() {
    const fullscreenElement = document.getElementById('app-wrapper');
    if (fullscreenElement) {
        if (!document.fullscreenElement) {
            fullscreenElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message} (${err.name})`);
            });
        } else {
            document.exitFullscreen();
        }
    }
}

// 네비게이션 메뉴의 '전체화면' 항목 클릭 이벤트
const toggleFullscreenMenu = document.getElementById('toggle-fullscreen-menu');
if (toggleFullscreenMenu) {
    toggleFullscreenMenu.addEventListener('click', () => {
        toggleFullscreen();
    });
}

// 전체화면 상태 변경 감지 및 메뉴 텍스트 업데이트
document.addEventListener('fullscreenchange', () => {
    if (toggleFullscreenMenu) {
        if (document.fullscreenElement) {
            toggleFullscreenMenu.textContent = '전체화면 종료';
        } else {
            toggleFullscreenMenu.textContent = '전체화면';
        }
    }
});

async function onCanvasClick(event) {
    const dragDistance = mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    if (dragDistance > 5 || !isTexturingMode || !selectedTextureSrc) return;

    clearTextureHighlight();

    const intersects = raycaster.intersectObjects(drawableObjects);

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const intersectedObject = intersection.object;
        const materialIndex = intersection.face.materialIndex;
        const oldMaterial = intersectedObject.material[materialIndex].clone();

        const command = await applyTextureToFace(intersectedObject, materialIndex, selectedTextureSrc, textureApplyMode, oldMaterial);
        history.execute(command);
    }
}

function updateTextureRepeatOnObject(object) {
    if (!object || !object.material) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];

    materials.forEach((material, materialIndex) => {
        if (material.map && material.userData && material.userData.textureApplyMode === 'original') {
            const textureWidthMM = material.userData.textureWidthMM;
            const textureHeightMM = material.userData.textureHeightMM;

            if (!textureWidthMM || !textureHeightMM) return;

            let faceWidthM = 1;
            let faceHeightM = 1;

            const geometry = object.geometry;
            const scale = object.scale;

            let normal = new THREE.Vector3();
            switch (materialIndex) {
                case 0: normal.set(1, 0, 0); break;
                case 1: normal.set(-1, 0, 0); break;
                case 2: normal.set(0, 1, 0); break;
                case 3: normal.set(0, -1, 0); break;
                case 4: normal.set(0, 0, 1); break;
                case 5: normal.set(0, 0, -1); break;
            }
            normal.applyQuaternion(object.quaternion).normalize();

            if (Math.abs(normal.y) > 0.99) { // Top/Bottom face
                faceWidthM = geometry.parameters.width * scale.x;
                faceHeightM = geometry.parameters.depth * scale.z;
            } else if (Math.abs(normal.x) > 0.99) { // Side face (X)
                faceWidthM = geometry.parameters.depth * scale.z;
                faceHeightM = geometry.parameters.height * scale.y;
            } else if (Math.abs(normal.z) > 0.99) { // Side face (Z)
                faceWidthM = geometry.parameters.width * scale.x;
                faceHeightM = geometry.parameters.height * scale.y;
            }

            const repeatX = faceWidthM / (textureWidthMM / 1000);
            const repeatY = faceHeightM / (textureHeightMM / 1000);
            
            const isRotated = material.map.rotation && (Math.abs(material.map.rotation % Math.PI - Math.PI / 2) < 0.01);

            if (isRotated) {
                 material.map.repeat.set(repeatY, repeatX);
            } else {
                 material.map.repeat.set(repeatX, repeatY);
            }
        }
    });
}

function applyTextureToFace(object, materialIndex, textureSrc, mode, oldMaterial) {
    const textureLoader = new THREE.TextureLoader();
    return new Promise((resolve) => {
        textureLoader.load(textureSrc, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;

            // 기존 텍스처의 회전 값을 가져옵니다.
            let existingRotation = 0;
            if (oldMaterial && oldMaterial.map) {
                existingRotation = oldMaterial.map.rotation;
            }

            if (mode === 'stretch') {
                texture.repeat.set(1, 1); // 텍스처를 면에 늘려 채움
            } else { // 'original' 모드
                let relativeTextureSrc = textureSrc;
                // textureSrc가 전체 URL인 경우 상대 경로로 변환
                if (textureSrc.startsWith('http://') || textureSrc.startsWith('https://')) {
                    try {
                        const url = new URL(textureSrc);
                        const texturesPathIndex = url.pathname.indexOf('/textures/');
                        if (texturesPathIndex !== -1) {
                            relativeTextureSrc = url.pathname.substring(texturesPathIndex + 1); // '/textures/'에서 '/' 제거
                        } else {
                            // 'textures/' 경로가 없는 경우, 파일 이름만 사용 (최후의 수단)
                            relativeTextureSrc = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
                        }
                    } catch (e) {
                        console.error("Error parsing URL:", textureSrc, e);
                        // URL 파싱 실패 시, 이미 상대 경로라고 가정
                        relativeTextureSrc = textureSrc;
                    }
                }

                const textureOption = texturePalette.querySelector(`.texture-option[data-texture="${relativeTextureSrc}"]`);
                if (!textureOption) {
                    console.error("Could not find texture option for:", relativeTextureSrc, "Falling back to stretch mode.");
                    texture.repeat.set(1, 1); // 해당 텍스처 옵션을 찾지 못하면 늘이기 모드로 대체
                } else {
                    const textureWidthMM = parseFloat(textureOption.dataset.x);
                    const textureHeightMM = parseFloat(textureOption.dataset.y);

                    let faceWidthM = 1;
                    let faceHeightM = 1;

                    const geometry = object.geometry;
                    const scale = object.scale;

                    let normal = new THREE.Vector3();
                    switch (materialIndex) {
                        case 0: // right
                            normal.set(1, 0, 0);
                            break;
                        case 1: // left
                            normal.set(-1, 0, 0);
                            break;
                        case 2: // top
                            normal.set(0, 1, 0);
                            break;
                        case 3: // bottom
                            normal.set(0, -1, 0);
                            break;
                        case 4: // front
                            normal.set(0, 0, 1);
                            break;
                        case 5: // back
                            normal.set(0, 0, -1);
                            break;
                    }
                    normal.applyQuaternion(object.quaternion).normalize();

                    if (Math.abs(normal.y) > 0.99) { // Top/Bottom face
                        faceWidthM = geometry.parameters.width * scale.x;
                        faceHeightM = geometry.parameters.depth * scale.z;
                    } else if (Math.abs(normal.x) > 0.99) { // Side face (X)
                        faceWidthM = geometry.parameters.depth * scale.z;
                        faceHeightM = geometry.parameters.height * scale.y;
                    } else if (Math.abs(normal.z) > 0.99) { // Side face (Z)
                        faceWidthM = geometry.parameters.width * scale.x;
                        faceHeightM = geometry.parameters.height * scale.y;
                    }

                    const repeatX = faceWidthM / (textureWidthMM / 1000);
                    const repeatY = faceHeightM / (textureHeightMM / 1000);

                    texture.repeat.set(repeatX, repeatY);
                }
            }

            // 기존 텍스처의 회전 값을 새로 로드된 텍스처에 적용합니다.
            texture.rotation = existingRotation;

            const newMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                side: THREE.DoubleSide
            });
            
            // Store metadata in the new material for dynamic updates
            newMaterial.userData.textureApplyMode = mode;
            newMaterial.userData.textureSrc = textureSrc;
            if (mode === 'original') {
                let relativeTextureSrc = textureSrc;
                if (textureSrc.startsWith('http://') || textureSrc.startsWith('https://')) {
                    try {
                        const url = new URL(textureSrc);
                        const texturesPathIndex = url.pathname.indexOf('/textures/');
                        if (texturesPathIndex !== -1) {
                            relativeTextureSrc = url.pathname.substring(texturesPathIndex + 1);
                        } else {
                            relativeTextureSrc = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
                        }
                    } catch (e) {
                        relativeTextureSrc = textureSrc;
                    }
                }
                const textureOption = texturePalette.querySelector(`.texture-option[data-texture="${relativeTextureSrc}"]`);
                if (textureOption) {
                    newMaterial.userData.textureWidthMM = parseFloat(textureOption.dataset.x);
                    newMaterial.userData.textureHeightMM = parseFloat(textureOption.dataset.y);
                }
            }

            const command = new TextureCommand(object, materialIndex, oldMaterial, newMaterial, textureSrc, mode);
            resolve(command); // Command 인스턴스를 Promise로 반환
        });
    });
}

class RemoveTextureCommand {
    constructor(object, materialIndex, oldMaterial, defaultMaterial) {
        this.object = object;
        this.materialIndex = materialIndex;
        this.oldMaterial = oldMaterial;
        this.defaultMaterial = defaultMaterial; // 기본 재질 (텍스처 제거 시 적용)
        this.name = 'RemoveTexture';
        console.log('RemoveTextureCommand constructor:', { object: object.uuid, materialIndex, oldMaterial, defaultMaterial }); // Debug log
    }

    execute() {
        console.log('RemoveTextureCommand execute: Applying default material to', this.object.uuid, 'at index', this.materialIndex); // Debug log
        // 기존 텍스처의 참조만 제거 (dispose는 undo/redo 시스템에서 신중하게 관리되어야 함)
        if (this.oldMaterial && this.oldMaterial.map) {
            this.oldMaterial.map = null; // 텍스처 참조 제거
        }
        this.object.material[this.materialIndex] = this.defaultMaterial;
        this.object.material.needsUpdate = true;
        console.log('RemoveTextureCommand execute: material after change', this.object.material[this.materialIndex], 'map:', this.object.material[this.materialIndex].map); // Debug log
    }

    undo() {
        console.log('RemoveTextureCommand undo: Restoring old material to', this.object.uuid, 'at index', this.materialIndex); // Debug log
        this.object.material[this.materialIndex] = this.oldMaterial;
        this.object.material.needsUpdate = true;
        console.log('RemoveTextureCommand undo: material after change', this.object.material[this.materialIndex], 'map:', this.object.material[this.materialIndex].map); // Debug log
    }
}

class RotateTextureCommand {
    constructor(object, materialIndex, oldMaterial) {
        this.object = object;
        this.materialIndex = materialIndex;
        this.oldMaterial = oldMaterial;
        this.newMaterial = null; // Will be created in execute
        this.name = 'RotateTexture';
        console.log('RotateTextureCommand constructor:', { object: object.uuid, materialIndex, oldMaterial }); // Debug log
    }

    execute() {
        console.log('RotateTextureCommand execute: Rotating texture for', this.object.uuid, 'at index', this.materialIndex); // Debug log
        
        const currentMaterial = this.object.material[this.materialIndex];
        if (!currentMaterial || !currentMaterial.map) {
            console.warn('No texture found to rotate.');
            return;
        }

        // Clone the old material to create a new one with rotated texture
        this.newMaterial = currentMaterial.clone();
        const oldMap = currentMaterial.map;

        // Create a new texture with rotated UVs
        const newMap = oldMap.clone();
        newMap.rotation = (oldMap.rotation || 0) + Math.PI / 2; // Rotate by 90 degrees (PI/2 radians)
        newMap.needsUpdate = true; // Important for Three.js to re-render with new rotation

        this.newMaterial.map = newMap;
        this.newMaterial.needsUpdate = true;

        this.object.material[this.materialIndex] = this.newMaterial;
        this.object.material.needsUpdate = true; // Ensure the object's material array is updated
        updateTextureRepeatOnObject(this.object);
        console.log('RotateTextureCommand execute: material after rotation', this.object.material[this.materialIndex], 'rotation:', this.object.material[this.materialIndex].map.rotation); // Debug log
    }

    undo() {
        console.log('RotateTextureCommand undo: Restoring old material for', this.object.uuid, 'at index', this.materialIndex); // Debug log
        this.object.material[this.materialIndex] = this.oldMaterial;
        this.object.material.needsUpdate = true;
        updateTextureRepeatOnObject(this.object);
        console.log('RotateTextureCommand undo: material after undo', this.object.material[this.materialIndex], 'map:', this.object.material[this.materialIndex].map); // Debug log
    }
}

class TextureCommand {
    constructor(object, materialIndex, oldMaterial, newMaterial, textureSrc, applyMode) {
        this.object = object;
        this.materialIndex = materialIndex;
        this.oldMaterial = oldMaterial;
        this.newMaterial = newMaterial;
        this.textureSrc = textureSrc; // 텍스처 경로 저장
        this.applyMode = applyMode; // 적용 방식 저장
        this.name = 'ApplyTexture';
    }

    execute() {
        this.object.material[this.materialIndex] = this.newMaterial;
        this.object.material.needsUpdate = true;
    }

    undo() {
        this.object.material[this.materialIndex] = this.oldMaterial;
        this.object.material.needsUpdate = true;
    }
}

class GroupTextureCommand {
    constructor(commands) {
        this.commands = commands;
        this.name = 'ApplyTextureToAllFaces';
    }

    execute() {
        this.commands.forEach(command => command.execute());
    }

    undo() {
        // Undo는 역순으로 실행하는 것이 안전합니다.
        for (let i = this.commands.length - 1; i >= 0; i--) {
            this.commands[i].undo();
        }
    }
}

// 컨텍스트 메뉴 관련 변수
let contextMenu = null;
let contextMenuTarget = null;

// 우클릭 context-menu 드래그 방지용 변수
let rightClickDownPos = null;
let rightClickDragThreshold = 5; // px
renderer.domElement.addEventListener('pointerdown', function(event) {
    if (event.button === 2 || event.button === 1) {
        hideContextMenu();
    }
    if (event.button === 2) { // 우클릭
        rightClickDownPos = { x: event.clientX, y: event.clientY };
    }
});
renderer.domElement.addEventListener('pointerup', function(event) {
    if (event.button === 2) {
        // pointerup에서 contextmenu가 뜨는 것을 막기 위해 좌표 차이 기록
        if (rightClickDownPos) {
            const dx = event.clientX - rightClickDownPos.x;
            const dy = event.clientY - rightClickDownPos.y;
            rightClickDownPos.dragged = (Math.abs(dx) > rightClickDragThreshold || Math.abs(dy) > rightClickDragThreshold);
        }
    }
});
function onRightClick(event) {
    event.preventDefault(); // 기본 컨텍스트 메뉴 방지
    // 드래그(마우스 이동) 시에는 context-menu 띄우지 않음
    if (rightClickDownPos && rightClickDownPos.dragged) {
        rightClickDownPos = null;
        return;
    }
    rightClickDownPos = null;
    // 기존 컨텍스트 메뉴 숨김
    hideContextMenu();
    // 마우스 위치 업데이트
    updateMouseAndRaycaster(event);
    const intersects = raycaster.intersectObjects(drawableObjects);
    if (intersects.length > 0) {
        const targetObject = intersects[0].object;
        const materialIndex = intersects[0].face.materialIndex; // 클릭된 면의 materialIndex 가져오기
        console.log('onRightClick: targetObject', targetObject.uuid, 'materialIndex', materialIndex); // Debug log
        // 돌출 중인 객체는 컨텍스트 메뉴 표시 안함
        if (isExtruding && extrudeTarget === targetObject) {
            return;
        }
        // 컨텍스트 메뉴 표시
        showContextMenu(event.clientX, event.clientY, targetObject, materialIndex);
    }
}

let contextMenuMaterialIndex = -1; // 컨텍스트 메뉴가 표시될 때의 materialIndex 저장

function showContextMenu(x, y, targetObject, materialIndex) {
    console.log('showContextMenu: targetObject', targetObject.uuid, 'materialIndex', materialIndex); // Debug log
    if (!contextMenu) {
        contextMenu = document.getElementById('context-menu');

        // 컨텍스트 메뉴 위에 마우스가 올라가면 모든 하이라이트를 숨김
        contextMenu.addEventListener('mouseenter', () => {
            // 돌출/면 하이라이트(녹색 등) 숨기기
            if (highlightMesh) {
                highlightMesh.visible = false;
            }
            // 텍스처링 하이라이트(노란색) 제거
            clearTextureHighlight();
        });
        
        // 삭제 버튼 클릭 이벤트
        const deleteButton = document.getElementById('delete-object');
        deleteButton.addEventListener('click', () => {
            if (contextMenuTarget) {
                deleteObject(contextMenuTarget);
                hideContextMenu();
            }
        });
        
        // 복사 버튼 클릭 이벤트
        const copyButton = document.getElementById('copy-object');
        copyButton.addEventListener('click', () => {
            if (contextMenuTarget) {
                const newObj = deepCloneMesh(contextMenuTarget);
                const command = new AddObjectCommand(scene, newObj, drawableObjects);
                history.execute(command);
                hideContextMenu();
            }
        });

        // 텍스처 삭제 버튼 클릭 이벤트
        const deleteTextureButton = document.getElementById('delete-texture');
        deleteTextureButton.addEventListener('click', () => {
            console.log('Delete Texture button clicked. contextMenuTarget:', contextMenuTarget ? contextMenuTarget.uuid : 'null', 'contextMenuMaterialIndex:', contextMenuMaterialIndex); // Debug log
            if (contextMenuTarget && contextMenuMaterialIndex !== -1) {
                const oldMaterial = contextMenuTarget.material[contextMenuMaterialIndex];
                const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
                
                console.log('Executing RemoveTextureCommand with oldMaterial:', oldMaterial, 'defaultMaterial:', defaultMaterial); // Debug log
                const command = new RemoveTextureCommand(contextMenuTarget, contextMenuMaterialIndex, oldMaterial, defaultMaterial);
                history.execute(command);
                renderer.render(scene, camera); // 텍스처 삭제 후 즉시 렌더링 업데이트
                clearTextureHighlight(); // 텍스처 하이라이트 제거
                hideContextMenu();
            } else {
                console.warn('Cannot delete texture: contextMenuTarget or contextMenuMaterialIndex is invalid.'); // Debug warning
            }
        });

        // 텍스처 회전 버튼 클릭 이벤트
        const rotateTextureButton = document.getElementById('rotate-texture');
        rotateTextureButton.addEventListener('click', () => {
            console.log('Rotate Texture button clicked. contextMenuTarget:', contextMenuTarget ? contextMenuTarget.uuid : 'null', 'contextMenuMaterialIndex:', contextMenuMaterialIndex); // Debug log
            if (contextMenuTarget && contextMenuMaterialIndex !== -1) {
                const oldMaterial = contextMenuTarget.material[contextMenuMaterialIndex].clone(); // oldMaterial을 복제하여 전달
                
                console.log('Executing RotateTextureCommand with oldMaterial:', oldMaterial); // Debug log
                const command = new RotateTextureCommand(contextMenuTarget, contextMenuMaterialIndex, oldMaterial);
                history.execute(command);
                renderer.render(scene, camera); // 텍스처 회전 후 즉시 렌더링 업데이트
                clearTextureHighlight(); // 텍스처 하이라이트 제거
                hideContextMenu();
            } else {
                console.warn('Cannot rotate texture: contextMenuTarget or contextMenuMaterialIndex is invalid.'); // Debug warning
            }
        });

        // 텍스처 적용 방식 버튼 클릭 이벤트
        const textureModeStretchButton = document.getElementById('texture-mode-stretch');
        const textureModeOriginalButton = document.getElementById('texture-mode-original');

        if (textureModeStretchButton) {
            textureModeStretchButton.addEventListener('click', async () => {
                if (contextMenuTarget && contextMenuMaterialIndex !== -1) {
                    const currentMaterial = contextMenuTarget.material[contextMenuMaterialIndex];
                    if (currentMaterial && currentMaterial.map) {
                        const command = await applyTextureToFace(contextMenuTarget, contextMenuMaterialIndex, currentMaterial.map.image.src, 'stretch', currentMaterial.clone());
                        history.execute(command);
                    }
                    hideContextMenu();
                }
            });
        }

        if (textureModeOriginalButton) {
            textureModeOriginalButton.addEventListener('click', async () => {
                if (contextMenuTarget && contextMenuMaterialIndex !== -1) {
                    const currentMaterial = contextMenuTarget.material[contextMenuMaterialIndex];
                    if (currentMaterial && currentMaterial.map) {
                        const command = await applyTextureToFace(contextMenuTarget, contextMenuMaterialIndex, currentMaterial.map.image.src, 'original', currentMaterial.clone());
                        history.execute(command);
                    }
                    hideContextMenu();
                }
            });
        }
        
        // 외부 클릭 시 메뉴 숨김
        document.addEventListener('click', (event) => {
            if (!contextMenu.contains(event.target)) {
                hideContextMenu();
            }
        });
    }
    
    contextMenuTarget = targetObject;
    contextMenuMaterialIndex = materialIndex; // materialIndex 저장

    // 텍스처 삭제, 회전, 적용 방식 버튼 표시/숨김 로직
    const deleteTextureButton = document.getElementById('delete-texture');
    const rotateTextureButton = document.getElementById('rotate-texture');
    const textureApplyModeMenu = document.getElementById('texture-apply-mode-menu'); // 새로 추가된 메뉴

    if (deleteTextureButton && rotateTextureButton && textureApplyModeMenu) {
        let hasTexture = false;
        // 클릭된 면의 materialIndex를 사용하여 해당 재질에 텍스처가 있는지 확인
        if (Array.isArray(targetObject.material)) {
            if (targetObject.material[materialIndex] && targetObject.material[materialIndex].map) {
                hasTexture = true;
            }
        } else {
            // 단일 재질인 경우 (materialIndex는 0일 것)
            if (targetObject.material && targetObject.material.map) {
                hasTexture = true;
            }
        }
        console.log('showContextMenu: hasTexture', hasTexture); // Debug log
        deleteTextureButton.style.display = hasTexture ? 'block' : 'none';
        rotateTextureButton.style.display = hasTexture ? 'block' : 'none';
        textureApplyModeMenu.style.display = hasTexture ? 'block' : 'none'; // 텍스처 적용 방식 메뉴도 텍스처가 있을 때만 표시
    }

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        contextMenuTarget = null;
    }
    // 컨텍스트 메뉴가 닫힐 때 모든 객체의 하이라이트를 제거
    drawableObjects.forEach(obj => {
        if (obj.userData._origMaterialColors) {
            obj.material.forEach((m, i) => {
                m.color.copy(obj.userData._origMaterialColors[i]);
                m.needsUpdate = true;
            });
            delete obj.userData._origMaterialColors;
        }
    });
}

function deleteObject(objectToDelete) {
    // DeleteObjectCommand에 findStackedObjectsRecursive 함수를 전달
    const command = new DeleteObjectCommand(scene, objectToDelete, drawableObjects, findStackedObjectsRecursive);
    history.execute(command);
}

// DeleteObjectCommand에서 호출할 수 있도록 전역 스코프에 함수 정의
function clearSelectedHighlightAfterDeletion(deletedObject) {
    if (selectedObject === deletedObject) {
        clearSelectedHighlight();
        selectedObject = null;
    }
}

let oldTransformData = null; // 돌출 시작 시점의 상태 저장용

// === extrude 시작 시 extrudeBaseY 저장 ===
let extrudeBaseY = null;
// extrude 관련 그룹 undo/redo용 변수 추가
let extrudeStackedObjects = [];
let extrudeOldTransforms = [];
let initialDragFaceCenter = null;
function findStackedObjectsRecursive(baseObj, resultArr) {
    const baseBox = new THREE.Box3().setFromObject(baseObj);

    drawableObjects.forEach(obj => {
        if (obj === baseObj || resultArr.includes(obj) || !obj.geometry) return;

        const objBox = new THREE.Box3().setFromObject(obj);

        // Check for horizontal overlap
        const overlapX = Math.max(0, Math.min(objBox.max.x, baseBox.max.x) - Math.max(objBox.min.x, baseBox.min.x));
        const overlapZ = Math.max(0, Math.min(objBox.max.z, baseBox.max.z) - Math.max(objBox.min.z, baseBox.min.z));

        // Check if obj is directly on top of baseObj
        const isOnTop = Math.abs(objBox.min.y - baseBox.max.y) < 0.01;

        if (overlapX > 0 && overlapZ > 0 && isOnTop) {
            resultArr.push(obj);
            findStackedObjectsRecursive(obj, resultArr);
        }
    });
}
function onPointerDown(event) {
    if (event.button !== 0) return;
    
    clearTextureHighlight();
    mouseDownPos.set(event.clientX, event.clientY);
    updateMouseAndRaycaster(event);
    const intersects = raycaster.intersectObjects(drawableObjects);

    // 텍스처링 모드일 때도 돌출/그리기 시작은 가능해야 하므로, 바로 return하지 않음
    // if (isTexturingMode) {
    //     return; 
    // }

    if (!drawingMode) return;

    // 1. 윗면(y축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && (Math.abs(intersects[0].face.normal.y) > 0.99)) {
        isExtruding = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;

        const faceNormal = intersects[0].face.normal.clone();
        extrudeYFaceNormal.copy(faceNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(extrudeTarget.matrixWorld)).normalize());

        const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const centerToFace = extrudeYFaceNormal.clone().multiplyScalar(height / 2);
        extrudeFixedPoint = extrudeTarget.position.clone().sub(centerToFace);

        const planeNormal = camera.position.clone().sub(intersects[0].point).normalize();
        dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, intersects[0].point);

        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };

        extrudeStackedObjects = [extrudeTarget];
        findStackedObjectsRecursive(extrudeTarget, extrudeStackedObjects);
        extrudeOldTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        highlightMesh.visible = false;
        return;
    }
    // 1-2. 옆면(x축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && Math.abs(intersects[0].face.normal.x) > 0.99) {
        isExtrudingX = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;

        // Get the world-space normal of the clicked face
        const faceNormal = intersects[0].face.normal.clone();
        extrudeXFaceNormal.copy(faceNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(extrudeTarget.matrixWorld)).normalize());

        // Calculate the position of the fixed face's center (opposite to the dragged one)
        const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const centerToFace = extrudeXFaceNormal.clone().multiplyScalar(width / 2);
        extrudeFixedPoint = extrudeTarget.position.clone().sub(centerToFace);

        // Create a plane that is aligned with the camera's view and passes through the intersection point
        const planeNormal = camera.position.clone().sub(intersects[0].point).normalize();
        dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, intersects[0].point);

        // Save the initial state for undo/redo
        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };
        extrudeStackedObjects = [extrudeTarget];
        findStackedObjectsRecursive(extrudeTarget, extrudeStackedObjects);
        extrudeOldTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        highlightMesh.visible = false;
        return;
    }
    // 1-3. 앞/뒤면(z축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && Math.abs(intersects[0].face.normal.z) > 0.99) {
        isExtrudingZ = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;

        // Get the world-space normal of the clicked face
        const faceNormal = intersects[0].face.normal.clone();
        extrudeZFaceNormal.copy(faceNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(extrudeTarget.matrixWorld)).normalize());

        // Calculate the position of the fixed face's center (opposite to the dragged one)
        const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const centerToFace = extrudeZFaceNormal.clone().multiplyScalar(depth / 2);
        extrudeFixedPoint = extrudeTarget.position.clone().sub(centerToFace);

        // Create a plane that is aligned with the camera's view and passes through the intersection point
        const planeNormal = camera.position.clone().sub(intersects[0].point).normalize();
        dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, intersects[0].point);

        // Save the initial state for undo/redo
        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };
        extrudeStackedObjects = [extrudeTarget];
        findStackedObjectsRecursive(extrudeTarget, extrudeStackedObjects);
        extrudeOldTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        highlightMesh.visible = false;
        return;
    }

    // 2. 돌출이 아니라면 꼭짓점 클릭 확인
    updateAllVertices(); // 이제 여기서 꼭짓점 업데이트
    const clickedVertex = getClickedVertex(event);
    if (clickedVertex) {
        isDrawing = true;
        controls.enabled = false;
        
        // 클릭된 꼭짓점의 높이에 맞춰 그리기 평면 설정
        activeDrawingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -clickedVertex.y);
        startPoint.copy(clickedVertex);
        
        // 스냅 가이드를 즉시 표시
        snapGuide.visible = true;
        snapGuide.position.copy(clickedVertex);
        
        // 프리뷰 메시 생성 (꼭짓점에서 시작할 때도 회색으로 표시)
        const initialHeight = 0.02;
        const previewGeometry = new THREE.BoxGeometry(0.1, initialHeight, 0.1);
        const previewMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
        previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
        
        const planeY = -activeDrawingPlane.constant;
        previewMesh.position.copy(startPoint);
        previewMesh.position.y = planeY + initialHeight / 2;
        scene.add(previewMesh);
        return; // 꼭짓점 클릭으로 그리기를 시작했으므로 여기서 종료
    }

    // 3. 일반적인 그리기 (빈 공간이나 면 위에서)
    activeDrawingPlane = groundPlane;
    if (intersects.length > 0 && intersects[0].face.normal.y > 0.99) {
        activeDrawingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -intersects[0].point.y);
    }

    const intersectionPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(activeDrawingPlane, intersectionPoint)) {
        isDrawing = true;
        controls.enabled = false;
        const snappedPoint = getSnapPoint(intersectionPoint, activeDrawingPlane);
        startPoint.copy(snappedPoint);
        
        const initialHeight = 0.02;
        const previewGeometry = new THREE.BoxGeometry(1, initialHeight, 1);
        const previewMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
        previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
        
        const planeY = -activeDrawingPlane.constant;
        previewMesh.position.copy(startPoint);
        previewMesh.position.y = planeY + initialHeight / 2;
        scene.add(previewMesh);
    }
}

function onPointerMove(event) {
    updateMouseAndRaycaster(event);

    // 그리기/돌출 상태를 먼저 확인하도록 순서 수정
    if (isExtruding) {
        const intersectionPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
            const newHeight = Math.max(0.1, intersectionPoint.clone().sub(extrudeFixedPoint).dot(extrudeYFaceNormal));

            const newPosition = extrudeFixedPoint.clone().add(extrudeYFaceNormal.clone().multiplyScalar(newHeight / 2));
            extrudeTarget.position.copy(newPosition);
            extrudeTarget.scale.y = newHeight / extrudeTarget.geometry.parameters.height;

            const yDelta = (newPosition.y + newHeight / 2) - (oldTransformData.position.y + (oldTransformData.geometry.parameters.height * oldTransformData.scale.y) / 2);

            // Update positions of stacked objects
            for (let i = 1; i < extrudeStackedObjects.length; i++) {
                const objToMove = extrudeStackedObjects[i];
                const oldTransform = extrudeOldTransforms[i];
                objToMove.position.y = oldTransform.position.y + yDelta;
            }

            updateTextureRepeatOnObject(extrudeTarget);
            updateTotalPrice();

            const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
            const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
            const dimensionDiv = document.getElementById('dimension-info');
            if (dimensionDiv) {
                dimensionDiv.style.display = 'block';
                dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${newHeight.toFixed(2)}`;
                dimensionDiv.style.left = (event.clientX + 20) + 'px';
                dimensionDiv.style.top = (event.clientY + 20) + 'px';
            }
        }
    } else if (isExtrudingX) {
        const intersectionPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
            // Calculate the new width based on the distance from the fixed point
            const newWidth = Math.max(0.1, intersectionPoint.clone().sub(extrudeFixedPoint).dot(extrudeXFaceNormal));

            // Recalculate position and scale based on the fixed point
            const newPosition = extrudeFixedPoint.clone().add(extrudeXFaceNormal.clone().multiplyScalar(newWidth / 2));
            extrudeTarget.position.copy(newPosition);
            extrudeTarget.scale.x = newWidth / extrudeTarget.geometry.parameters.width;

            updateTextureRepeatOnObject(extrudeTarget);
            updateTotalPrice();

            const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
            const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
            const dimensionDiv = document.getElementById('dimension-info');
            if (dimensionDiv) {
                dimensionDiv.style.display = 'block';
                dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${newWidth.toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${height.toFixed(2)}`;
                dimensionDiv.style.left = (event.clientX + 20) + 'px';
                dimensionDiv.style.top = (event.clientY + 20) + 'px';
            }
        }
    } else if (isExtrudingZ) {
        const intersectionPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
            // Calculate the new depth based on the distance from the fixed point
            const newDepth = Math.max(0.1, intersectionPoint.clone().sub(extrudeFixedPoint).dot(extrudeZFaceNormal));

            // Recalculate position and scale based on the fixed point
            const newPosition = extrudeFixedPoint.clone().add(extrudeZFaceNormal.clone().multiplyScalar(newDepth / 2));
            extrudeTarget.position.copy(newPosition);
            extrudeTarget.scale.z = newDepth / extrudeTarget.geometry.parameters.depth;

            updateTextureRepeatOnObject(extrudeTarget);
            updateTotalPrice();

            const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
            const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
            const dimensionDiv = document.getElementById('dimension-info');
            if (dimensionDiv) {
                dimensionDiv.style.display = 'block';
                dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${newDepth.toFixed(2)}<br>높이: ${height.toFixed(2)}`;
                dimensionDiv.style.left = (event.clientX + 20) + 'px';
                dimensionDiv.style.top = (event.clientY + 20) + 'px';
            }
        }
    } else if (isDrawing) {
        const currentPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(activeDrawingPlane, currentPoint)) {
            
            // 먼저 꼭짓점 스냅 적용
            let snappedPoint = getSnapPoint(currentPoint, activeDrawingPlane);
            
            // 꼭짓점 스냅이 없으면 축 스냅 적용
            if (snappedPoint.equals(currentPoint)) {
                snappedPoint = getAxisSnap(currentPoint, activeDrawingPlane);
            }

            const initialHeight = 0.02;
            const planeY = -activeDrawingPlane.constant;
            previewMesh.position.x = (snappedPoint.x + startPoint.x) / 2;
            previewMesh.position.z = (snappedPoint.z + startPoint.z) / 2;
            previewMesh.position.y = planeY + initialHeight / 2;
            previewMesh.scale.x = Math.abs(snappedPoint.x - startPoint.x);
            previewMesh.scale.z = Math.abs(snappedPoint.z - startPoint.z);

            // === 크기 정보 마우스 따라다니며 표시 ===
            const width = Math.abs(snappedPoint.x - startPoint.x);
            const depth = Math.abs(snappedPoint.z - startPoint.z);
            const dimensionDiv = document.getElementById('dimension-info');
            if (dimensionDiv) {
                dimensionDiv.style.display = 'block';
                dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${initialHeight.toFixed(2)}`;
                // 마우스 위치로 이동
                dimensionDiv.style.position = 'fixed';
                dimensionDiv.style.left = (event.clientX + 20) + 'px';
                dimensionDiv.style.top = (event.clientY + 20) + 'px';
                dimensionDiv.style.zIndex = 9999;
            }
            // === 크기 정보 표시 끝 ===
        }
    } else if (drawingMode) { // 그리기 모드일 때만 하이라이트 처리 (그리기/돌출 중이 아닐 때)
        updateHighlight();
        if (isTexturingMode) {
            // 돌출 하이라이트(highlightMesh)가 활성화되어 있을 때는
            // 텍스처 하이라이트(노란색)를 표시하지 않아 색상 충돌을 방지합니다.
            if (highlightMesh && highlightMesh.visible) {
                clearTextureHighlight();
            } else {
                updateTextureHighlight();
            }
        }
    } else { // 다른 모드 (이동, 회전)일 때는 하이라이트 끄기
        if(highlightMesh) highlightMesh.visible = false;
        clearTextureHighlight();
    }
}

async function onPointerUp(event) { // async 키워드 추가
    // 텍스처링 모드이고, 드래그가 아닌 클릭일 경우 텍스처 적용
    const dragDistance = mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    if (isTexturingMode && selectedTextureSrc && dragDistance < 5) {
        const intersects = raycaster.intersectObjects(drawableObjects);
        if (intersects.length > 0) {
            const intersection = intersects[0];
            const intersectedObject = intersection.object;
            const materialIndex = intersection.face.materialIndex;
            const oldMaterial = intersectedObject.material[materialIndex].clone();

            const command = await applyTextureToFace(intersectedObject, materialIndex, selectedTextureSrc, textureApplyMode, oldMaterial);
            history.execute(command);
            
            // 텍스처 적용 후에는 다른 onPointerUp 로직(돌출, 그리기 등)을 실행하지 않도록 여기서 종료
            isDrawing = false;
            isExtruding = false;
            isExtrudingX = false;
            isExtrudingZ = false;
            controls.enabled = true;
            return;
        }
    }

    if (isExtruding) {
        const extrudeNewTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        // 기존 TransformCommand 대신 GroupTransformCommand로 기록
        history.execute(new GroupTransformCommand(
            extrudeStackedObjects,
            extrudeOldTransforms,
            extrudeNewTransforms
        ));
        clearAxisGuideLines();
        isExtruding = false;
        extrudeTarget = null;
        controls.enabled = true;
        oldTransformData = null;
        extrudeStackedObjects = [];
        extrudeOldTransforms = [];
        dragPlane = null;
        extrudeFixedPoint = null;
        // === 크기 정보 숨김 ===
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
        // === 크기 정보 숨김 끝 ===
        return;
    } else if (isExtrudingX) {
        // extrudeX(옆면)도 그룹 커맨드로 처리
        const extrudeNewTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        history.execute(new GroupTransformCommand(
            extrudeStackedObjects,
            extrudeOldTransforms,
            extrudeNewTransforms
        ));
        clearAxisGuideLines();
        isExtrudingX = false;
        extrudeTarget = null;
        controls.enabled = true;
        extrudeStackedObjects = [];
        extrudeOldTransforms = [];
        dragPlane = null;
        extrudeFixedPoint = null;
        // 정보창 숨김
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
        return;
    } else if (isExtrudingZ) {
        // extrudeZ(앞/뒤면)도 그룹 커맨드로 처리
        const extrudeNewTransforms = extrudeStackedObjects.map(obj => ({
            geometry: obj.geometry.clone(),
            position: obj.position.clone(),
            scale: obj.scale.clone()
        }));
        history.execute(new GroupTransformCommand(
            extrudeStackedObjects,
            extrudeOldTransforms,
            extrudeNewTransforms
        ));
        clearAxisGuideLines();
        isExtrudingZ = false;
        extrudeTarget = null;
        controls.enabled = true;
        extrudeStackedObjects = [];
        extrudeOldTransforms = [];
        dragPlane = null;
        extrudeFixedPoint = null;
        // 정보창 숨김
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
        return;
    } else if (isDrawing) {
        raycaster.setFromCamera(mouse, camera);
        const endPoint3D = new THREE.Vector3();
        raycaster.ray.intersectPlane(activeDrawingPlane, endPoint3D);
        
        // 먼저 꼭짓점 스냅 적용
        let snappedEndPoint = getSnapPoint(endPoint3D, activeDrawingPlane);
        
        // 꼭짓점 스냅이 없으면 축 스냅 적용
        if (snappedEndPoint.equals(endPoint3D)) {
            snappedEndPoint = getAxisSnap(endPoint3D, activeDrawingPlane);
        }
        if (snapGuide) snapGuide.visible = false; // 그리기 끝나면 가이드 숨김
        clearAxisGuideLines(); // 축 가이드 라인들만 정리

        const width = Math.round(Math.abs(snappedEndPoint.x - startPoint.x));
        const depth = Math.round(Math.abs(snappedEndPoint.z - startPoint.z));
        const initialHeight = 0.02;

        // === 크기 정보 표시 ===
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${initialHeight.toFixed(2)}`;
        }
        // === 크기 정보 표시 끝 ===

        // 프리뷰 메시는 항상 제거
        if (previewMesh) {
            scene.remove(previewMesh);
            previewMesh.geometry.dispose();
            previewMesh.material.dispose();
            previewMesh = null;
        }

        if (width > 0.1 && depth > 0.1) {
            const boxGeometry = new THREE.BoxGeometry(width, initialHeight, depth);
            const materials = [];
            for (let i = 0; i < 6; i++) {
                materials.push(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true }));
            }
            const newBox = new THREE.Mesh(boxGeometry, materials);
            const planeY = -activeDrawingPlane.constant;
            newBox.position.x = (snappedEndPoint.x + startPoint.x) / 2;
            newBox.position.z = (snappedEndPoint.z + startPoint.z) / 2;
            newBox.position.y = planeY + initialHeight / 2;
            setShadowProps(newBox);
            // Command를 통해서만 객체를 추가
            const command = new AddObjectCommand(scene, newBox, drawableObjects);
            history.execute(command);
        }

        isDrawing = false;
        controls.enabled = true;
        activeDrawingPlane = groundPlane;
    }
    // 다른 동작 후에도 하이라이트가 남아있지 않도록 정리
    clearTextureHighlight();
    // === 크기 정보 숨김 ===
    const dimensionDiv = document.getElementById('dimension-info');
    if (dimensionDiv) {
        dimensionDiv.style.display = 'none';
    }
    // === 크기 정보 숨김 끝 ===
}

function updateHighlight() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(drawableObjects);

    let hovered = false;
    if (intersects.length > 0) {
        const intersection = intersects[0];
        const face = intersection.face;
        const object = intersection.object;

        // Only highlight top (Y), side (X), and front/back (Z) faces
        if (Math.abs(face.normal.y) > 0.99 || Math.abs(face.normal.x) > 0.99 || Math.abs(face.normal.z) > 0.99) {
            hovered = true;

            if (!highlightMesh) {
                const highlightMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthTest: false });
                const highlightGeometry = new THREE.PlaneGeometry(1, 1);
                highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
                highlightMesh.renderOrder = 9999; // Render on top of everything
                scene.add(highlightMesh);
            }

            // Set highlight color based on the local face normal
            if (face.normal.y > 0.99 || face.normal.y < -0.99) { // Top or Bottom face
                highlightMesh.material.color.set(0x00ff00); // Green for Y-axis
            } else if (Math.abs(face.normal.x) > 0.99) { // Side face (X-axis)
                highlightMesh.material.color.set(0xff0000); // Red for X-axis
            } else if (Math.abs(face.normal.z) > 0.99) { // Side face (Z-axis)
                highlightMesh.material.color.set(0x0000ff); // Blue for Z-axis
            }
            
            object.updateMatrixWorld();

            // --- Position Calculation ---
            const originalWidth = object.geometry.parameters.width;
            const originalHeight = object.geometry.parameters.height;
            const originalDepth = object.geometry.parameters.depth;
            
            let faceCenterLocal = new THREE.Vector3();
            if (Math.abs(face.normal.y) > 0.99) {
                faceCenterLocal.y = (face.normal.y > 0 ? 1 : -1) * originalHeight / 2;
            } else if (Math.abs(face.normal.x) > 0.99) {
                faceCenterLocal.x = (face.normal.x > 0 ? 1 : -1) * originalWidth / 2;
            } else if (Math.abs(face.normal.z) > 0.99) {
                faceCenterLocal.z = (face.normal.z > 0 ? 1 : -1) * originalDepth / 2;
            }
            
            const faceCenterWorld = faceCenterLocal.applyMatrix4(object.matrixWorld);

            // --- Rotation and Scale Calculation (New Robust Logic) ---
            const scaledWidth = originalWidth * object.scale.x;
            const scaledHeight = originalHeight * object.scale.y;
            const scaledDepth = originalDepth * object.scale.z;

            const localRotation = new THREE.Quaternion();

            if (Math.abs(face.normal.y) > 0.99) { // Top or Bottom face
                highlightMesh.scale.set(scaledWidth, scaledDepth, 1);
                const angle = face.normal.y > 0 ? -Math.PI / 2 : Math.PI / 2;
                localRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
            } else if (Math.abs(face.normal.x) > 0.99) { // Side face (X-axis)
                highlightMesh.scale.set(scaledDepth, scaledHeight, 1);
                const angle = face.normal.x > 0 ? Math.PI / 2 : -Math.PI / 2;
                localRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            } else if (Math.abs(face.normal.z) > 0.99) { // Side face (Z-axis)
                highlightMesh.scale.set(scaledWidth, scaledHeight, 1);
                if (face.normal.z < 0) {
                    localRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
                }
            }

            // Combine object's world rotation with the local rotation for the highlight
            highlightMesh.quaternion.copy(object.quaternion).multiply(localRotation);

            // --- Final Position with Offset ---
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
            const worldFaceNormal = face.normal.clone().applyMatrix3(normalMatrix).normalize();
            const offset = worldFaceNormal.clone().multiplyScalar(0.01);
            highlightMesh.position.copy(faceCenterWorld).add(offset);

            highlightMesh.visible = true;
        } else {
             if (highlightMesh) {
                highlightMesh.visible = false;
            }
        }
    } else {
        if (highlightMesh) {
            highlightMesh.visible = false;
        }
    }
}

function clearTextureHighlight() {
    if (highlightedFaceInfo.object) {
        // 현재 재질이 하이라이트 재질인 경우에만 원래 재질로 복원
        if (highlightedFaceInfo.object.material[highlightedFaceInfo.faceIndex] === textureHighlightMaterial) {
            highlightedFaceInfo.object.material[highlightedFaceInfo.faceIndex] = highlightedFaceInfo.originalMaterial;
            highlightedFaceInfo.object.material.needsUpdate = true;
        }
    }
    // 상태 초기화
    highlightedFaceInfo.object = null;
    highlightedFaceInfo.faceIndex = -1;
    highlightedFaceInfo.originalMaterial = null;
}

function updateTextureHighlight() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(drawableObjects);

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const object = intersection.object;
        const faceIndex = intersection.face.materialIndex;

        // 이미 같은 면이 하이라이트된 경우, 아무것도 안 함
        if (highlightedFaceInfo.object === object && highlightedFaceInfo.faceIndex === faceIndex) {
            return;
        }
        
        // 다른 면이 하이라이트된 경우, 이전 하이라이트를 먼저 복원
        clearTextureHighlight();

        // 새로운 면의 정보를 저장
        highlightedFaceInfo.object = object;
        highlightedFaceInfo.faceIndex = faceIndex;
        highlightedFaceInfo.originalMaterial = object.material[faceIndex];

        // 하이라이트 재질 적용
        object.material[faceIndex] = textureHighlightMaterial;
        object.material.needsUpdate = true;
        
    } else {
        // 마우스가 어떤 객체 위에도 없을 경우, 하이라이트 제거
        clearTextureHighlight();
    }
}

// --- 스냅 관련 함수 (정의를 위로 올림) ---
function setupSnapGuide() {
    const geometry = new THREE.SphereGeometry(0.05, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.7 });
    snapGuide = new THREE.Mesh(geometry, material);
    snapGuide.visible = false;
    scene.add(snapGuide);
}

function updateAllVertices(excludeObj) {
    allVertices = [];
    drawableObjects.forEach(obj => {
        if (excludeObj && obj === excludeObj) return;
        const positionAttribute = obj.geometry.getAttribute('position');
        const localVertices = [];
        for (let i = 0; i < positionAttribute.count; i++) {
            const vertex = new THREE.Vector3();
            vertex.fromBufferAttribute(positionAttribute, i);
            localVertices.push(vertex);
        }
        
        // 로컬 좌표를 월드 좌표로 변환하여 저장
        localVertices.forEach(vertex => {
            allVertices.push(vertex.clone().applyMatrix4(obj.matrixWorld));
        });
    });
}

function getSnapPoint(point, plane) {
    let closestPoint = null;
    let minDistance = snapDistance;

    allVertices.forEach(vertex => {
        // 현재 그리기 평면과 비슷한 높이에 있는 꼭짓점만 고려
        if (Math.abs(vertex.y - (-plane.constant)) < 0.1) {
            const distance = point.distanceTo(vertex);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = vertex;
            }
        }
    });
    
    if (snapGuide) { // snapGuide가 초기화되었는지 확인
        snapGuide.visible = !!closestPoint;
        if(closestPoint) {
            snapGuide.position.copy(closestPoint);
        }
    }

    return closestPoint || point; // 스냅 포인트가 있으면 그것을, 없으면 원래 포인트를 반환
}

function getClickedVertex(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse2D = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
    const canvasSize = new THREE.Vector2(rect.width, rect.height);

    let clickedVertex = null;
    let minDistanceSq = 15 * 15; // 15px 반경 안의 꼭짓점을 클릭 대상으로 간주

    for (const vertex3D of allVertices) {
        // 꼭짓점의 3D 월드 좌표를 2D 화면 좌표로 변환
        const projectedPoint = vertex3D.clone().project(camera);

        // 화면 밖으로 나간 점은 무시
        if (projectedPoint.x < -1 || projectedPoint.x > 1 || projectedPoint.y < -1 || projectedPoint.y > 1) {
            continue;
        }

        const screenPoint = new THREE.Vector2(
            (projectedPoint.x + 1) * canvasSize.x / 2,
            (-projectedPoint.y + 1) * canvasSize.y / 2
        );

        const distanceSq = mouse2D.distanceToSquared(screenPoint);

        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            clickedVertex = vertex3D;
        }
    }

    return clickedVertex;
}

function updateMouseAndRaycaster(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
}

// 높이 스냅 함수 제거됨 (가이드라인 에러 방지)

// X/Z축 스냅 함수
function getAxisSnap(point, plane) {
    const snapThreshold = 0.5;
    let snappedPoint = point.clone();
    let hasSnap = false;

    drawableObjects.forEach(obj => {
        const objWidth = obj.geometry.parameters.width * obj.scale.x;
        const objDepth = obj.geometry.parameters.depth * obj.scale.z;
        
        // X축 스냅 (왼쪽, 중앙, 오른쪽 모서리)
        const xPositions = [
            obj.position.x - objWidth / 2,
            obj.position.x,
            obj.position.x + objWidth / 2
        ];
        
        // Z축 스냅 (앞, 중앙, 뒤 모서리)
        const zPositions = [
            obj.position.z - objDepth / 2,
            obj.position.z,
            obj.position.z + objDepth / 2
        ];

        // X축 스냅 체크
        xPositions.forEach(xPos => {
            if (Math.abs(point.x - xPos) < snapThreshold) {
                snappedPoint.x = xPos;
                showAxisGuideLine('x', xPos, obj.position.z, objDepth);
                hasSnap = true;
            }
        });

        // Z축 스냅 체크
        zPositions.forEach(zPos => {
            if (Math.abs(point.z - zPos) < snapThreshold) {
                snappedPoint.z = zPos;
                showAxisGuideLine('z', zPos, obj.position.x, objWidth);
                hasSnap = true;
            }
        });
    });

    if (!hasSnap) {
        clearAxisGuideLines();
    }

    return snappedPoint;
}

// 높이 가이드 라인 함수 제거됨

// X/Z축 가이드 라인 표시
function showAxisGuideLine(axis, position, centerPos, size) {
    clearAxisGuideLines();
    
    let geometry, guideLine;
    const material = new THREE.MeshBasicMaterial({ 
        color: 0x00ff00, 
        transparent: true, 
        opacity: 0.7 
    });

    if (axis === 'x') {
        geometry = new THREE.PlaneGeometry(0.05, size + 2);
        guideLine = new THREE.Mesh(geometry, material);
        guideLine.rotation.x = -Math.PI / 2;
        guideLine.position.set(position, 0.01, centerPos);
    } else { // z축
        geometry = new THREE.PlaneGeometry(size + 2, 0.05);
        guideLine = new THREE.Mesh(geometry, material);
        guideLine.rotation.x = -Math.PI / 2;
        guideLine.position.set(centerPos, 0.01, position);
    }
    
    scene.add(guideLine);
    axisGuideLines.push(guideLine);
}

// 전체 가이드 라인 제거 함수는 사용 안함 (축 가이드만 사용)

// 축 가이드 라인만 제거
function clearAxisGuideLines() {
    axisGuideLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
    });
    axisGuideLines = [];
}

// 6. 렌더링 루프 및 반응형 처리
function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
        renderer.setSize(width, height, false);
    }
    return needResize;
}

// === 오른쪽 하단 3D 오리엔테이션(뷰 축) 위젯 개선 ===
const axisCanvas = document.getElementById('axis-orbit');
let axisRenderer, axisScene, axisCamera, axisGroup, axisSpheres = [], axisLabels = [];
if (axisCanvas) {
    axisRenderer = new THREE.WebGLRenderer({ canvas: axisCanvas, alpha: true, antialias: true });
    axisRenderer.setClearColor(0x000000, 0);
    axisRenderer.setSize(120, 120, false);
    axisScene = new THREE.Scene();
    axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    axisCamera.position.set(0, 0, 3.5);
    axisGroup = new THREE.Group();
    // 중심 구(회색)
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
    const centerGeom = new THREE.SphereGeometry(0.13, 24, 24);
    const centerSphere = new THREE.Mesh(centerGeom, centerMat);
    axisGroup.add(centerSphere);
    // X축(빨강) + 구 + 라벨
    const xMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const xGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 16);
    const xAxis = new THREE.Mesh(xGeom, xMat);
    xAxis.position.x = 0.45;
    xAxis.rotation.z = -Math.PI/2;
    axisGroup.add(xAxis);
    const xSphere = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    xSphere.position.x = 0.9;
    axisGroup.add(xSphere);
    axisSpheres.push(xSphere);
    // Y축(연두) + 구 + 라벨
    const yMat = new THREE.MeshBasicMaterial({ color: 0x99ff44 });
    const yGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 16);
    const yAxis = new THREE.Mesh(yGeom, yMat);
    yAxis.position.y = 0.45;
    axisGroup.add(yAxis);
    const ySphere = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), new THREE.MeshBasicMaterial({ color: 0x99ff44 }));
    ySphere.position.y = 0.9;
    axisGroup.add(ySphere);
    axisSpheres.push(ySphere);
    // Z축(파랑) + 구 + 라벨
    const zMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const zGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 16);
    const zAxis = new THREE.Mesh(zGeom, zMat);
    zAxis.position.z = 0.45;
    zAxis.rotation.x = Math.PI/2;
    axisGroup.add(zAxis);
    const zSphere = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), new THREE.MeshBasicMaterial({ color: 0x4488ff }));
    zSphere.position.z = 0.9;
    axisGroup.add(zSphere);
    axisSpheres.push(zSphere);
    axisScene.add(axisGroup);
    // 라벨(X/Y/Z) - CSS2DRenderer 대신 2D 캔버스 오버레이로 후처리 예정
}

function animate() {
    requestAnimationFrame(animate);

    // 클릭 시에만 애니메이션 동작
    if (isCameraAnimating) {
      camera.position.lerp(cameraTargetPos, 0.1);
      controls.target.lerp(cameraTargetLook, 0.1);
      controls.update();
      // 목표 위치에 충분히 가까워지면 애니메이션 종료
      if (
        camera.position.distanceTo(cameraTargetPos) < 0.01 &&
        controls.target.distanceTo(cameraTargetLook) < 0.01
      ) {
        camera.position.copy(cameraTargetPos);
        controls.target.copy(cameraTargetLook);
        controls.update();
        isCameraAnimating = false;
      }
    }

    // === 팬(이동)으로 지하로 내려가는 것 방지 ===
    if (controls.target.y < 0) {
        const delta = -controls.target.y;
        controls.target.y = 0;
        camera.position.y += delta;
        controls.update();
    }

    if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
    }
    
    controls.update();
    renderer.render(scene, camera);
    // === axis-orbit 동기화 ===
    if (axisRenderer && axisScene && axisCamera && axisGroup && axisCanvas) {
        axisGroup.quaternion.copy(camera.quaternion);
        axisRenderer.render(axisScene, axisCamera);
        // 라벨(X/Y/Z) 직접 2D로 그림
        const ctx = axisCanvas.getContext('2d');
        if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, axisCanvas.width, axisCanvas.height);
            axisRenderer.render(axisScene, axisCamera);
            // 라벨 위치 계산 (3D -> 2D)
            const project = v => {
                const vector = v.clone();
                vector.applyQuaternion(camera.quaternion);
                vector.project(axisCamera);
                return [
                    (vector.x * 0.5 + 0.5) * axisCanvas.width,
                    (-vector.y * 0.5 + 0.5) * axisCanvas.height
                ];
            };
            const labelData = [
                { text: 'X', color: '#ff4444', pos: new THREE.Vector3(0.9, 0, 0) },
                { text: 'Y', color: '#99ff44', pos: new THREE.Vector3(0, 0.9, 0) },
                { text: 'Z', color: '#4488ff', pos: new THREE.Vector3(0, 0, 0.9) }
            ];
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            labelData.forEach(l => {
                const [x, y] = project(l.pos);
                ctx.fillStyle = l.color;
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 4;
                ctx.strokeText(l.text, x, y);
                ctx.fillText(l.text, x, y);
            });
            ctx.restore();
        }
    }

    if (selectedObject && highlightOverlayMesh) {
        highlightOverlayMesh.position.copy(selectedObject.position);
        highlightOverlayMesh.rotation.copy(selectedObject.rotation);
        highlightOverlayMesh.scale.copy(selectedObject.scale);
    }

    // 카메라 방향 표시 업데이트
    if (cameraDirectionCtx) {
        cameraDirectionCtx.clearRect(0, 0, cameraDirectionCanvas.width, cameraDirectionCanvas.height);

        // 카메라의 전방 벡터 (월드 좌표계)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);

        // 캔버스 중앙 (0,0)을 기준으로 방향을 그립니다.
        const centerX = cameraDirectionCanvas.width / 2;
        const centerY = cameraDirectionCanvas.height / 2;
        const scale = 40; // 방향 벡터의 길이를 조절

        // 화살표의 끝점
        const tipX = centerX + cameraDirection.x * scale;
        const tipY = centerY + cameraDirection.z * scale; // Z축 방향을 반전하여 표시

        // 화살표 몸통 그리기
        cameraDirectionCtx.beginPath();
        cameraDirectionCtx.moveTo(centerX, centerY);
        cameraDirectionCtx.lineTo(tipX, tipY);
        cameraDirectionCtx.strokeStyle = 'red';
        cameraDirectionCtx.lineWidth = 2;
        cameraDirectionCtx.stroke();

        // 화살표 머리 그리기
        const angle = Math.atan2(tipY - centerY, tipX - centerX); // 화살표 몸통의 각도
        const arrowheadLength = 10; // 화살표 머리 길이
        const arrowheadAngle = Math.PI / 6; // 30도

        cameraDirectionCtx.beginPath();
        cameraDirectionCtx.moveTo(tipX, tipY);
        cameraDirectionCtx.lineTo(
            tipX - arrowheadLength * Math.cos(angle - arrowheadAngle),
            tipY - arrowheadLength * Math.sin(angle - arrowheadAngle)
        );
        cameraDirectionCtx.moveTo(tipX, tipY);
        cameraDirectionCtx.lineTo(
            tipX - arrowheadLength * Math.cos(angle + arrowheadAngle),
            tipY - arrowheadLength * Math.sin(angle + arrowheadAngle)
        );
        cameraDirectionCtx.strokeStyle = 'red';
        cameraDirectionCtx.lineWidth = 2;
        cameraDirectionCtx.stroke();

        // 방위 라벨 그리기
        cameraDirectionCtx.fillStyle = 'black';
        cameraDirectionCtx.font = 'bold 12px Arial';
        cameraDirectionCtx.textAlign = 'center';
        cameraDirectionCtx.textBaseline = 'middle';

        const radius = cameraDirectionCanvas.width / 2 - 10; // 원형 위젯의 가장자리에서 약간 안쪽

        // North (Positive Z in world, Up on canvas)
        cameraDirectionCtx.fillText('N', centerX, centerY - radius);
        // East (Positive X in world, Right on canvas)
        cameraDirectionCtx.fillText('E', centerX + radius, centerY);
        // South (Negative Z in world, Down on canvas) - Z축이 반대이므로 Y는 +radius
        cameraDirectionCtx.fillText('S', centerX, centerY + radius);
        // West (Negative X in world, Left on canvas)
        cameraDirectionCtx.fillText('W', centerX - radius, centerY);
    }

    // === 쌓인 도형 동기화 ===
    // for (let obj of drawableObjects) {
    //     stickStackedObjects(obj);
    // }
}

animate(); 

function updateTotalPrice() {
    let totalPrice = 0;
    const texturePalette = document.getElementById('texture-palette');

    drawableObjects.forEach(object => {
        if (!object.material) return;

        const materials = Array.isArray(object.material) ? object.material : [object.material];
        
        materials.forEach((material, materialIndex) => {
            if (material.map && material.userData && material.userData.textureApplyMode === 'original') {
                const textureSrc = material.userData.textureSrc;
                if (!textureSrc) return;

                let relativeTextureSrc = textureSrc;
                if (textureSrc.startsWith('http://') || textureSrc.startsWith('https://')) {
                    try {
                        const url = new URL(textureSrc);
                        const texturesPathIndex = url.pathname.indexOf('/textures/');
                        if (texturesPathIndex !== -1) {
                            relativeTextureSrc = url.pathname.substring(texturesPathIndex + 1);
                        } else {
                            relativeTextureSrc = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
                        }
                    } catch (e) {
                        relativeTextureSrc = textureSrc;
                    }
                }

                const textureOption = texturePalette.querySelector(`.texture-option[data-texture="${relativeTextureSrc}"]`);
                if (!textureOption) return;

                const pricePerSqm = parseFloat(textureOption.dataset.price);
                if (isNaN(pricePerSqm)) return;

                let faceWidthM = 1;
                let faceHeightM = 1;
                const geometry = object.geometry;
                const scale = object.scale;
                let normal = new THREE.Vector3();

                switch (materialIndex) {
                    case 0: normal.set(1, 0, 0); break;
                    case 1: normal.set(-1, 0, 0); break;
                    case 2: normal.set(0, 1, 0); break;
                    case 3: normal.set(0, -1, 0); break;
                    case 4: normal.set(0, 0, 1); break;
                    case 5: normal.set(0, 0, -1); break;
                }
                normal.applyQuaternion(object.quaternion).normalize();

                if (Math.abs(normal.y) > 0.99) { // Top/Bottom face
                    faceWidthM = geometry.parameters.width * scale.x;
                    faceHeightM = geometry.parameters.depth * scale.z;
                } else if (Math.abs(normal.x) > 0.99) { // Side face (X)
                    faceWidthM = geometry.parameters.depth * scale.z;
                    faceHeightM = geometry.parameters.height * scale.y;
                } else if (Math.abs(normal.z) > 0.99) { // Side face (Z)
                    faceWidthM = geometry.parameters.width * scale.x;
                    faceHeightM = geometry.parameters.height * scale.y;
                }

                const area = faceWidthM * faceHeightM;
                totalPrice += area * pricePerSqm;
            }
        });
    });

    const priceDisplay = document.getElementById('total-price-display');
    if (priceDisplay) {
        priceDisplay.textContent = `₩${Math.round(totalPrice).toLocaleString()}`;
    }
}

// === 메뉴 드롭다운 Undo/Redo 활성화 상태 관리 ===
function updateUndoRedoMenuState() {
    const undoItem = document.querySelector('.menu-item:nth-child(2) .dropdown-item:nth-child(1)');
    const redoItem = document.querySelector('.menu-item:nth-child(2) .dropdown-item:nth-child(2)');
    if (!undoItem || !redoItem) return;
    if (history.undoStack.length > 0) {
        undoItem.classList.remove('disabled');
        undoItem.style.pointerEvents = '';
    } else {
        undoItem.classList.add('disabled');
        undoItem.style.pointerEvents = 'none';
    }
    if (history.redoStack.length > 0) {
        redoItem.classList.remove('disabled');
        redoItem.style.pointerEvents = '';
    } else {
        redoItem.classList.add('disabled');
        redoItem.style.pointerEvents = 'none';
    }
}

// 메뉴 클릭 이벤트 바인딩
window.addEventListener('DOMContentLoaded', () => {
    if (window.feather) window.feather.replace();

    // 카메라 방향 표시 캔버스 초기화
    cameraDirectionCanvas = document.getElementById('camera-direction-canvas');
    if (cameraDirectionCanvas) {
        cameraDirectionCtx = cameraDirectionCanvas.getContext('2d');
        // 캔버스 크기 설정 (CSS에서 설정한 크기와 동일하게)
        cameraDirectionCanvas.width = 100;
        cameraDirectionCanvas.height = 100;
    }

    // Help Guide Modal Logic
    const helpGuideButton = document.getElementById('help-guide-button');
    const helpGuideModal = document.getElementById('help-guide-modal');
    const closeButton = helpGuideModal.querySelector('.close-button');

    if (helpGuideButton && helpGuideModal && closeButton) {
        const openModal = () => {
            helpGuideModal.style.display = 'flex';
            // A short delay is needed to allow the browser to apply the 'display' change
            // before the 'opacity' transition starts.
            setTimeout(() => {
                helpGuideModal.classList.add('show');
                document.body.style.overflow = 'hidden';
                if (window.feather) feather.replace();
            }, 10);
        };

        const closeModal = () => {
            helpGuideModal.classList.remove('show');
            helpGuideModal.addEventListener('transitionend', () => {
                helpGuideModal.style.display = 'none';
                document.body.style.overflow = 'none';
            }, { once: true });
        };

        helpGuideButton.addEventListener('click', openModal);
        closeButton.addEventListener('click', closeModal);

        // Close modal on outside click
        window.addEventListener('click', (event) => {
            if (event.target === helpGuideModal) {
                closeModal();
            }
        });

        // Close modal on ESC key press
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && helpGuideModal.classList.contains('show')) {
                closeModal();
            }
        });
    }

    // 실행취소
    const undoItem = document.querySelector('.menu-item:nth-child(2) .dropdown-item:nth-child(1)');
    if (undoItem) {
        undoItem.addEventListener('click', (e) => {
            if (!undoItem.classList.contains('disabled')) {
                history.undo();
                updateUndoRedoMenuState();
            }
        });
    }
    // 다시실행
    const redoItem = document.querySelector('.menu-item:nth-child(2) .dropdown-item:nth-child(2)');
    if (redoItem) {
        redoItem.addEventListener('click', (e) => {
            if (!redoItem.classList.contains('disabled')) {
                history.redo();
                updateUndoRedoMenuState();
            }
        });
    }
    updateUndoRedoMenuState();
});

// history 상태가 바뀔 때마다 메뉴 상태 갱신
const origExecute = history.execute.bind(history);
history.execute = function(cmd) {
    origExecute(cmd);
    updateUndoRedoMenuState();
    updateTotalPrice(); // 가격 업데이트 호출
};
const origUndo = history.undo.bind(history);
history.undo = function() {
    origUndo();
    updateUndoRedoMenuState();
    updateTotalPrice(); // 가격 업데이트 호출
};
const origRedo = history.redo.bind(history);
history.redo = function() {
    origRedo();
    updateUndoRedoMenuState();
    updateTotalPrice(); // 가격 업데이트 호출
}; 

// === 격자 보기 토글 및 체크박스 표시 ===
window.addEventListener('DOMContentLoaded', () => {
    const gridMenu = document.getElementById('toggle-grid');
    if (gridMenu) {
        // 초기 상태 반영
        updateGridCheck();
        gridMenu.addEventListener('click', toggleGridVisibility);
    }
});

function toggleGridVisibility() {
    gridHelper.visible = !gridHelper.visible;
    updateGridCheck();
}

function updateGridCheck() {
    const gridMenu = document.getElementById('toggle-grid');
    const checkSpan = gridMenu ? gridMenu.querySelector('.check') : null;
    if (checkSpan) {
        if (gridHelper.visible) {
            checkSpan.textContent = '✓';
        } else {
            checkSpan.textContent = '';
        }
    }
} 

// === 툴바 버튼 활성화 관리 (아이콘 종류와 무관하게 동작) ===
window.addEventListener('DOMContentLoaded', () => {
    const toolBtns = Array.from(document.querySelectorAll('#toolbar-vertical .tool-btn'));
    const moveBtn = document.getElementById('tool-select');
    const rotateBtn = document.getElementById('tool-refresh');
    const drawBtn = document.getElementById('tool-scale');
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 상태값 동기화
            if (btn === drawBtn) {
                drawingMode = true;
                moveMode = false;
                rotateMode = false;
                controls.enabled = true; // 그리기 모드에서는 OrbitControls 활성화
            } else if (btn === moveBtn) {
                drawingMode = false;
                moveMode = true;
                rotateMode = false;
                controls.enabled = true; // 이동 모드에서는 OrbitControls 활성화
            } else if (btn === rotateBtn) {
                drawingMode = false;
                moveMode = false;
                rotateMode = true;
                transformControls.setMode('rotate'); // 회전 모드 설정
                transformControls.showX = true;
                transformControls.showY = true;
                transformControls.showZ = true;
                transformControls.space = 'local'; // 로컬 축 기준으로 회전 가이드 표시
                controls.enabled = true; // 회전 모드에서는 OrbitControls 활성화
            }
            // === 모드 변경 시 선택된 도형 하이라이트 해제 ===
            if (selectedObject) {
                clearSelectedHighlight(selectedObject);
                selectedObject = null;
                renderObjectListPanel();
            }
            // === 모드 변경 시 스냅/가이드/프리뷰 등 모두 숨기기 ===
            if (typeof snapGuide !== 'undefined' && snapGuide) snapGuide.visible = false;
            if (typeof clearAxisGuideLines === 'function') clearAxisGuideLines();
            if (typeof previewMesh !== 'undefined' && previewMesh) {
                scene.remove(previewMesh);
                previewMesh = null;
            }
            // TransformControls 분리 (모드 변경 시)
            transformControls.detach();

            // 그리기 모드가 아닌 다른 모드로 전환 시 텍스처 선택 해제
            if (!drawingMode && isTexturingMode) {
                const currentlyActive = texturePalette.querySelector('.active');
                if (currentlyActive) {
                    currentlyActive.classList.remove('active');
                }
                selectedTextureSrc = null;
                isTexturingMode = false;
                clearTextureHighlight();
            }
        });
    });
    // 페이지 첫 로딩 시 상태값 동기화
    drawingMode = drawBtn.classList.contains('active');
    moveMode = moveBtn.classList.contains('active');
    rotateMode = rotateBtn.classList.contains('active');
}); 

let selectedFaceIndex = null;
let isDraggingSelected = false;
let dragOffset = new THREE.Vector3();
let dragGroup = []; // 드래그 그룹

function highlightSelected(obj) {
    if (!obj) return;
    if (highlightOverlayMesh) {
        scene.remove(highlightOverlayMesh);
        highlightOverlayMesh = null;
    }
    highlightOverlayMesh = new THREE.Mesh(
        obj.geometry.clone(),
        new THREE.MeshStandardMaterial({
            color: 0x3399ff,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            depthTest: false, // 추가
            side: THREE.DoubleSide
        })
    );
    highlightOverlayMesh.position.copy(obj.position);
    highlightOverlayMesh.rotation.copy(obj.rotation);
    highlightOverlayMesh.scale.copy(obj.scale);
    highlightOverlayMesh.renderOrder = 9999;
    scene.add(highlightOverlayMesh);

    // TransformControls 연결
    if (rotateMode) {
        transformControls.attach(obj);
    }
}

function clearSelectedHighlight(obj) {
    if (highlightOverlayMesh) {
        scene.remove(highlightOverlayMesh);
        highlightOverlayMesh = null;
    }
    clipboard = null;
    // TransformControls 분리
    transformControls.detach();
    controls.enabled = true;
}

renderer.domElement.addEventListener('pointerdown', function(event) {
    if (moveMode && event.button === 0) { // 좌클릭만 허용
        updateMouseAndRaycaster(event);
        const intersects = raycaster.intersectObjects(drawableObjects);
        if (intersects.length > 0) {
            const obj = intersects[0].object;
            const faceIndex = intersects[0].face.materialIndex;
            // 도형 선택
            if (selectedObject && (selectedObject !== obj || selectedFaceIndex !== faceIndex)) {
                clearSelectedHighlight(selectedObject);
            }
            selectedObject = obj;
            selectedFaceIndex = faceIndex;
            highlightSelected(selectedObject);
            // 드래그 준비
            isDraggingSelected = true;
            // 마우스와 오브젝트 중심의 거리 저장
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -selectedObject.position.y);
            raycaster.setFromCamera(mouse, camera);
            const intersect = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(plane, intersect)) {
                dragOffset.copy(selectedObject.position).sub(intersect);
            }
            // 이동 시작 위치 저장 및 그룹 구성
            selectStartPosition = selectedObject.position.clone();
            dragGroup = [selectedObject];
            findStackedObjectsRecursive(selectedObject, dragGroup);
            selectStartPositions = dragGroup.map(obj => obj.position.clone()); // 그룹 전체 위치 저장
            renderObjectListPanel();
        } else {
            // 빈 공간 클릭 시 선택 해제
            if (selectedObject) clearSelectedHighlight(selectedObject);
            selectedObject = null;
            selectedFaceIndex = null;
            selectStartPosition = null;
            renderObjectListPanel();
        }
    } else if (rotateMode && event.button === 0) { // 회전 모드일 때 좌클릭
        if (transformControls.dragging) return; // TransformControls 드래그 중에는 객체 선택 로직 건너뛰기
        updateMouseAndRaycaster(event);
        const intersects = raycaster.intersectObjects(drawableObjects);
        if (intersects.length > 0) {
            const obj = intersects[0].object;
            const faceIndex = intersects[0].face.materialIndex;
            // 도형 선택
            if (selectedObject && (selectedObject !== obj || selectedFaceIndex !== faceIndex)) {
                clearSelectedHighlight(selectedObject);
            }
            selectedObject = obj;
            selectedFaceIndex = faceIndex;
            highlightSelected(selectedObject);
            renderObjectListPanel();
        } else {
            // 빈 공간 클릭 시 선택 해제
            if (selectedObject) clearSelectedHighlight(selectedObject);
            selectedObject = null;
            selectedFaceIndex = null;
            renderObjectListPanel();
        }
    }
});
renderer.domElement.addEventListener('pointermove', function(event) {
    if (moveMode && isDraggingSelected && selectedObject && event.buttons === 1) {
        updateMouseAndRaycaster(event);

        // 1. 드래그 대상 업데이트: 다른 객체 또는 바닥 평면을 기준으로
        let newPos;
        const otherObjects = drawableObjects.filter(obj => !dragGroup.includes(obj)); // 자기 자신과 그룹 멤버 제외
        const intersects = raycaster.intersectObjects(otherObjects);

        if (intersects.length > 0) {
            // 다른 객체 위에 마우스가 있을 경우, 해당 표면을 기준으로 위치 계산
            const intersection = intersects[0];
            const myHeight = selectedObject.geometry.parameters.height * selectedObject.scale.y;
            newPos = intersection.point.clone();
            newPos.y = intersection.object.position.y + (intersection.object.geometry.parameters.height * intersection.object.scale.y) / 2 + myHeight / 2;
        } else {
            // 허공에 있을 경우, 바닥(y=0) 평면을 기준으로 위치 계산
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectPoint = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, intersectPoint)) {
                newPos = intersectPoint.clone();
                newPos.y = (selectedObject.geometry.parameters.height * selectedObject.scale.y) / 2; // Ensure object is on top of the ground
                newPos.x += dragOffset.x; // Apply x offset
                newPos.z += dragOffset.z; // Apply z offset
            } else {
                return; // 교차점이 없으면 이동하지 않음
            }
        }

        // 2. 스냅 로직 적용
        clearSelectSnapGuideLines();
        const snapThreshold = 0.1;
        const myWidth = selectedObject.geometry.parameters.width * selectedObject.scale.x;
        const myDepth = selectedObject.geometry.parameters.depth * selectedObject.scale.z;
        const myX = [newPos.x, newPos.x - myWidth/2, newPos.x + myWidth/2];
        const myZ = [newPos.z, newPos.z - myDepth/2, newPos.z + myDepth/2];
        let snapX = newPos.x;
        let snapZ = newPos.z;
        let snappedX = false, snappedZ = false;

        otherObjects.forEach(obj => {
            const objWidth = obj.geometry.parameters.width * obj.scale.x;
            const objDepth = obj.geometry.parameters.depth * obj.scale.z;
            const objX = [obj.position.x, obj.position.x - objWidth/2, obj.position.x + objWidth/2];
            const objZ = [obj.position.z, obj.position.z - objDepth/2, obj.position.z + objDepth/2];
            myX.forEach(mx => {
                objX.forEach(ox => {
                    if (Math.abs(mx - ox) < snapThreshold) {
                        snapX = newPos.x + (ox - mx);
                        snappedX = true;
                        showSelectSnapGuideLine('x', ox, obj.position.z, objDepth);
                    }
                });
            });
            myZ.forEach(mz => {
                objZ.forEach(oz => {
                    if (Math.abs(mz - oz) < snapThreshold) {
                        snapZ = newPos.z + (oz - mz);
                        snappedZ = true;
                        showSelectSnapGuideLine('z', oz, obj.position.x, objWidth);
                    }
                });
            });
        });

        if (snappedX) newPos.x = snapX;
        if (snappedZ) newPos.z = snapZ;

        // 3. 그룹 전체 이동 적용
        const moveDelta = newPos.clone().sub(selectedObject.position);
        dragGroup.forEach(obj => {
            obj.position.add(moveDelta);
        });

    } else {
        clearSelectSnapGuideLines();
    }
});
renderer.domElement.addEventListener('pointerup', function(event) {
    if (moveMode && isDraggingSelected && selectedObject) {
        isDraggingSelected = false;
        // 드래그가 끝나면 현재 머티리얼을 다시 저장
        if (selectedObject) {
            selectedObject.userData._origMaterial = selectedObject.material.map(m => m.clone());
        }
        // 이동 종료 위치 저장 및 그룹 Undo/Redo 기록
        let selectEndPositions = dragGroup.map(obj => obj.position.clone());
        if (selectStartPositions.length > 0 && !selectStartPositions[0].equals(selectEndPositions[0])) {
            history.execute(new SelectGroupCommand(dragGroup, selectStartPositions, selectEndPositions));
        }
        dragGroup = [];
        selectStartPosition = null;
        selectStartPositions = [];
    }
});
window.addEventListener('keydown', function(event) {
    if (moveMode && selectedObject && (event.key === 'Delete' || event.key === 'Backspace')) {
        clearSelectedHighlight(selectedObject);
        scene.remove(selectedObject);
        const idx = drawableObjects.indexOf(selectedObject);
        if (idx !== -1) drawableObjects.splice(idx, 1);
        selectedObject = null;
        selectedFaceIndex = null;
    }
}); 

// === 선택 도구(이동)에서 ESC키로 그리기 모드 복귀 ===
window.addEventListener('keydown', function(event) {
    // 입력 필드에 있을 때는 작동하지 않도록
    if (event.target.tagName && (event.target.tagName.toUpperCase() === 'INPUT' || event.target.tagName.toUpperCase() === 'TEXTAREA')) {
        return;
    }
    // ESC키: 모달이 열려 있으면 닫고, 아니면 그리기 모드로 복귀
    if (event.key === 'Escape') {
        const helpGuideModal = document.getElementById('help-guide-modal');
        if (helpGuideModal && helpGuideModal.style.display === 'block') {
            helpGuideModal.style.display = 'none';
            return; // 모달을 닫았으면 다른 동작은 하지 않음
        }

        drawingMode = true;
        moveMode = false;
        rotateMode = false;
        // 툴바 UI 동기화
        const toolBtns = Array.from(document.querySelectorAll('#toolbar-vertical .tool-btn'));
        const moveBtn = document.getElementById('tool-select');
        const rotateBtn = document.getElementById('tool-refresh');
        const drawBtn = document.getElementById('tool-scale');
        toolBtns.forEach(b => b.classList.remove('active'));
        if (drawBtn) drawBtn.classList.add('active');
        // 선택된 도형 선택 해제 및 색상 복원
        if (selectedObject) {
            clearSelectedHighlight(selectedObject);
            selectedObject = null;
            renderObjectListPanel();
            selectedFaceIndex = null;
        }
        clipboard = null;
        // === 스냅/가이드/프리뷰 등 모두 숨기기 ===
        if (typeof snapGuide !== 'undefined' && snapGuide) snapGuide.visible = false;
        if (typeof clearAxisGuideLines === 'function') clearAxisGuideLines();
        if (typeof previewMesh !== 'undefined' && previewMesh) {
            scene.remove(previewMesh);
            previewMesh = null;
        }
        hideContextMenu();
    }
}); 

// 이동(드래그) 중 스냅 가이드 라인 변수 추가
let selectSnapGuideLines = [];

function clearSelectSnapGuideLines() {
    selectSnapGuideLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
    });
    selectSnapGuideLines = [];
}

function showSelectSnapGuideLine(axis, position, centerPos, size) {
    let geometry, guideLine;
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xff00ff, 
        transparent: true, 
        opacity: 0.7 
    });
    if (axis === 'x') {
        geometry = new THREE.PlaneGeometry(0.05, size + 2);
        guideLine = new THREE.Mesh(geometry, material);
        guideLine.rotation.x = -Math.PI / 2;
        guideLine.position.set(position, 0.02, centerPos);
    } else { // z축
        geometry = new THREE.PlaneGeometry(size + 2, 0.05);
        guideLine = new THREE.Mesh(geometry, material);
        guideLine.rotation.x = -Math.PI / 2;
        guideLine.position.set(centerPos, 0.02, position);
    }
    scene.add(guideLine);
    selectSnapGuideLines.push(guideLine);
}

// 이동(드래그) Undo/Redo를 위한 위치 저장 변수
let selectStartPosition = null;
let selectStartPositions = []; // 그룹 이동용

function stickStackedObjects(baseObj, visitedSet = new Set()) {
    if (visitedSet.has(baseObj)) return;
    visitedSet.add(baseObj);
    const myWidth = baseObj.geometry.parameters.width * baseObj.scale.x;
    const myDepth = baseObj.geometry.parameters.depth * baseObj.scale.z;
    const myMinX = baseObj.position.x - myWidth/2;
    const myMaxX = baseObj.position.x + myWidth/2;
    const myMinZ = baseObj.position.z - myDepth/2;
    const myMaxZ = baseObj.position.z + myDepth/2;
    const myTop = baseObj.position.y + (baseObj.geometry.parameters.height * baseObj.scale.y) / 2;

    drawableObjects.forEach(obj => {
        if (obj === baseObj || !obj || !obj.geometry) return;
        const objWidth = obj.geometry.parameters.width * obj.scale.x;
        const objDepth = obj.geometry.parameters.depth * obj.scale.z;
        const objMinX = obj.position.x - objWidth/2;
        const objMaxX = obj.position.x + objWidth/2;
        const objMinZ = obj.position.z - objDepth/2;
        const objMaxZ = obj.position.z + objDepth/2;
        // xz축 겹침
        const overlapX = Math.max(0, Math.min(objMaxX, myMaxX) - Math.max(objMinX, myMinX));
        const overlapZ = Math.max(0, Math.min(objMaxZ, myMaxZ) - Math.max(objMinZ, myMinZ));
        const overlapRatioX = overlapX / Math.min(objWidth, myWidth);
        const overlapRatioZ = overlapZ / Math.min(objDepth, myDepth);
        // obj가 baseObj 위에 있는지(바닥이 baseObj의 top과 거의 같음)
        const objHeight = obj.geometry.parameters.height * obj.scale.y;
        const objBottom = obj.position.y - objHeight / 2;
        if (overlapRatioX > 0.1 && overlapRatioZ > 0.1 && Math.abs(objBottom - myTop) < 0.15) {
            obj.position.y = myTop + objHeight / 2;
            stickStackedObjects(obj, visitedSet); // 위에 또 얹힌 도형도 반복
        }
    });
}

// === 복사/붙여넣기용 clipboard ===
let clipboard = null;
function deepCloneMesh(mesh) {
    // geometry 복제
    const geometry = mesh.geometry.clone();
    // material 복제 (배열/단일 모두 지원)
    let material;
    if (Array.isArray(mesh.material)) {
        material = mesh.material.map(m => m.clone());
    } else {
        material = mesh.material.clone();
    }
    // mesh 복제
    const clone = new THREE.Mesh(geometry, material);
    clone.position.copy(mesh.position);
    clone.rotation.copy(mesh.rotation);
    clone.scale.copy(mesh.scale);
    // userData 등 추가 속성 복사(필요시)
    clone.userData = JSON.parse(JSON.stringify(mesh.userData));
    setShadowProps(clone);
    return clone;
}
window.addEventListener('keydown', function(event) {
    // 입력 필드에 있을 때는 작동하지 않도록
    if (event.target.tagName && (event.target.tagName.toUpperCase() === 'INPUT' || event.target.tagName.toUpperCase() === 'TEXTAREA')) {
        return;
    }
    // ctrl+c: 복사
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedObject) {
            clipboard = selectedObject;
        }
    }
    // ctrl+v: 붙여넣기
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (clipboard) {
            selectedObject = null; // 먼저 해제
            const newObj = deepCloneMesh(clipboard);
            // AddObjectCommand로 history에 추가
            const command = new AddObjectCommand(scene, newObj, drawableObjects);
            history.execute(command);
        }
    }
});

function setShadowProps(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (Array.isArray(mesh.children)) {
        mesh.children.forEach(setShadowProps);
    }
}

// === 조명 on/off 및 조이스틱 UI ===
const lightToggle = document.getElementById('light-toggle');
const lightToggleLabel = document.getElementById('light-toggle-label');
const lightJoystick = document.getElementById('light-joystick');
const shadowGroundMesh = typeof shadowGround !== 'undefined' ? shadowGround : null;

function setLightUIState(on) {
    directionalLight.visible = on;
    if (shadowGroundMesh) shadowGroundMesh.visible = on;
    renderer.shadowMap.enabled = on;
    // === hemisphere light 연동 ===
    hemisphereLight.visible = !on;
    if (on) {
        lightToggleLabel.textContent = '조명 ON';
        lightJoystick.classList.remove('disabled');
    } else {
        lightToggleLabel.textContent = '조명 OFF';
        lightJoystick.classList.add('disabled');
    }
}
if (lightToggle) {
    lightToggle.addEventListener('change', function() {
        setLightUIState(lightToggle.checked);
    });
    // 초기 상태 동기화
    setLightUIState(lightToggle.checked);
}
// === 조이스틱 ===
let joystickDragging = false;
let joystickCenter = { x: 45, y: 45 };
let joystickRadius = 40;
let joystickKnobRadius = 13;
// directionalLight의 x/z 위치를 [-max, max] 범위로 매핑
const lightMaxXZ = 15;
function drawJoystick() {
    const ctx = lightJoystick.getContext('2d');
    ctx.clearRect(0, 0, 90, 90);
    // 배경 원
    ctx.beginPath();
    ctx.arc(joystickCenter.x, joystickCenter.y, joystickRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f6fa';
    ctx.fill();
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    ctx.stroke();
    // crosshair
    ctx.beginPath();
    ctx.moveTo(joystickCenter.x - joystickRadius + 8, joystickCenter.y);
    ctx.lineTo(joystickCenter.x + joystickRadius - 8, joystickCenter.y);
    ctx.moveTo(joystickCenter.x, joystickCenter.y - joystickRadius + 8);
    ctx.lineTo(joystickCenter.x, joystickCenter.y + joystickRadius - 8);
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 조작점 위치 계산
    let lx = directionalLight.position.x;
    let lz = directionalLight.position.z;
    let knobX = joystickCenter.x + (lx / lightMaxXZ) * (joystickRadius - 13);
    let knobY = joystickCenter.y + (lz / lightMaxXZ) * (joystickRadius - 13);
    // 조작점
    ctx.beginPath();
    ctx.arc(knobX, knobY, joystickKnobRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#FFC107'; // 따뜻한 노란색
    // === 수정: lightToggle이 없으면 directionalLight.visible로 판단 ===
    const isLightOn = (typeof lightToggle !== 'undefined' && lightToggle) ? lightToggle.checked : directionalLight.visible;
    ctx.globalAlpha = isLightOn ? 1 : 0.5;
    ctx.shadowColor = '#FFC107'; // 그림자 색상도 변경
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 손전등 느낌의 원뿔형 빛 (노브에서 중앙으로 향함)
    let beamDirX = joystickCenter.x - knobX; // 노브에서 중앙으로 향하는 벡터
    let beamDirY = joystickCenter.y - knobY;
    let beamDirLength = Math.sqrt(beamDirX * beamDirX + beamDirY * beamDirY);

    if (beamDirLength > 0) {
        beamDirX /= beamDirLength; // 정규화
        beamDirY /= beamDirLength;

        const perpBeamDirX = -beamDirY; // 수직 벡터
        const perpBeamDirY = beamDirX;

        const beamStartWidth = joystickKnobRadius * 0.6; // 노브에서의 빛 시작 너비
        const beamEndLength = joystickKnobRadius * 2.5; // 빛이 뻗어나가는 길이 (원래대로)
        const beamEndWidth = joystickKnobRadius * 1.5; // 빛의 끝 너비

        // 빛의 시작점 (노브 가장자리에서 더 바깥쪽으로)
        const p1x = knobX + perpBeamDirX * beamStartWidth + beamDirX * (joystickKnobRadius * 0.5);
        const p1y = knobY + perpBeamDirY * beamStartWidth + beamDirY * (joystickKnobRadius * 0.5);
        const p2x = knobX - perpBeamDirX * beamStartWidth + beamDirX * (joystickKnobRadius * 0.5);
        const p2y = knobY - perpBeamDirY * beamStartWidth + beamDirY * (joystickKnobRadius * 0.5);

        // 빛의 끝점 (중앙 방향으로 뻗어나감)
        const p3x = knobX + beamDirX * beamEndLength + perpBeamDirX * beamEndWidth;
        const p3y = knobY + beamDirY * beamEndLength + perpBeamDirY * beamEndWidth;
        const p4x = knobX + beamDirX * beamEndLength - perpBeamDirX * beamEndWidth;
        const p4y = knobY + beamDirY * beamEndLength - perpBeamDirY * beamEndWidth;

        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p3x, p3y);
        ctx.lineTo(p4x, p4y);
        ctx.lineTo(p2x, p2y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 150, 0.5)'; // 더 밝은 노란색, 투명도 유지
        ctx.fill();
    }
}
if (lightJoystick) {
    drawJoystick();
    let dragging = false;
    let dragOffset = { x: 0, y: 0 };
    function getJoystickPos(e) {
        const rect = lightJoystick.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
        return { x, y };
    }
    function updateLightFromJoystick(x, y) {
        // 중심에서의 상대 좌표를 [-1,1]로 변환 후 lightMaxXZ로 매핑
        let dx = x - joystickCenter.x;
        let dy = y - joystickCenter.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > joystickRadius - 13) {
            dx *= (joystickRadius - 13) / dist;
            dy *= (joystickRadius - 13) / dist;
        }
        // x축: 오른쪽이 +, z축: 아래가 +
        let lx = (dx / (joystickRadius - 13)) * lightMaxXZ;
        let lz = (dy / (joystickRadius - 13)) * lightMaxXZ;
        directionalLight.position.x = lx;
        directionalLight.position.z = lz;
        drawJoystick();
    }
    lightJoystick.addEventListener('mousedown', function(e) {
        // === 수정: lightToggle이 없으면 directionalLight.visible로 판단 ===
        const isLightOn = (typeof lightToggle !== 'undefined' && lightToggle) ? lightToggle.checked : directionalLight.visible;
        if (!isLightOn) return;
        dragging = true;
        const pos = getJoystickPos(e);
        updateLightFromJoystick(pos.x, pos.y);
    });
    lightJoystick.addEventListener('touchstart', function(e) {
        const isLightOn = (typeof lightToggle !== 'undefined' && lightToggle) ? lightToggle.checked : directionalLight.visible;
        if (!isLightOn) return;
        dragging = true;
        const pos = getJoystickPos(e);
        updateLightFromJoystick(pos.x, pos.y);
    });
    window.addEventListener('mousemove', function(e) {
        const isLightOn = (typeof lightToggle !== 'undefined' && lightToggle) ? lightToggle.checked : directionalLight.visible;
        if (!dragging) return;
        if (!isLightOn) return;
        const pos = getJoystickPos(e);
        updateLightFromJoystick(pos.x, pos.y);
    });
    window.addEventListener('touchmove', function(e) {
        const isLightOn = (typeof lightToggle !== 'undefined' && lightToggle) ? lightToggle.checked : directionalLight.visible;
        if (!dragging) return;
        if (!isLightOn) return;
        const pos = getJoystickPos(e);
        updateLightFromJoystick(pos.x, pos.y);
    });
    window.addEventListener('mouseup', function(e) {
        dragging = false;
    });
    window.addEventListener('touchend', function(e) {
        dragging = false;
    });
    // 그림자 on/off 시 UI 동기화
    if (typeof lightToggle !== 'undefined' && lightToggle) {
        lightToggle.addEventListener('change', drawJoystick);
    }
}
// directionalLight 위치가 바뀌면 매 프레임 drawJoystick으로 UI 동기화
let lastLightX = directionalLight.position.x, lastLightZ = directionalLight.position.z;
function syncJoystickToLight() {
    if (directionalLight.position.x !== lastLightX || directionalLight.position.z !== lastLightZ) {
        drawJoystick();
        lastLightX = directionalLight.position.x;
        lastLightZ = directionalLight.position.z;
    }
    requestAnimationFrame(syncJoystickToLight);
}
syncJoystickToLight();

// === light-panel 위치를 axis-orbit 위쪽(캔버스 우하단)으로 동적으로 유지 ===
function updateLightPanelPosition() {
    const cWrapper = document.getElementById('c-wrapper');
    const axisOrbit = document.getElementById('axis-orbit');
    const lightPanel = document.getElementById('light-panel');
    if (!cWrapper || !axisOrbit || !lightPanel) return;
    // cWrapper 기준 상대 위치 계산
    const wrapperRect = cWrapper.getBoundingClientRect();
    const axisRect = axisOrbit.getBoundingClientRect();
    // axis-orbit의 위쪽에, 오른쪽 정렬
    const offsetRight = wrapperRect.right - axisRect.right + 8; // 8px 여유
    const offsetBottom = wrapperRect.bottom - axisRect.top + 12; // 12px 여유
    lightPanel.style.right = offsetRight + 'px';
    lightPanel.style.bottom = offsetBottom + 'px';
}
window.addEventListener('resize', updateLightPanelPosition);
window.addEventListener('DOMContentLoaded', updateLightPanelPosition);
setTimeout(updateLightPanelPosition, 200); // 초기 렌더 후 보정
// axis-orbit 크기 변동(반응형)에도 대응
const axisOrbit = document.getElementById('axis-orbit');
if (axisOrbit) {
    new ResizeObserver(updateLightPanelPosition).observe(axisOrbit);
}

// === '조명 보기' 드롭다운 메뉴와 조이스틱 UI 연동 ===
const toggleLightMenu = document.getElementById('toggle-light');
function setLightMenuState(on) {
    directionalLight.visible = on;
    if (typeof shadowGround !== 'undefined') shadowGround.visible = on;
    renderer.shadowMap.enabled = on;
    // === hemisphere light 연동 ===
    hemisphereLight.visible = !on;
    if (on) {
        lightJoystick.classList.remove('disabled');
        toggleLightMenu.querySelector('.check').textContent = '✓';
    } else {
        lightJoystick.classList.add('disabled');
        toggleLightMenu.querySelector('.check').textContent = '';
    }
}
if (toggleLightMenu) {
    toggleLightMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOn = !toggleLightMenu.querySelector('.check').textContent;
        setLightMenuState(isOn);
    });
    // 초기 상태 동기화
    setLightMenuState(true);
}

// === 페이지 이탈 방지 ===
window.addEventListener('beforeunload', (event) => {
    // 캔버스에 그려진 객체가 하나라도 있으면
    if (drawableObjects.length > 0) {
        // 표준에 따라, 기본 동작을 막고 메시지를 반환하여
        // 브라우저가 사용자에게 확인 대화상자를 표시하도록 함
        event.preventDefault();
        // 대부분의 최신 브라우저는 이 커스텀 메시지를 표시하지 않지만,
        // 호환성을 위해 설정하는 것이 좋음
        event.returnValue = '작업한 내용이 저장되지 않을 수 있습니다. 정말로 나가시겠습니까?';
    }
});

// === 객체 목록 패널 동적 렌더링 ===
function renderObjectListPanel() {
    const panel = document.getElementById('object-list-panel');
    if (!panel) return;
    // 패널 초기화
    panel.innerHTML = '<div style="font-weight:bold;font-size:18px;padding:0 18px 12px 18px;">객체 목록</div>';
    if (drawableObjects.length === 0) {
        panel.innerHTML += '<div style="padding:18px;color:#888;">생성된 객체가 없습니다.</div>';
        return;
    }
    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0 0 0 0';
    list.style.margin = '0';
    drawableObjects.forEach((obj, idx) => {
        const li = document.createElement('li');
        li.className = 'object-list-item';
        li.style.padding = '10px 18px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #f0f0f0';
        li.style.transition = 'background 0.15s';
        // 이름 또는 번호
        let label = obj.userData && obj.userData.name ? obj.userData.name : `객체 ${idx+1}`;
        // 크기 정보
        let w = (obj.geometry.parameters.width * obj.scale.x).toFixed(2);
        let h = (obj.geometry.parameters.height * obj.scale.y).toFixed(2);
        let d = (obj.geometry.parameters.depth * obj.scale.z).toFixed(2);
        li.innerHTML = `<b>${label}</b><br><span style='font-size:13px;color:#888;'>크기: ${w} × ${d} × ${h}</span>`;

        // --- 마우스 오버/아웃 하이라이트 ---
        li.addEventListener('mouseenter', () => {
            if (!obj.userData._origMaterialColors) {
                // 원래 색상 저장
                obj.userData._origMaterialColors = obj.material.map(m => m.color.clone());
            }
            obj.material.forEach(m => {
                m.color.set(0xffe066); // 밝은 노란색
                m.needsUpdate = true;
            });
        });
        li.addEventListener('mouseleave', () => {
            if (obj.userData._origMaterialColors) {
                obj.material.forEach((m, i) => {
                    m.color.copy(obj.userData._origMaterialColors[i]);
                    m.needsUpdate = true;
                });
                delete obj.userData._origMaterialColors;
            }
        });
        // --- 끝 ---

        // 활성화 표시 및 스크롤 포커스
        if (selectedObject && selectedObject.uuid === obj.uuid) {
            li.classList.add('active');
            setTimeout(() => { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 0);
        }
        // --- 클릭 시 선택 동기화 ---
        li.addEventListener('click', () => {
            if (selectedObject && selectedObject.uuid === obj.uuid) {
                // 이미 선택된 항목을 다시 클릭하면 선택 해제
                clearSelectedHighlight(selectedObject);
                selectedObject = null;
                renderObjectListPanel();
                return;
            }
            if (selectedObject && selectedObject.uuid !== obj.uuid) {
                clearSelectedHighlight(selectedObject);
            }
            selectedObject = obj;
            highlightSelected(selectedObject);
            renderObjectListPanel(); // 목록 활성화 갱신
            // === 카메라 이동(포커스) 기능 추가 ===
            // 현재 카메라와 타겟의 상대 벡터
            const camToTarget = camera.position.clone().sub(controls.target);
            // 선택 객체를 중심으로 동일한 상대 벡터를 적용
            cameraTargetPos = obj.position.clone().add(camToTarget);
            cameraTargetLook = obj.position.clone();
            isCameraAnimating = true;
        });
        // --- 끝 ---

        list.appendChild(li);
    });
    panel.appendChild(list);
}
// 객체 추가/삭제/undo/redo 시 자동 갱신
function setupObjectListPanelAutoUpdate() {
    // history.execute, undo, redo 후에 renderObjectListPanel 호출
    const origExecute = history.execute.bind(history);
    history.execute = function(cmd) {
        origExecute(cmd);
        renderObjectListPanel();
    };
    const origUndo = history.undo.bind(history);
    history.undo = function() {
        origUndo();
        renderObjectListPanel();
    };
    const origRedo = history.redo.bind(history);
    history.redo = function() {
        origRedo();
        renderObjectListPanel();
    };
}
window.addEventListener('DOMContentLoaded', () => {
    renderObjectListPanel();
    setupObjectListPanelAutoUpdate();
    // Initial setup for object list panel visibility and icon
    const objectListToggle = document.getElementById('object-list-toggle');
    const objectListPanel = document.getElementById('object-list-panel');
    if (objectListToggle && objectListPanel) {
        // Set initial icon
        objectListToggle.innerHTML = "<span data-feather='menu'></span>";
        if (window.feather) window.feather.replace();
        // Add click listener to the toggle button
        objectListToggle.addEventListener('click', toggleObjectListPanel);
    }
});

// Helper function to toggle object list panel
function toggleObjectListPanel() {
    const objectListToggle = document.getElementById('object-list-toggle');
    const objectListPanel = document.getElementById('object-list-panel');
    if (!objectListToggle || !objectListPanel) return;

    function setHamburgerIcon(isMenu) {
        objectListToggle.innerHTML = isMenu ? "<span data-feather='menu'></span>" : "<span data-feather='x'></span>";
        if (window.feather) window.feather.replace();
    }

    if (objectListPanel.classList.contains('show')) {
        objectListPanel.classList.remove('show');
        objectListPanel.classList.add('hide');
        setHamburgerIcon(true);
        objectListPanel.addEventListener('animationend', function handler(e) {
            if (e.animationName === 'slideOutLeft') {
                objectListPanel.style.display = 'none';
                objectListPanel.classList.remove('hide');
            }
            objectListPanel.removeEventListener('animationend', handler);
        }, { once: true });
    } else {
        objectListPanel.style.display = 'block';
        objectListPanel.classList.remove('hide');
        objectListPanel.classList.add('show');
        setHamburgerIcon(false);
        renderObjectListPanel();
    }
}