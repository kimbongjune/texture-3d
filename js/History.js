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
            console.log("Redo, Undo stack size:", this.undoStack.length);
        } else {
            console.log("Nothing to redo.");
        }
    }
} 