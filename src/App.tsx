import { useEffect, useRef } from "react";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";

const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;
const BLOCK_SIZE = 64;
const GRID_WIDTH = 8;
const MAX_BLOCKS = 4;
const SOLVE_TIME = 30;

interface Controller {
  up: number;
  down: number;
  left: number;
  right: number;
  a: number;
  b: number;
}

interface Position {
  x: number;
  y: number;
  ix: number;
  iy: number;
}

const blockColors = ["red", "green", "blue", "yellow"] as const;
type BlockColor = typeof blockColors[number];

function blockColorString(color: BlockColor) {
  switch (color) {
    case "red":
      return "#da2424";
    case "green":
      return "#08b23b";
    case "blue":
      return "#2890dc";
    case "yellow":
      return "#ecab11";
  }
}

const blockStates = ["idle", "lifted", "ground", "falling", "solving"] as const;
type BlockState = typeof blockStates[number];

function blockIsPickable(block: Block): boolean {
  return block.state === "idle" || block.state === "ground" || block.state === "falling" || block.state === "solving";
}

function blockIsSolvable(block: Block): boolean {
  return block.state === "idle" || block.state === "ground";
}

function blocksMatch(block1: Block, block2: Block): boolean {
  if (!blockIsSolvable(block1) || !blockIsSolvable(block2)) {
    return false;
  }
  return block1.color === block2.color;
}

function blockMoveAndCollide(state: GameState, block: Block, movementX: number, movementY: number) {
  const pickPos = clonePosition(block.pos);
  let x = movementX;
  let y = movementY;
  if (movementX < 0) {
    x -= BLOCK_SIZE * 0.5;
  }
  if (movementX > 0) {
    x += BLOCK_SIZE * 0.5;
  }
  if (movementY < 0) {
    y -= BLOCK_SIZE;
  }
  if (movementY === 0) {
    y -= BLOCK_SIZE * 0.5;
  }
  addPosition(x, y, pickPos);
  const pickedBlock = pickBlock(state, pickPos);
  if (!pickedBlock || (pickedBlock !== true && pickedBlock.id === block.id)) {
    addPosition(movementX, movementY, block.pos);
    return true;
  }
  return false;
}

function blockUpdate(state: GameState, block: Block) {
  switch (block.state) {
    case "idle": {
      break;
    }
    case "lifted": {
      const player = state.player;
      const index = player.blocks.indexOf(block);
      setPosition(player.pos.x, player.pos.y - player.height - (index * BLOCK_SIZE * 0.5), block.pos);
      break;
    }
    case "ground": {
      if (blockMoveAndCollide(state, block, 0, 3)) {
        blockSetState(block, "falling");
      }
      break;
    }
    case "falling": {
      if (!blockMoveAndCollide(state, block, 0, 3)) {
        blockSetState(block, "ground");
      }
      break;
    }
    case "solving": {
      block.timer -= 1;
      if (block.timer <= 0) {
        state.blocks.splice(state.blocks.indexOf(block), 1);
        return;
      }
      break;
    }
  }
}

function blockSetState(block: Block, state: BlockState) {
  block.state = state;
  switch (state) {
    case "solving": {
      block.timer = 30;
      break;
    }
  }
}


function checkSolutions(state: GameState) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const block of state.blocks) {
    minY = Math.min(minY, block.pos.iy);
    maxY = Math.max(maxY, block.pos.iy);
  }
  const height = maxY - minY + 1;
  const blockmap: (Block | undefined)[] = Array.from({ length: GRID_WIDTH * height });
  for (const block of state.blocks) {
    blockmap[(block.pos.iy - minY) * GRID_WIDTH + block.pos.ix] = block;
  }
  const solvedBlocks: Set<Block> = new Set();
  const streaks: Block[][] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < GRID_WIDTH; i++) {
      const block = blockmap[j * GRID_WIDTH + i];
      if (!block) {
        continue;
      }
      let streak = [block];
      // look horizontally
      for (let k = i + 1; k < GRID_WIDTH; k++) {
        const nextBlock = blockmap[j * GRID_WIDTH + k];
        if (!nextBlock || !blocksMatch(block, nextBlock)) {
          break;
        }
        streak.push(nextBlock);
      }
      if (streak.length >= 3) {
        if (streak.find(block => block.state === "ground")) {
          streaks.push(streak);
          streak.forEach(block => solvedBlocks.add(block));
        }
      }
      // look vertically
      streak = [block];
      for (let k = j + 1; k < height; k++) {
        const nextBlock = blockmap[k * GRID_WIDTH + i];
        if (!nextBlock || !blocksMatch(block, nextBlock)) {
          break;
        }
        streak.push(nextBlock);
      }
      if (streak.length >= 3) {
        if (streak.find(block => block.state === "ground")) {
          streaks.push(streak);
          streak.forEach(block => solvedBlocks.add(block));
        }
      }
    }
  }
  solvedBlocks.forEach(block => blockSetState(block, "solving"));
}

interface Block {
  id: number;
  pos: Position;
  color: BlockColor;
  state: BlockState;
  timer: number;
}

const playerStates = ["ground", "jumping", "falling", "wallride", "walljumping"] as const;
type PlayerState = typeof playerStates[number];

function clonePosition(pos: Position): Position {
  return {
    x: pos.x,
    y: pos.y,
    ix: pos.ix,
    iy: pos.iy,
  };
}

function addPosition(x: number, y: number, pos: Position) {
  pos.x += x;
  pos.y += y;
  pos.ix = Math.floor(pos.x / BLOCK_SIZE);
  pos.iy = Math.floor(pos.y / BLOCK_SIZE);
}

function setPosition(x: number, y: number, pos: Position) {
  pos.x = x;
  pos.y = y;
  pos.ix = Math.floor(pos.x / BLOCK_SIZE);
  pos.iy = Math.floor(pos.y / BLOCK_SIZE);
}

function playerMoveAndCollide(state: GameState, pos: Position, width: number, height: number, movementX: number, movementY: number) {
  const pickPos = clonePosition(pos);
  let x = movementX;
  let y = movementY;
  if (movementX < 0) {
    x -= width * 0.5;
  }
  if (movementX > 0) {
    x += width * 0.5;
  }
  if (movementY < 0) {
    y -= BLOCK_SIZE;
  }
  if (movementY === 0) {
    y -= BLOCK_SIZE * 0.5;
  }
  addPosition(x, y, pickPos);
  if (!pickBlock(state, pickPos)) {
    addPosition(movementX, movementY, pos);
    return true;
  }
  return false;
}

function onGround(state: GameState, player: Player) {
  const pickPos = clonePosition(player.pos);
  addPosition(player.width * -0.25, 3, pickPos);
  let block = pickBlock(state, pickPos);
  if (block) {
    return block;
  }
  addPosition(player.width * 0.5, 0, pickPos);
  return pickBlock(state, pickPos);
}

function playerUpdate(state: GameState, player: Player, controller: Controller) {
  switch (player.state) {
    case "ground": {
      let movementX = 0;
      if (controller.left > 0) {
        movementX -= player.speed;
      }
      if (controller.right > 0) {
        movementX += player.speed;
      }

      const groundBlock = onGround(state, player);

      if (controller.a === 1 && player.blocks.length < MAX_BLOCKS && groundBlock && groundBlock !== true) {
        blockSetState(groundBlock, "lifted");
        player.blocks.push(groundBlock);
      }

      playerMoveAndCollide(state, player.pos, player.width, player.height, movementX, 0);

      if (controller.up === 1) {
        playerSetState(player, "jumping");
      }

      if (!groundBlock) {
        playerSetState(player, "falling");
      }
      break;
    }
    case "jumping": {
      let movementX = 0;
      if (controller.left > 0) {
        movementX -= player.speed;
      }
      if (controller.right > 0) {
        movementX += player.speed;
      }
      playerMoveAndCollide(state, player.pos, player.width, player.height, movementX, 0);
      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, 0, -5 * (player.jumpTime / 30))) {
        playerSetState(player, "falling");
      }
      if (player.jumpTime > 0) {
        player.jumpTime--;
      } else {
        playerSetState(player, "falling");
      }
      break;
    }
    case "falling": {
      let movementX = 0;
      if (controller.left > 0) {
        movementX -= player.speed;
      }
      if (controller.right > 0) {
        movementX += player.speed;
      }

      if (controller.b === 1) {
        const block = player.blocks.shift();
        if (block) {
          setPosition((Math.floor(player.pos.x / BLOCK_SIZE) + 0.5) * BLOCK_SIZE, player.pos.y, block.pos);
          blockSetState(block, "falling");
          playerSetState(player, "jumping");
          return;
        }
      }

      if (player.jumpTime > 0 && controller.up === 1) {
        playerSetState(player, "jumping");
        return;
      }
      player.jumpTime--;

      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, movementX, 0)) {
        player.wallriding = movementX;
        playerSetState(player, "wallride");
        return;
      }
      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, 0, 3)) {
        playerSetState(player, "ground");
      }
      if (onGround(state, player)) {
        playerSetState(player, "ground");
      }
      break;
    }
    case "wallride": {
      let movementX = 0;
      if (controller.left > 0) {
        movementX -= player.speed;
      }
      if (controller.right > 0) {
        movementX += player.speed;
      }
      if (movementX !== 0 && Math.sign(movementX) === Math.sign(player.wallriding || 0)) {
        player.jumpTime = 10;
      } else {
        player.jumpTime--;
      }
      if (player.jumpTime <= 0) {
        playerSetState(player, "falling");
        return;
      }
      
      if (controller.up === 1) {
        player.wallriding = (player.wallriding || 0) * -1;
        playerSetState(player, "walljumping");
        return;
      }
      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, 0, 1)) {
        playerSetState(player, "ground");
        return;
      }
      if (playerMoveAndCollide(state, player.pos, player.width, player.height, player.wallriding || 0, 0)) {
        playerSetState(player, "falling");
      }
      break;
    }
    case "walljumping": {
      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, player.wallriding || 0, 0)) {
        player.wallriding = -(player.wallriding || 0);
        playerSetState(player, "wallride");
        return;
      }
      if (!playerMoveAndCollide(state, player.pos, player.width, player.height, 0, -4 * (player.jumpTime / 30))) {
        playerSetState(player, "falling");
        return;
      }
      if (player.jumpTime > 0) {
        player.jumpTime--;
      } else {
        playerSetState(player, "falling");
      }
      break;
    }
  }
}

function pickBlock(state: GameState, pos: Position): Block | true | null {
  if (pos.ix < 0 || pos.ix >= GRID_WIDTH) {
    return true;
  }

  return state.blocks.find(block => block.pos.ix === pos.ix && block.pos.iy === pos.iy && blockIsPickable(block)) || null;
}

function playerSetState(player: Player, state: PlayerState) {
  if (player.state === "ground" && state === "falling") {
    // acme jump
    player.jumpTime = 5;
  } else {
    player.jumpTime = 0;
  }

  player.state = state;
  switch (state) {
    case "ground":
      setPosition(player.pos.x, Math.floor((player.pos.y + 3) / BLOCK_SIZE) * BLOCK_SIZE, player.pos);
      break;
    case "jumping":
      player.jumpTime = 30;
      break;
    case "walljumping":
      player.jumpTime = 30;
      break;
  }
}

interface Player {
  pos: Position;
  width: number;
  height: number;
  jumpTime: number;
  speed: number;
  state: PlayerState;
  wallriding: number | null;
  blocks: Array<Block>;
}

interface GameState {
  time: number;
  seed: number;
  player: Player;
  camera: {
    pos: Position;
  };
  blocks: Array<Block>;
  nextBlockId: number;
}

function initialState(): GameState {
  return {
    time: 0,
    seed: 0,
    player: {
      pos: {
        x: 3.5 * BLOCK_SIZE,
        y: 0,
        ix: 3,
        iy: 0,
      },
      width: BLOCK_SIZE * 0.5,
      height: BLOCK_SIZE * 1.1,
      state: "falling",
      jumpTime: 0,
      speed: 2,
      wallriding: null,
      blocks: [],
    },
    camera: {
      pos: {
        x: GRID_WIDTH * BLOCK_SIZE / 2,
        y: BLOCK_SIZE * 3,
        ix: 0,
        iy: 0,
      },
    },
    blocks: [],
    nextBlockId: 0,
  };
}

function createBlock(state: GameState, ix: number, iy: number, color: BlockColor): Block {
  const id = state.nextBlockId;
  state.nextBlockId += 1;
  const block: Block = {
    id,
    pos: {
      x: (ix + 0.5) * BLOCK_SIZE,
      y: (iy + 1.0) * BLOCK_SIZE,
      ix,
      iy,
    },
    color,
    state: "idle",
    timer: 0,
  };
  state.blocks.push(block);
  return block;
}

function randomBlockColor(): BlockColor {
  return blockColors[Math.floor(Math.random() * blockColors.length)];
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gamepads: Map<number, Gamepad> = new Map();

    canvas.style.backgroundColor = "#e0efff";
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const rctx = rough.canvas(canvas);
    const onWindowResize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };

    const onGamepadConnected = (e: GamepadEvent) => {
      gamepads.set(e.gamepad.index, e.gamepad);
    };
    const onGamepadDisconnected = (e: GamepadEvent) => {
      gamepads.delete(e.gamepad.index);
    };
    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);

    const controller: Controller = {
      up: 0,
      down: 0,
      left: 0,
      right: 0,
      a: 0,
      b: 0,
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case "w":
          controller.up = 1;
          break;
        case "a":
          controller.left = 1;
          break;
        case "s":
          controller.down = 1;
          break;
        case "d":
          controller.right = 1;
          break;
        case "j":
          controller.a = 1;
          break;
        case "k":
          controller.b = 1;
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case "w":
          controller.up = 0;
          break;
        case "a":
          controller.left = 0;
          break;
        case "s":
          controller.down = 0;
          break;
        case "d":
          controller.right = 0;
          break;
        case "j":
          controller.a = 0;
          break;
        case "k":
          controller.b = 0;
          break;
      }
    };
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    
    let time = 0;
    let seed = 0;
    let fontsReady = false;
    const state = initialState();

    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < GRID_WIDTH; i++) {
        if (Math.random() < 0.5) {
          createBlock(state, i, j, randomBlockColor());
        }
      }
    }

    const step = () => {
      playerUpdate(state, state.player, controller);
      for (const block of state.blocks) {
        blockUpdate(state, block);
      }
      checkSolutions(state);
      setPosition(state.camera.pos.x, state.player.pos.y, state.camera.pos);

      if (controller.up > 0) controller.up += 1;
      if (controller.down > 0) controller.down += 1;
      if (controller.left > 0) controller.left += 1;
      if (controller.right > 0) controller.right += 1;
      if (controller.a > 0) controller.a += 1;
      if (controller.b > 0) controller.b += 1;
    };

    let gamepadState = {
      up: false,
      down: false,
      left: false,
      right: false,
      a: false,
      b: false,
    };

    let shouldQuit = false;
    let timeAcc = 0;
    const STEP = 1000 / 60;
    const draw = (t: number) => {
      const dt = t - time;
      time = t;
      timeAcc += dt;

      const newGamepadState = {
        up: false,
        down: false,
        left: false,
        right: false,
        a: false,
        b: false,
      };
      for (const gamepad of navigator.getGamepads()) {
        if (gamepad) {
          for (let i = 0; i < gamepad.buttons.length; i++) {
            const button = gamepad.buttons[i];
            if (button.pressed) {
              console.log(i, button, "pressed");
            }
          }
          newGamepadState.up ||= gamepad.buttons[12].pressed || gamepad.buttons[3].pressed;
          newGamepadState.down ||= gamepad.buttons[13].pressed;
          newGamepadState.left ||= gamepad.buttons[14].pressed;
          newGamepadState.right ||= gamepad.buttons[15].pressed;
          newGamepadState.a ||= gamepad.buttons[0].pressed;
          newGamepadState.b ||= gamepad.buttons[1].pressed;
        }
      }

      for (const [key, value] of Object.entries(newGamepadState)) {
        if (value !== gamepadState[key as keyof typeof newGamepadState]) {
          controller[key as keyof Controller] = value ? 1 : 0;
        }
      }

      gamepadState = newGamepadState;

      while (timeAcc > STEP) {
        timeAcc -= STEP;
        step();
      }

      seed = Math.floor(time * 0.01);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      const hairline = SCREEN_WIDTH / canvas.width;
      ctx.scale(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);

      // Camera viewport
      ctx.save();
      ctx.translate(SCREEN_WIDTH / 2 - state.camera.pos.x, SCREEN_HEIGHT / 2 - state.camera.pos.y);

      // Draw grid lines
      ctx.beginPath();
      ctx.strokeStyle = "#92CBFA";
      ctx.lineWidth = hairline;
      const top = Math.floor((state.camera.pos.y - SCREEN_HEIGHT / 2) / BLOCK_SIZE);
      const bottom = Math.floor((state.camera.pos.y + SCREEN_HEIGHT / 2) / BLOCK_SIZE) + 1;
      
      for (let i = 0; i <= GRID_WIDTH; i += 1) {
        ctx.moveTo(i * BLOCK_SIZE, top * BLOCK_SIZE);
        ctx.lineTo(i * BLOCK_SIZE, bottom * BLOCK_SIZE);
      }
      for (let j = top; j <= bottom; j += 1) {
        ctx.moveTo(0, j * BLOCK_SIZE);
        ctx.lineTo(GRID_WIDTH * BLOCK_SIZE, j * BLOCK_SIZE);
      }
      ctx.stroke();

      // Draw blocks
      for (const block of state.blocks) {
        const colorStr = blockColorString(block.color);
        let blockSize = BLOCK_SIZE;
        const blockStyle: Options = {
          seed,
          fill: colorStr,
          fillStyle: "cross-hatch",
          fillWeight: 1,
          hachureGap: 5,
          stroke: colorStr
        };
        if (block.state === "lifted") {
          blockSize *= 0.5;
        }
        if (block.state === "idle") {
          blockStyle.fillStyle = "hachure";
          blockStyle.fillWeight = 1;
          blockStyle.hachureGap = 4;
        }
        if (block.state === "solving") {
          blockStyle.fillStyle = "dots";
          blockStyle.fillWeight = 2;
          blockStyle.hachureGap = 6;
          blockStyle.stroke = "none";
        }
        rctx.rectangle(block.pos.x - blockSize / 2, block.pos.y - blockSize, blockSize, blockSize, blockStyle);
      }

      drawCapsule(rctx, state.player.pos.x - state.player.width / 2, state.player.pos.y - state.player.height, state.player.width, state.player.height, { seed, fill: "#C058F8", fillWeight: 5, hachureGap: 6, stroke: "#8131AC", strokeWidth: 3, roughness: 1 })
      ctx.restore();
      // UI viewport

      if (fontsReady) {
        // ctx.font = "48px Indie Flower";
        // ctx.fillStyle = "#000";
        // ctx.fillText("Hello World", 640, 360);

        ctx.font = "30px Indie Flower";
        ctx.fillText(`state=${state.player.state} up=${controller.up} down=${controller.down} left=${controller.left} right=${controller.right} a=${controller.a} b=${controller.b}`, 10, 30);
      }
      ctx.restore();
      if (!shouldQuit) {
        requestAnimationFrame(draw);
      }
    };
    draw(0.0);

    const loadFonts = async () => {
      await document.fonts.load("48px Indie Flower");
      fontsReady = true;
    };
    loadFonts();

    return () => {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("gamepadconnected", onGamepadConnected);
      window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
      shouldQuit = true;
    };
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-red-500">
      <canvas className="w-[100vw] h-[56.25vw] max-w-[177.78vh] max-h-[100vh]" ref={canvasRef} width={100} height={100}></canvas>
    </div>
  );
}

function drawRoundedRectangle(rctx: RoughCanvas, x: number, y: number, width: number, height: number, radius: number, options: Options) {
  // draw a rounded rectangle
  const roundedRectanglePath = `M ${x} ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} L ${x + width - radius} ${y} A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius} L ${x + width} ${y + height - radius} A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height} L ${x + radius} ${y + height} A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius} L ${x} ${y + radius}`;
  rctx.path(roundedRectanglePath, options);
}

function drawCapsule(rctx: RoughCanvas, x: number, y: number, width: number, height: number, options: Options) {
  // draw a capsule
  const radius = width / 2;
  const capsulePath = `M ${x} ${y + radius} A ${radius} ${radius} 0 1 1 ${x + width} ${y + radius} L ${x + width} ${y + height - radius} A ${radius} ${radius} 0 1 1 ${x} ${y + height - radius} L ${x} ${y + radius}`;
  rctx.path(capsulePath, options);
}

export default App;
