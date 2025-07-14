import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

// 1. 기본 설정
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeeeee);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// controls 생성 전에는 camera만 초기화

const controls = new OrbitControls(camera, renderer.domElement);
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

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// 3. 그리기 환경 설정
const gridHelper = new THREE.GridHelper(100, 100);
scene.add(gridHelper);
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
let lastMouseX = 0;      // x축 드래그 시작 마우스 위치
let extrudeXFaceSign = 1; // x축 extrude 시 클릭한 면 방향 (+1: 오른쪽, -1: 왼쪽)
let extrudeXFaceNormal = new THREE.Vector3(1, 0, 0); // extrude 시작 시 클릭한 면 normal(월드좌표)
let extrudeXFixedX = 0; // x축 extrude 시 고정되는 반대쪽 면의 x좌표
let extrudeXStartX = 0; // 클릭한 면의 드래그 시작 x좌표
let extrudeXTotalDelta = 0; // 누적 마우스 이동량
let extrudeXStartScreenX = 0; // 클릭한 면의 드래그 시작 화면 x좌표
let extrudeXNormalScreenX = 1; // 클릭한 면 normal의 화면 투영 x성분
let extrudeXScreenAxis = 'x'; // extrude 방향(스크린 x/y)
let extrudeXStartScreen = 0; // extrude 시작 시 마우스 스크린 좌표(x 또는 y)

let isExtrudingZ = false;
let lastMouseZ = 0;
let extrudeZFaceSign = 1;
let extrudeZFaceNormal = new THREE.Vector3(0, 0, 1);
let extrudeZFixedZ = 0;
let extrudeZStartZ = 0;
let extrudeZScreenAxis = 'y';
let extrudeZStartScreen = 0;

// 텍스처링 상태 관련 변수
let isTexturingMode = false;
const textureHighlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide });
let highlightedFaceInfo = {
    object: null,
    faceIndex: -1,
    originalMaterial: null
};

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
        }
    }
});

// 5. Raycaster 및 이벤트 리스너 설정
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const mouseDownPos = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
renderer.domElement.addEventListener('pointermove', onPointerMove, false);
renderer.domElement.addEventListener('pointerup', onPointerUp, false);
renderer.domElement.addEventListener('click', onCanvasClick, false);
renderer.domElement.addEventListener('contextmenu', onRightClick, false);

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

// --- Undo/Redo 리스너 ---
window.addEventListener('keydown', (event) => {
    // 입력 필드에 있을 때는 작동하지 않도록
    if (event.target.tagName.toUpperCase() === 'INPUT' || event.target.tagName.toUpperCase() === 'TEXTAREA') {
        return;
    }

    if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
            event.preventDefault();
            history.undo();
        } else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            history.redo();
        }
    }
});

function onCanvasClick(event) {
    const dragDistance = mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    if (dragDistance > 5 || !isTexturingMode || !selectedTextureSrc) return;

    // 하이라이트 복원 후 텍스처 적용
    const highlightedInfoBeforeClick = { ...highlightedFaceInfo };
    clearTextureHighlight();

    const intersects = raycaster.intersectObjects(drawableObjects);

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const intersectedObject = intersection.object;
        const materialIndex = intersection.face.materialIndex;
        const oldMaterial = intersectedObject.material[materialIndex];

        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(selectedTextureSrc, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(1, 1);
            
            const newMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                side: THREE.DoubleSide
            });
            
            // TextureCommand 사용
            const command = new TextureCommand(intersectedObject, materialIndex, oldMaterial, newMaterial);
            history.execute(command);
        });
    }
}

// 컨텍스트 메뉴 관련 변수
let contextMenu = null;
let contextMenuTarget = null;

function onRightClick(event) {
    event.preventDefault(); // 기본 컨텍스트 메뉴 방지
    
    // 기존 컨텍스트 메뉴 숨김
    hideContextMenu();
    
    // 마우스 위치 업데이트
    updateMouseAndRaycaster(event);
    const intersects = raycaster.intersectObjects(drawableObjects);
    
    if (intersects.length > 0) {
        const targetObject = intersects[0].object;
        
        // 돌출 중인 객체는 컨텍스트 메뉴 표시 안함
        if (isExtruding && extrudeTarget === targetObject) {
            return;
        }
        
        // 컨텍스트 메뉴 표시
        showContextMenu(event.clientX, event.clientY, targetObject);
    }
}

function showContextMenu(x, y, targetObject) {
    if (!contextMenu) {
        contextMenu = document.getElementById('context-menu');
        
        // 삭제 버튼 클릭 이벤트
        const deleteButton = document.getElementById('delete-object');
        deleteButton.addEventListener('click', () => {
            if (contextMenuTarget) {
                deleteObject(contextMenuTarget);
                hideContextMenu();
            }
        });
        
        // 외부 클릭 시 메뉴 숨김
        document.addEventListener('click', (event) => {
            if (!contextMenu.contains(event.target)) {
                hideContextMenu();
            }
        });
    }
    
    contextMenuTarget = targetObject;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        contextMenuTarget = null;
    }
}

function deleteObject(objectToDelete) {
    // 객체를 배열에서 제거
    const index = drawableObjects.indexOf(objectToDelete);
    if (index > -1) {
        drawableObjects.splice(index, 1);
    }
    
    // 씬에서 제거
    scene.remove(objectToDelete);
    
    // 메모리 정리
    objectToDelete.geometry.dispose();
    if (Array.isArray(objectToDelete.material)) {
        objectToDelete.material.forEach(material => material.dispose());
    } else {
        objectToDelete.material.dispose();
    }
    
    // 하이라이트 메시가 삭제된 객체를 참조하고 있다면 숨김
    if (highlightMesh) {
        highlightMesh.visible = false;
    }
    
    // 텍스처 하이라이트도 정리
    clearTextureHighlight();
    
    // 꼭짓점 목록 업데이트
    updateAllVertices();
}

let oldTransformData = null; // 돌출 시작 시점의 상태 저장용

// extrude 시작 시 extrudeBaseY 저장
let extrudeBaseY = null;
function onPointerDown(event) {
    if (event.button !== 0) return;
    // drawingMode가 아닐 때는 바닥 그리기 동작 금지
    if (!drawingMode) return;
    
    clearTextureHighlight();
    mouseDownPos.set(event.clientX, event.clientY);
    updateMouseAndRaycaster(event);
    const intersects = raycaster.intersectObjects(drawableObjects);

    // 1. 윗면(y축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && intersects[0].face.normal.y > 0.99) {
        isExtruding = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;
        lastMouseY = event.clientY;
        // extrude 시작 전 상태 저장
        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };
        // extrude 시작 시 바닥 위치 저장
        const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        extrudeBaseY = extrudeTarget.position.y - height/2;
        highlightMesh.visible = false;
        return;
    }
    // 1-2. 옆면(x축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && Math.abs(intersects[0].face.normal.x) > 0.99) {
        isExtrudingX = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;
        lastMouseX = event.clientX;
        extrudeXFaceSign = intersects[0].face.normal.x > 0 ? 1 : -1; // 클릭한 면 방향 저장
        extrudeXFaceNormal = intersects[0].face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(extrudeTarget.matrixWorld)).normalize(); // 월드좌표 normal 저장
        // 드래그 시작 시 반대쪽 면의 x좌표 저장
        const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        if (extrudeXFaceSign > 0) {
            // 오른쪽면 클릭: 왼쪽면 고정
            extrudeXFixedX = extrudeTarget.position.x - width / 2;
            extrudeXStartX = extrudeTarget.position.x + width / 2; // 오른쪽면 x좌표
        } else {
            // 왼쪽면 클릭: 오른쪽면 고정
            extrudeXFixedX = extrudeTarget.position.x + width / 2;
            extrudeXStartX = extrudeTarget.position.x - width / 2; // 왼쪽면 x좌표
        }
        extrudeXTotalDelta = 0;
        // 클릭한 면의 3D 위치를 화면 좌표로 변환
        const worldPos = new THREE.Vector3(extrudeXStartX, extrudeTarget.position.y, extrudeTarget.position.z);
        const screenPos = worldPos.clone().project(camera);
        extrudeXStartScreenX = screenPos.x;
        // 클릭한 면 normal을 화면 좌표계로 투영
        const normalEnd = worldPos.clone().add(extrudeXFaceNormal);
        const normalScreen = normalEnd.project(camera).sub(screenPos).normalize();
        extrudeXNormalScreenX = normalScreen.x;
        // --- 개선: extrude 방향 자동 선택 ---
        if (Math.abs(normalScreen.x) >= Math.abs(normalScreen.y)) {
            extrudeXScreenAxis = 'x';
            extrudeXStartScreen = ((event.clientX - renderer.domElement.getBoundingClientRect().left) / renderer.domElement.width) * 2 - 1;
        } else {
            extrudeXScreenAxis = 'y';
            extrudeXStartScreen = -((event.clientY - renderer.domElement.getBoundingClientRect().top) / renderer.domElement.height) * 2 + 1;
        }
        // extrude 시작 전 상태 저장
        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };
        highlightMesh.visible = false;
        return;
    }
    // 1-3. 앞/뒤면(z축) extrude
    if (highlightMesh && highlightMesh.visible && intersects.length > 0 && Math.abs(intersects[0].face.normal.z) > 0.99) {
        isExtrudingZ = true;
        controls.enabled = false;
        extrudeTarget = intersects[0].object;
        lastMouseZ = event.clientY;
        extrudeZFaceSign = intersects[0].face.normal.z > 0 ? 1 : -1;
        extrudeZFaceNormal = intersects[0].face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(extrudeTarget.matrixWorld)).normalize();
        // 드래그 시작 시 반대쪽 면의 z좌표 저장
        const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        if (extrudeZFaceSign > 0) {
            // 앞면 클릭: 뒷면 고정
            extrudeZFixedZ = extrudeTarget.position.z - depth / 2;
            extrudeZStartZ = extrudeTarget.position.z + depth / 2; // 앞면 z좌표
        } else {
            // 뒷면 클릭: 앞면 고정
            extrudeZFixedZ = extrudeTarget.position.z + depth / 2;
            extrudeZStartZ = extrudeTarget.position.z - depth / 2; // 뒷면 z좌표
        }
        // 클릭한 면의 3D 위치를 화면 좌표로 변환
        const worldPos = new THREE.Vector3(extrudeTarget.position.x, extrudeTarget.position.y, extrudeZStartZ);
        const screenPos = worldPos.clone().project(camera);
        // 클릭한 면 normal을 화면 좌표계로 투영
        const normalEnd = worldPos.clone().add(extrudeZFaceNormal);
        const normalScreen = normalEnd.project(camera).sub(screenPos).normalize();
        // --- 개선: extrude 방향 자동 선택 ---
        if (Math.abs(normalScreen.y) >= Math.abs(normalScreen.x)) {
            extrudeZScreenAxis = 'y';
            extrudeZStartScreen = -((event.clientY - renderer.domElement.getBoundingClientRect().top) / renderer.domElement.height) * 2 + 1;
        } else {
            extrudeZScreenAxis = 'x';
            extrudeZStartScreen = ((event.clientX - renderer.domElement.getBoundingClientRect().left) / renderer.domElement.width) * 2 - 1;
        }
        oldTransformData = {
            geometry: extrudeTarget.geometry.clone(),
            position: extrudeTarget.position.clone(),
            scale: extrudeTarget.scale.clone()
        };
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
        // === y축 extrude + 면-면 스냅 (스냅이 걸리면 실제로 딱 맞게 붙임) ===
        const deltaY = event.clientY - lastMouseY;
        const oldHeight = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        let newHeight = Math.max(0.1, oldHeight - deltaY * 0.05);
        let snapMin = 0.18;
        let myTop = extrudeBaseY + newHeight;
        let snapTargetY = null;
        let minDist = snapMin;
        drawableObjects.forEach(obj => {
            if (obj === extrudeTarget) return;
            const objHeight = obj.geometry.parameters.height * obj.scale.y;
            const objTop = obj.position.y + objHeight / 2;
            if (Math.abs(myTop - objTop) < minDist) {
                minDist = Math.abs(myTop - objTop);
                snapTargetY = objTop;
            }
        });
        if (typeof snapGuide === 'undefined' || !snapGuide) {
            const geometry = new THREE.SphereGeometry(0.05, 16, 16);
            const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.7 });
            snapGuide = new THREE.Mesh(geometry, material);
            snapGuide.visible = false;
            scene.add(snapGuide);
        }
        if (snapTargetY !== null) {
            // 스냅: 면에 딱 맞게 붙임 + 가이드 표시
            newHeight = Math.abs(snapTargetY - extrudeBaseY);
            snapGuide.visible = true;
            snapGuide.position.set(extrudeTarget.position.x, snapTargetY, extrudeTarget.position.z);
        } else {
            snapGuide.visible = false;
            lastMouseY = event.clientY;
        }
        const newScaleY = newHeight / extrudeTarget.geometry.parameters.height;
        extrudeTarget.position.y = extrudeBaseY + newHeight / 2;
        extrudeTarget.scale.y = newScaleY;
        // === 크기 정보 마우스 따라다니며 표시 (Extrude) ===
        const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'block';
            dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${newHeight.toFixed(2)}`;
            dimensionDiv.style.position = 'fixed';
            dimensionDiv.style.left = (event.clientX + 20) + 'px';
            dimensionDiv.style.top = (event.clientY + 20) + 'px';
            dimensionDiv.style.zIndex = 9999;
        }
        // === 크기 정보 표시 끝 ===
    } else if (isExtrudingX) {
        // extrudeX(옆면) - 스냅 가이드(보라색 구) 표시 추가
        const rect = renderer.domElement.getBoundingClientRect();
        let mouseScreen, deltaScreen;
        if (extrudeXScreenAxis === 'x') {
            mouseScreen = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            deltaScreen = mouseScreen - extrudeXStartScreen;
        } else {
            mouseScreen = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            deltaScreen = mouseScreen - extrudeXStartScreen;
        }
        let direction = 1;
        const worldPos = new THREE.Vector3(extrudeXStartX, extrudeTarget.position.y, extrudeTarget.position.z);
        const normalEnd = worldPos.clone().add(extrudeXFaceNormal);
        const normalScreen = normalEnd.project(camera).sub(worldPos.clone().project(camera)).normalize();
        const normalScreenVal = extrudeXScreenAxis === 'x' ? normalScreen.x : normalScreen.y;
        if (normalScreenVal * deltaScreen < 0) direction = -1;
        const cameraDistance = camera.position.distanceTo(extrudeTarget.position);
        const scaleFactor = cameraDistance * 2 * Math.tan(camera.fov * Math.PI / 360);
        const moveAmount = Math.abs(deltaScreen) * scaleFactor * 0.5 * direction;
        let dragX = extrudeXStartX + moveAmount * extrudeXFaceSign;
        let newWidth = 0;
        let newPosX = 0;
        if (extrudeXFaceSign > 0) {
            newWidth = Math.max(0.1, dragX - extrudeXFixedX);
            newPosX = (dragX + extrudeXFixedX) / 2;
        } else {
            newWidth = Math.max(0.1, extrudeXFixedX - dragX);
            newPosX = (dragX + extrudeXFixedX) / 2;
        }
        // 최소한의 면-면 스냅
        let snapMin = 0.1;
        let width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        let faceX = extrudeXFaceSign > 0 ? (newPosX + newWidth / 2) : (newPosX - newWidth / 2);
        let snapTargetX = null;
        let minDist = snapMin;
        drawableObjects.forEach(obj => {
            if (obj === extrudeTarget) return;
            const objWidth = obj.geometry.parameters.width * obj.scale.x;
            const leftX = obj.position.x - objWidth / 2;
            const rightX = obj.position.x + objWidth / 2;
            if (Math.abs(faceX - leftX) < minDist) {
                minDist = Math.abs(faceX - leftX);
                snapTargetX = leftX;
            }
            if (Math.abs(faceX - rightX) < minDist) {
                minDist = Math.abs(faceX - rightX);
                snapTargetX = rightX;
            }
        });
        // === 스냅 가이드(보라색 구) 표시 ===
        if (typeof snapGuide === 'undefined' || !snapGuide) {
            const geometry = new THREE.SphereGeometry(0.05, 16, 16);
            const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.7 });
            snapGuide = new THREE.Mesh(geometry, material);
            snapGuide.visible = false;
            scene.add(snapGuide);
        }
        if (snapTargetX !== null) {
            // 스냅: 면에 딱 맞게 붙임 + 가이드 표시
            newWidth = Math.abs(snapTargetX - extrudeXFixedX);
            newPosX = (snapTargetX + extrudeXFixedX) / 2;
            snapGuide.visible = true;
            snapGuide.position.set(snapTargetX, extrudeTarget.position.y, extrudeTarget.position.z);
        } else {
            snapGuide.visible = false;
        }
        extrudeTarget.scale.x = newWidth / extrudeTarget.geometry.parameters.width;
        extrudeTarget.position.x = newPosX;
        // 정보 표시
        const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'block';
            dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${(extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x).toFixed(2)}<br>세로: ${depth.toFixed(2)}<br>높이: ${height.toFixed(2)}`;
            dimensionDiv.style.position = 'fixed';
            dimensionDiv.style.left = (event.clientX + 20) + 'px';
            dimensionDiv.style.top = (event.clientY + 20) + 'px';
            dimensionDiv.style.zIndex = 9999;
        }
    } else if (isExtrudingZ) {
        // extrudeZ(앞/뒤면) - 기본 + 최소한의 면-면 스냅만 추가
        const rect = renderer.domElement.getBoundingClientRect();
        let mouseScreen, deltaScreen;
        if (extrudeZScreenAxis === 'y') {
            mouseScreen = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            deltaScreen = mouseScreen - extrudeZStartScreen;
        } else {
            mouseScreen = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            deltaScreen = mouseScreen - extrudeZStartScreen;
        }
        let direction = 1;
        const worldPos = new THREE.Vector3(extrudeTarget.position.x, extrudeTarget.position.y, extrudeZStartZ);
        const normalEnd = worldPos.clone().add(extrudeZFaceNormal);
        const normalScreen = normalEnd.project(camera).sub(worldPos.clone().project(camera)).normalize();
        const normalScreenVal = extrudeZScreenAxis === 'y' ? normalScreen.y : normalScreen.x;
        if (normalScreenVal * deltaScreen < 0) direction = -1;
        const cameraDistance = camera.position.distanceTo(extrudeTarget.position);
        const scaleFactor = cameraDistance * 2 * Math.tan(camera.fov * Math.PI / 360);
        const moveAmount = Math.abs(deltaScreen) * scaleFactor * 0.5 * direction;
        let dragZ = extrudeZStartZ + moveAmount * extrudeZFaceSign;
        let newDepth = 0;
        let newPosZ = 0;
        if (extrudeZFaceSign > 0) {
            newDepth = Math.max(0.1, dragZ - extrudeZFixedZ);
            newPosZ = (dragZ + extrudeZFixedZ) / 2;
        } else {
            newDepth = Math.max(0.1, extrudeZFixedZ - dragZ);
            newPosZ = (dragZ + extrudeZFixedZ) / 2;
        }
        // 최소한의 면-면 스냅
        let snapMin = 0.1;
        let depth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        let faceZ = extrudeZFaceSign > 0 ? (newPosZ + newDepth / 2) : (newPosZ - newDepth / 2);
        let snapTargetZ = null;
        let minDist = snapMin;
        drawableObjects.forEach(obj => {
            if (obj === extrudeTarget) return;
            const objDepth = obj.geometry.parameters.depth * obj.scale.z;
            const frontZ = obj.position.z + objDepth / 2;
            const backZ = obj.position.z - objDepth / 2;
            if (Math.abs(faceZ - frontZ) < minDist) {
                minDist = Math.abs(faceZ - frontZ);
                snapTargetZ = frontZ;
            }
            if (Math.abs(faceZ - backZ) < minDist) {
                minDist = Math.abs(faceZ - backZ);
                snapTargetZ = backZ;
            }
        });
        // === 스냅 가이드(보라색 구) 표시 ===
        if (typeof snapGuide === 'undefined' || !snapGuide) {
            const geometry = new THREE.SphereGeometry(0.05, 16, 16);
            const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.7 });
            snapGuide = new THREE.Mesh(geometry, material);
            snapGuide.visible = false;
            scene.add(snapGuide);
        }
        if (snapTargetZ !== null) {
            // 스냅: 면에 딱 맞게 붙임 + 가이드 표시
            newDepth = Math.abs(snapTargetZ - extrudeZFixedZ);
            newPosZ = (snapTargetZ + extrudeZFixedZ) / 2;
            snapGuide.visible = true;
            snapGuide.position.set(extrudeTarget.position.x, extrudeTarget.position.y, snapTargetZ);
        } else {
            snapGuide.visible = false;
        }
        extrudeTarget.scale.z = newDepth / extrudeTarget.geometry.parameters.depth;
        extrudeTarget.position.z = newPosZ;
        // 정보 표시
        const width = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const height = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'block';
            dimensionDiv.innerHTML = `<b>크기 정보</b><br>가로: ${width.toFixed(2)}<br>세로: ${(extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z).toFixed(2)}<br>높이: ${height.toFixed(2)}`;
            dimensionDiv.style.position = 'fixed';
            dimensionDiv.style.left = (event.clientX + 20) + 'px';
            dimensionDiv.style.top = (event.clientY + 20) + 'px';
            dimensionDiv.style.zIndex = 9999;
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
    } else {
        // IDLE 상태일 때만 하이라이트 처리
        updateHighlight();
        if (isTexturingMode) {
            updateTextureHighlight();
        }
    }
}

function onPointerUp(event) {
    if (isExtruding) {
        const newWidth = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const newHeight = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const newDepth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const newGeom = new THREE.BoxGeometry(newWidth, newHeight, newDepth);
        // TransformCommand를 위한 새 상태
        // extrudeBaseY가 있으면 그 기준으로 position.y 계산
        const baseY = extrudeBaseY !== null ? extrudeBaseY : extrudeTarget.position.y - newHeight / 2;
        const newTransformData = {
            geometry: newGeom,
            position: new THREE.Vector3(extrudeTarget.position.x, baseY + newHeight / 2, extrudeTarget.position.z),
            scale: new THREE.Vector3(1, 1, 1)
        };
        // 현재 객체를 undo 상태로 되돌리고, command를 통해 redo 상태로 만듦
        extrudeTarget.geometry.dispose();
        extrudeTarget.geometry = oldTransformData.geometry;
        extrudeTarget.position.copy(oldTransformData.position);
        extrudeTarget.scale.copy(oldTransformData.scale);
        const command = new TransformCommand(extrudeTarget, oldTransformData, newTransformData);
        history.execute(command);
        clearAxisGuideLines();
        isExtruding = false;
        extrudeTarget = null;
        controls.enabled = true;
        oldTransformData = null;
        extrudeBaseY = null;
        // === 크기 정보 숨김 ===
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
        // === 크기 정보 숨김 끝 ===
    } else if (isExtrudingX) {
        const newWidth = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const newHeight = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const newDepth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const newGeom = new THREE.BoxGeometry(newWidth, newHeight, newDepth);
        const newTransformData = {
            geometry: newGeom,
            position: new THREE.Vector3(extrudeTarget.position.x, extrudeTarget.position.y, extrudeTarget.position.z),
            scale: new THREE.Vector3(1, 1, 1)
        };
        extrudeTarget.geometry.dispose();
        extrudeTarget.geometry = oldTransformData.geometry;
        extrudeTarget.position.copy(oldTransformData.position);
        extrudeTarget.scale.copy(oldTransformData.scale);
        const command = new TransformCommand(extrudeTarget, oldTransformData, newTransformData);
        history.execute(command);
        clearAxisGuideLines();
        isExtrudingX = false;
        extrudeTarget = null;
        controls.enabled = true;
        // 정보창 숨김
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
    } else if (isExtrudingZ) {
        const newWidth = extrudeTarget.geometry.parameters.width * extrudeTarget.scale.x;
        const newHeight = extrudeTarget.geometry.parameters.height * extrudeTarget.scale.y;
        const newDepth = extrudeTarget.geometry.parameters.depth * extrudeTarget.scale.z;
        const newGeom = new THREE.BoxGeometry(newWidth, newHeight, newDepth);
        const newTransformData = {
            geometry: newGeom,
            position: new THREE.Vector3(extrudeTarget.position.x, extrudeTarget.position.y, extrudeTarget.position.z),
            scale: new THREE.Vector3(1, 1, 1)
        };
        extrudeTarget.geometry.dispose();
        extrudeTarget.geometry = oldTransformData.geometry;
        extrudeTarget.position.copy(oldTransformData.position);
        extrudeTarget.scale.copy(oldTransformData.scale);
        const command = new TransformCommand(extrudeTarget, oldTransformData, newTransformData);
        history.execute(command);
        clearAxisGuideLines();
        isExtrudingZ = false;
        extrudeTarget = null;
        controls.enabled = true;
        // 정보창 숨김
        const dimensionDiv = document.getElementById('dimension-info');
        if (dimensionDiv) {
            dimensionDiv.style.display = 'none';
        }
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

        const width = Math.abs(snappedEndPoint.x - startPoint.x);
        const depth = Math.abs(snappedEndPoint.z - startPoint.z);
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
    if (isDrawing || isExtruding || isExtrudingX || isExtrudingZ || moveMode) { // moveMode 추가
        if(highlightMesh) highlightMesh.visible = false;
        return;
    }
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(drawableObjects);

    let hovered = false;
    if (intersects.length > 0) {
        const intersection = intersects[0];
        const face = intersection.face;
        // 윗면(y축), 옆면(x축), 앞/뒤면(z축)도 하이라이트
        if (face.normal.y > 0.99 || Math.abs(face.normal.x) > 0.99 || Math.abs(face.normal.z) > 0.99) {
            hovered = true;
            const object = intersection.object;

            if (!highlightMesh) {
                const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
                const highlightGeometry = new THREE.PlaneGeometry(1, 1);
                highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
                highlightMesh.rotation.x = -Math.PI / 2;
                scene.add(highlightMesh); // 항상 scene에 추가
            }
            
            const targetWidth = object.geometry.parameters.width * object.scale.x;
            const targetHeight = object.geometry.parameters.height * object.scale.y;
            const targetDepth = object.geometry.parameters.depth * object.scale.z;

            // 윗면(y축) 하이라이트: 기존처럼 위에 평면
            if (face.normal.y > 0.99) {
                highlightMesh.material.color.set(0x00aaff); // 파란색
                highlightMesh.position.set(object.position.x, object.position.y + targetHeight / 2 + 0.01, object.position.z);
                highlightMesh.scale.set(targetWidth, targetDepth, 1);
                highlightMesh.rotation.set(-Math.PI / 2, 0, 0);
            } else if (Math.abs(face.normal.x) > 0.99) {
                // 옆면(x축) 하이라이트: 옆에 평면
                highlightMesh.material.color.set(0xff9900); // 주황색
                const sign = face.normal.x > 0 ? 1 : -1;
                highlightMesh.position.set(object.position.x + sign * targetWidth / 2 + 0.01 * sign, object.position.y, object.position.z);
                highlightMesh.scale.set(targetDepth, targetHeight, 1);
                highlightMesh.rotation.set(0, 0, 0); // xz 평면
                highlightMesh.rotation.y = Math.PI / 2 * sign;
            } else if (Math.abs(face.normal.z) > 0.99) {
                // 앞/뒤면(z축) 하이라이트: 앞/뒤에 평면
                highlightMesh.material.color.set(0x00ff44); // 초록색(예시)
                const sign = face.normal.z > 0 ? 1 : -1;
                highlightMesh.position.set(object.position.x, object.position.y, object.position.z + sign * targetDepth / 2 + 0.01 * sign);
                highlightMesh.scale.set(targetWidth, targetHeight, 1);
                highlightMesh.rotation.set(0, 0, 0);
                highlightMesh.rotation.y = 0;
            }
            highlightMesh.visible = true;
        }
    }

    if (!hovered && highlightMesh) {
        highlightMesh.visible = false;
    }
}

function clearTextureHighlight() {
    if (highlightedFaceInfo.object) {
        // 저장해둔 원래 재질로 복원
        highlightedFaceInfo.object.material[highlightedFaceInfo.faceIndex] = highlightedFaceInfo.originalMaterial;
        highlightedFaceInfo.object.material.needsUpdate = true;
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
}

animate(); 

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
};
const origUndo = history.undo.bind(history);
history.undo = function() {
    origUndo();
    updateUndoRedoMenuState();
};
const origRedo = history.redo.bind(history);
history.redo = function() {
    origRedo();
    updateUndoRedoMenuState();
}; 

// === 격자 보기 토글 및 체크박스 표시 ===
window.addEventListener('DOMContentLoaded', () => {
    const gridMenu = document.getElementById('toggle-grid');
    const checkSpan = gridMenu ? gridMenu.querySelector('.check') : null;
    if (gridMenu && checkSpan) {
        // 초기 상태 반영
        function updateGridCheck() {
            if (gridHelper.visible) {
                checkSpan.textContent = '✓';
            } else {
                checkSpan.textContent = '';
            }
        }
        updateGridCheck();
        gridMenu.addEventListener('click', () => {
            gridHelper.visible = !gridHelper.visible;
            updateGridCheck();
        });
    }
}); 

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
            } else if (btn === moveBtn) {
                drawingMode = false;
                moveMode = true;
                rotateMode = false;
            } else if (btn === rotateBtn) {
                drawingMode = false;
                moveMode = false;
                rotateMode = true;
            }
            // === 모드 변경 시 선택된 도형 하이라이트 해제 ===
            if (selectedObject) {
                clearSelectedHighlight(selectedObject);
                selectedObject = null;
            }
            // === 모드 변경 시 스냅/가이드/프리뷰 등 모두 숨기기 ===
            if (typeof snapGuide !== 'undefined' && snapGuide) snapGuide.visible = false;
            if (typeof clearAxisGuideLines === 'function') clearAxisGuideLines();
            if (typeof previewMesh !== 'undefined' && previewMesh) {
                scene.remove(previewMesh);
                previewMesh = null;
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
}

function clearSelectedHighlight(obj) {
    if (highlightOverlayMesh) {
        scene.remove(highlightOverlayMesh);
        highlightOverlayMesh = null;
    }
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
            // 이동 시작 위치 저장
            selectStartPosition = selectedObject.position.clone();
        } else {
            // 빈 공간 클릭 시 선택 해제
            if (selectedObject) clearSelectedHighlight(selectedObject);
            selectedObject = null;
            selectedFaceIndex = null;
            selectStartPosition = null;
        }
    }
});
renderer.domElement.addEventListener('pointermove', function(event) {
    if (moveMode && isDraggingSelected && selectedObject && event.buttons === 1) {
        updateMouseAndRaycaster(event);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -selectedObject.position.y);
        raycaster.setFromCamera(mouse, camera);
        const intersect = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, intersect)) {
            let newPos = intersect.clone().add(dragOffset);
            clearSelectSnapGuideLines();
            const snapThreshold = 0.1;
            const myWidth = selectedObject.geometry.parameters.width * selectedObject.scale.x;
            const myDepth = selectedObject.geometry.parameters.depth * selectedObject.scale.z;
            const myHeight = selectedObject.geometry.parameters.height * selectedObject.scale.y;
            // 내 도형의 x/z 관련 모든 좌표
            const myX = [newPos.x, newPos.x - myWidth/2, newPos.x + myWidth/2];
            const myZ = [newPos.z, newPos.z - myDepth/2, newPos.z + myDepth/2];
            let snapX = newPos.x;
            let snapZ = newPos.z;
            let snappedX = false, snappedZ = false;
            drawableObjects.forEach(obj => {
                if (obj === selectedObject) return;
                const objWidth = obj.geometry.parameters.width * obj.scale.x;
                const objDepth = obj.geometry.parameters.depth * obj.scale.z;
                // 상대 도형의 x/z 관련 모든 좌표
                const objX = [obj.position.x, obj.position.x - objWidth/2, obj.position.x + objWidth/2];
                const objZ = [obj.position.z, obj.position.z - objDepth/2, obj.position.z + objDepth/2];
                // x축 모든 조합
                myX.forEach(mx => {
                    objX.forEach(ox => {
                        if (Math.abs(mx - ox) < snapThreshold) {
                            snapX = newPos.x + (ox - mx);
                            snappedX = true;
                            showSelectSnapGuideLine('x', ox, obj.position.z, objDepth);
                        }
                    });
                });
                // z축 모든 조합
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
            // === 쌓기(y축) ===
            // 마우스 아래에 도형이 있으면, 내 도형의 x/z 중심이 그 도형의 x/z 평면 범위 안에 들어가면 쌓기
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(drawableObjects.filter(obj => obj !== selectedObject));
            if (intersects.length > 0) {
                const underObj = intersects[0].object;
                const underWidth = underObj.geometry.parameters.width * underObj.scale.x;
                const underDepth = underObj.geometry.parameters.depth * underObj.scale.z;
                const underHeight = underObj.geometry.parameters.height * underObj.scale.y;
                const underTop = underObj.position.y + underHeight/2;
                // 내 도형의 x/z 중심이 아래 도형의 x/z 평면 범위 안에 들어가는지 체크
                if (
                    newPos.x > underObj.position.x - underWidth/2 &&
                    newPos.x < underObj.position.x + underWidth/2 &&
                    newPos.z > underObj.position.z - underDepth/2 &&
                    newPos.z < underObj.position.z + underDepth/2
                ) {
                    newPos.y = underTop + myHeight/2;
                } else {
                    // 바닥에 붙이기
                    newPos.y = myHeight/2;
                }
            } else {
                // 바닥에 붙이기
                newPos.y = myHeight/2;
            }
            selectedObject.position.copy(newPos);
        }
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
        // 이동 종료 위치 저장 및 Undo/Redo 기록
        let selectEndPosition = selectedObject.position.clone();
        if (selectStartPosition && !selectStartPosition.equals(selectEndPosition)) {
            history.execute(new SelectObjectCommand(selectedObject, selectStartPosition, selectEndPosition));
        }
        selectStartPosition = null;
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
    // ESC키: 그리기 모드로 복귀
    if (event.key === 'Escape') {
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
            selectedFaceIndex = null;
        }
        // === 스냅/가이드/프리뷰 등 모두 숨기기 ===
        if (typeof snapGuide !== 'undefined' && snapGuide) snapGuide.visible = false;
        if (typeof clearAxisGuideLines === 'function') clearAxisGuideLines();
        if (typeof previewMesh !== 'undefined' && previewMesh) {
            scene.remove(previewMesh);
            previewMesh = null;
        }
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