/**
 * 이 파일은 Undo/Redo 기능을 위한 Command 패턴과 History 관리를 구현합니다.
 */

// 모든 Command의 기본이 되는 추상 클래스
class Command {
    execute() { throw new Error("execute() must be implemented."); }
    undo() { throw new Error("undo() must be implemented."); }
}

// 1. 객체 추가 Command
class AddObjectCommand extends Command {
    constructor(scene, object, drawableObjects) {
        super();
        this.scene = scene;
        this.object = object;
        this.drawableObjects = drawableObjects;
    }

    execute() {
        this.scene.add(this.object);
        this.drawableObjects.push(this.object);
    }

    undo() {
        this.scene.remove(this.object);
        const index = this.drawableObjects.indexOf(this.object);
        if (index > -1) {
            this.drawableObjects.splice(index, 1);
        }
    }
}

// 2. 객체 변형(Extrude) Command
class TransformCommand extends Command {
    constructor(object, oldTransform, newTransform) {
        super();
        if (object.userData && object.userData.isStacked) {
            throw new Error('Stacked object 커맨드 생성 차단');
        }
        this.object = object;
        this.oldTransform = oldTransform;
        this.newTransform = newTransform;
    }

    execute() {
        this.object.geometry.dispose();
        this.object.geometry = this.newTransform.geometry;
        this.object.position.copy(this.newTransform.position);
        this.object.scale.copy(this.newTransform.scale);
        this.object.material.needsUpdate = true;
    }

    undo() {
        this.object.geometry.dispose();
        this.object.geometry = this.oldTransform.geometry;
        this.object.position.copy(this.oldTransform.position);
        this.object.scale.copy(this.oldTransform.scale);
        this.object.material.needsUpdate = true;
    }
}

// 3. 텍스처 적용 Command
class TextureCommand extends Command {
    constructor(object, materialIndex, oldMaterial, newMaterial) {
        super();
        this.object = object;
        this.materialIndex = materialIndex;
        this.oldMaterial = oldMaterial;
        this.newMaterial = newMaterial;
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

// 4. 객체 선택 Command
class SelectObjectCommand extends Command {
    constructor(object, oldSelection, newSelection) {
        super();
        if (object.userData && object.userData.isStacked) {
            throw new Error('Stacked object 커맨드 생성 차단');
        }
        this.object = object;
        this.oldSelection = oldSelection;
        this.newSelection = newSelection;
    }

    execute() {
        this.object.position.copy(this.newSelection);
    }

    undo() {
        this.object.position.copy(this.oldSelection);
    }
}

// 여러 객체의 변형을 하나의 커맨드로 묶는 GroupTransformCommand
class GroupTransformCommand extends Command {
    constructor(objects, oldTransforms, newTransforms) {
        super();
        this.objects = objects;
        this.oldTransforms = oldTransforms;
        this.newTransforms = newTransforms;
    }
    execute() {
        this.objects.forEach((obj, i) => {
            obj.geometry.dispose();
            obj.geometry = this.newTransforms[i].geometry;
            obj.position.copy(this.newTransforms[i].position);
            obj.scale.copy(this.newTransforms[i].scale);
            obj.material.needsUpdate = true;
        });
    }
    undo() {
        this.objects.forEach((obj, i) => {
            obj.geometry.dispose();
            obj.geometry = this.oldTransforms[i].geometry;
            obj.position.copy(this.oldTransforms[i].position);
            obj.scale.copy(this.oldTransforms[i].scale);
            obj.material.needsUpdate = true;
        });
    }
}

// 여러 객체의 위치를 하나의 커맨드로 묶는 SelectGroupCommand (이동용)
class SelectGroupCommand extends Command {
    constructor(objects, oldPositions, newPositions) {
        super();
        this.objects = objects;
        this.oldPositions = oldPositions;
        this.newPositions = newPositions;
    }
    execute() {
        this.objects.forEach((obj, i) => {
            obj.position.copy(this.newPositions[i]);
        });
    }
    undo() {
        this.objects.forEach((obj, i) => {
            obj.position.copy(this.oldPositions[i]);
        });
    }
}

// 5. 객체 회전 Command
class RotationCommand extends Command {
    constructor(object, oldRotation, newRotation) {
        super();
        this.object = object;
        this.oldRotation = oldRotation;
        this.newRotation = newRotation;
    }

    execute() {
        this.object.rotation.copy(this.newRotation);
    }

    undo() {
        this.object.rotation.copy(this.oldRotation);
    }
}

// History 관리 클래스
class History {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }

    execute(command) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // 새로운 작업이 생기면 redo 스택은 초기화
        console.log("Executed, Undo stack size:", this.undoStack.length);
    }

    undo() {
        if (this.undoStack.length > 0) {
            const command = this.undoStack.pop();
            command.undo();
            this.redoStack.push(command);
            console.log("Undo, Redo stack size:", this.redoStack.length);
        } else {
            console.log("Nothing to undo.");
        }
    }

    redo() {
        if (this.redoStack.length > 0) {
            const command = this.redoStack.pop();
            command.execute();
            this.undoStack.push(command);
            console.log("Redo, Undo stack size:", this.redoStack.length);
        } else {
            console.log("Nothing to redo.");
        }
    }
}