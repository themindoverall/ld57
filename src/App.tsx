import { useEffect, useRef } from "react";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";
import { Point } from "roughjs/bin/geometry";

const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;
const BLOCK_SIZE = 64;
const GRID_WIDTH = 8;
const MAX_BLOCKS = 4;
const SOLVE_TIME = 30;
const FALL_SPEED = 5;
const FLOAT_SPEED = 8;
const BLOCK_ROW_BUFFER = 20;
const JUMP_TIME = 30;
const WALLJUMP_TIME = 30;
const FLOATING_TIME = 30;
const THROW_SPEED = 8;

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

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// #region blocks

interface Block {
  id: number;
  pos: Position;
  color: BlockColor;
  state: BlockState;
  timer: number;
  star: boolean;
  tweenRect?: Rectangle;
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

const blockStates = ["idle", "lifted", "thrown", "ground", "falling", "solving"] as const;
type BlockState = typeof blockStates[number];

function blockIsPickable(block: Block): boolean {
  return block.state === "idle" || block.state === "ground" || block.state === "falling" || block.state === "solving";
}

function blockIsSolvable(block: Block): boolean {
  return block.state === "idle" || block.state === "ground" || block.state === "solving";
}

function blocksMatch(block1: Block, block2: Block): boolean {
  if (!blockIsSolvable(block1) || !blockIsSolvable(block2)) {
    return false;
  }
  return block1.color === block2.color;
}

function blockRectangle(block: Block): Rectangle {
  return {
    x: block.pos.x - BLOCK_SIZE * 0.5,
    y: block.pos.y - BLOCK_SIZE,
    width: BLOCK_SIZE,
    height: BLOCK_SIZE
  };
}

function blockVisualRectangle(block: Block): Rectangle {
  const targetRect: Rectangle = {
    x: block.pos.x - BLOCK_SIZE * 0.5,
    y: block.pos.y - BLOCK_SIZE,
    width: BLOCK_SIZE,
    height: BLOCK_SIZE
  };

  let tweenTime = 0;
  if (block.state === "lifted") {
    targetRect.width *= 0.5;
    targetRect.height *= 0.5;
    targetRect.x = block.pos.x - targetRect.width * 0.5;
    targetRect.y = block.pos.y - targetRect.height;
    tweenTime = 10;
  }
  if (block.state === "thrown") {
    targetRect.width *= 0.25;
    targetRect.x = block.pos.x - targetRect.width * 0.5;
    targetRect.y = block.pos.y - targetRect.height;
    tweenTime = 10;
  }

  if (tweenTime > 0 && block.tweenRect) {
    targetRect.x = lerp(block.tweenRect.x, targetRect.x, clamp01(block.timer / tweenTime));
    targetRect.y = lerp(block.tweenRect.y, targetRect.y, clamp01(block.timer / tweenTime));
    targetRect.width = lerp(block.tweenRect.width, targetRect.width, clamp01(block.timer / tweenTime));
    targetRect.height = lerp(block.tweenRect.height, targetRect.height, clamp01(block.timer / tweenTime));
  }

  return targetRect;
}

function blockMoveAndCollide(state: GameState, block: Block, movementX: number, movementY: number) {
  const myRect = blockRectangle(block);
  myRect.x += movementX;
  myRect.y += movementY;
  
  for (const otherBlock of state.blocks) {
    if (!blockIsPickable(otherBlock)) {
      continue;
    }
    if (block.id === otherBlock.id) {
      continue;
    }
    const blockRect = blockRectangle(otherBlock);
    let nudgeX = 0;
    let nudgeY = 0;

    if (checkAABB(myRect, blockRect)) {
      if (movementX < 0 && blockRect.x + blockRect.width > myRect.x) {
        nudgeX = -(myRect.x - (blockRect.x + blockRect.width)) + movementX;
      }
      if (movementX > 0 && blockRect.x < myRect.x + myRect.width) {
        nudgeX = -(myRect.x + myRect.width - blockRect.x) + movementX;
      }
      if (movementY < 0 && blockRect.y + blockRect.height > myRect.y) {
        nudgeY = -(myRect.y - (blockRect.y + blockRect.height)) + movementY;
      }
      if (movementY > 0 && blockRect.y < myRect.y + myRect.height) {
        nudgeY = -(myRect.y + myRect.height - blockRect.y) + movementY;
      }
      addPosition(nudgeX, nudgeY, block.pos);
      return false;
    }
  }

  // no collision, move block to new position
  addPosition(movementX, movementY, block.pos);

  return true;
}

function blockSettle(state: GameState, block: Block) {
  // make sure we're iy-1 of the block we're sitting on
  const pickRect: Rectangle = {
    x: block.pos.x,
    y: block.pos.y,
    width: BLOCK_SIZE,
    height: 4
  }
  const nextBlock = state.blocks.find(b => b.id !== block.id && checkAABB(pickRect, blockRectangle(b)));
  if (nextBlock) {
    block.pos = {
      x: block.pos.x,
      y: nextBlock.pos.y - BLOCK_SIZE,
      ix: block.pos.ix,
      iy: nextBlock.pos.iy - 1
    }
  }
  blockSetState(block, "ground");
}

function blockUpdate(state: GameState, block: Block) {
  block.timer += 1;
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
    case "thrown": {
      if (!blockMoveAndCollide(state, block, 0, THROW_SPEED)) {
        if (checkAABB(blockRectangle(block), playerRectangle(state.player))) {
          playerSetState(state.player, "floating");
        }
        blockSettle(state, block);
      }
      break;
    }
    case "ground": {
      if (blockMoveAndCollide(state, block, 0, FALL_SPEED)) {
        blockSetState(block, "falling");
      }
      break;
    }
    case "falling": {
      if (!blockMoveAndCollide(state, block, 0, FALL_SPEED)) {
        blockSettle(state, block);
      }
      break;
    }
    case "solving": {
      if (block.timer >= SOLVE_TIME) {
        state.blocks.splice(state.blocks.indexOf(block), 1);
        return;
      }
      break;
    }
  }
}

function blockSetState(block: Block, state: BlockState) {
  if (block.state === state) {
    return;
  }
  // capture the tweenRect before we switch the state
  block.tweenRect = blockVisualRectangle(block);
  block.state = state;
  block.timer = 0;
}


function checkSolutions(state: GameState) {
  let minY = state.player.pos.iy - BLOCK_ROW_BUFFER;
  let maxY = state.bottomRow;
  // for (const block of state.blocks) {
  //   maxY = Math.max(maxY, block.pos.iy);
  // }
  const height = maxY - minY + 1;
  const blockmap: (Block | undefined)[] = Array.from({ length: GRID_WIDTH * height });
  for (const block of state.blocks) {
    if (block.pos.iy < minY || block.pos.iy > maxY) {
      continue;
    }
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
        if (streak.find(block => block.state === "ground" || block.state === "solving")) {
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
        if (streak.find(block => block.state === "ground" || block.state === "solving")) {
          streaks.push(streak);
          streak.forEach(block => solvedBlocks.add(block));
        }
      }
    }
  }
  solvedBlocks.forEach(block => blockSetState(block, "solving"));
}

// #endregion block

// #region player

const playerStates = ["ground", "jumping", "falling", "wallride", "walljumping", "floating"] as const;
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

function checkAABB(rect1: Rectangle, rect2: Rectangle): boolean {
  return rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y;
}

function playerRectangle(player: Player): Rectangle {
  return {
    x: player.pos.x - player.width * 0.5,
    y: player.pos.y - BLOCK_SIZE * 0.9,
    width: player.width,
    height: BLOCK_SIZE * 0.9
  };
}

function collideBlock(state: GameState, rect: Rectangle): Block | null {
  return state.blocks.find(block => checkAABB(blockRectangle(block), rect)) || null;
}

function playerMoveAndCollide(state: GameState, player: Player, movementX: number, movementY: number) {
  const playerRect = playerRectangle(player);
  playerRect.x += movementX;
  playerRect.y += movementY;

  if (playerRect.x < 0) {
    addPosition(movementX - playerRect.x, 0, player.pos);
    return false;
  }
  if (playerRect.x + playerRect.width > GRID_WIDTH * BLOCK_SIZE) {
    addPosition(movementX + (GRID_WIDTH * BLOCK_SIZE - (playerRect.x + playerRect.width)), 0, player.pos);
    return false;
  }

  for (const block of state.blocks) {
    if (!blockIsPickable(block)) {
      continue;
    }
    const blockRect = blockRectangle(block);
    let nudgeX = 0;
    let nudgeY = 0;

    if (checkAABB(playerRect, blockRect)) {
      if (movementX < 0 && blockRect.x + blockRect.width > playerRect.x) {
        nudgeX = -(playerRect.x - (blockRect.x + blockRect.width)) + movementX;
      }
      if (movementX > 0 && blockRect.x < playerRect.x + playerRect.width) {
        nudgeX = -(playerRect.x + playerRect.width - blockRect.x) + movementX;
      }
      if (movementY < 0 && blockRect.y + blockRect.height > playerRect.y) {
        nudgeY = -(playerRect.y - (blockRect.y + blockRect.height)) + movementY;
      }
      if (movementY > 0 && blockRect.y < playerRect.y + playerRect.height) {
        nudgeY = -(playerRect.y + playerRect.height - blockRect.y) + movementY;
      }
      addPosition(nudgeX, nudgeY, player.pos);
      return false;
    }
  }

  // no collision, move player to new position
  addPosition(movementX, movementY, player.pos);

  return true;
}

function onGround(state: GameState, player: Player) {
  const pickRect = {
    x: player.pos.x - player.width * 0.5,
    y: player.pos.y,
    width: player.width,
    height: BLOCK_SIZE * 0.25
  }
  const block = state.blocks.find(block => checkAABB(pickRect, blockRectangle(block)));
  if (block) {
    return block;
  }
  return null;
}

function playerUpdate(state: GameState, player: Player, controller: Controller) {
  switch (player.state) {
    // #region ground
    case "ground": {
      const inBlock = collideBlock(state, playerRectangle(player));
      if (inBlock && inBlock.state === "ground") {
        playerSetState(player, "floating");
        return;
      }

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
          blockSetState(block, "thrown");
          playerSetState(player, "jumping");
          return;
        }
      }

      if (playerMoveAndCollide(state, player, 0, FALL_SPEED)) {
        playerSetState(player, "falling");
        break;
      }

      const groundBlock = onGround(state, player);

      if (controller.a === 1 && player.blocks.length < MAX_BLOCKS && groundBlock) {
        blockSetState(groundBlock, "lifted");
        player.blocks.push(groundBlock);
      }

      playerMoveAndCollide(state, player, movementX, 0);

      if (controller.up === 1) {
        playerSetState(player, "jumping");
      }

      if (!groundBlock) {
        playerSetState(player, "falling");
      }
      break;
    }
    // #endregion ground
    // #region jumping
    case "jumping": {
      let movementX = 0;
      if (controller.left > 0) {
        movementX -= player.speed;
      }
      if (controller.right > 0) {
        movementX += player.speed;
      }

      const inBlock = collideBlock(state, playerRectangle(player));
      if (inBlock && inBlock.state === "falling") {
        playerSetState(player, "floating");
        return;
      }

      if (controller.b === 1) {
        const block = player.blocks.shift();
        if (block) {
          setPosition((Math.floor(player.pos.x / BLOCK_SIZE) + 0.5) * BLOCK_SIZE, player.pos.y, block.pos);
          blockSetState(block, "thrown");
          playerSetState(player, "jumping");
          return;
        }
      }

      playerMoveAndCollide(state, player, movementX, 0);

      if (!playerMoveAndCollide(state, player, 0, -5 * (player.jumpTime / 30))) {
        playerSetState(player, "falling");
      }
      if (player.jumpTime > 0) {
        player.jumpTime--;
      } else {
        playerSetState(player, "falling");
      }
      break;
    }
    // #endregion jumping
    // #region falling
    case "falling": {
      const inBlock = collideBlock(state, playerRectangle(player));
      if (inBlock && inBlock.state === "falling") {
        playerSetState(player, "floating");
        return;
      }

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
          blockSetState(block, "thrown");
          playerSetState(player, "jumping");
          return;
        }
      }

      if (player.jumpTime > 0 && controller.up === 1) {
        playerSetState(player, "jumping");
        return;
      }
      player.jumpTime--;

      let fallMultiplier = 1;
      if (controller.down > 0) {
        fallMultiplier = 2;
      }
      if (!playerMoveAndCollide(state, player, 0, FALL_SPEED * fallMultiplier)) {
        playerSetState(player, "ground");
        return;
      }

      if (!playerMoveAndCollide(state, player, movementX, 0)) {
        player.wallriding = movementX;
        playerSetState(player, "wallride");
        return;
      }
      break;
    }
    // #endregion falling
    // #region wallride
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
      if (!playerMoveAndCollide(state, player, 0, 1)) {
        playerSetState(player, "ground");
        return;
      }
      if (playerMoveAndCollide(state, player, player.wallriding || 0, 0)) {
        playerSetState(player, "falling");
      }
      break;
    }
    // #endregion wallride
    // #region walljumping
    case "walljumping": {
      if (!playerMoveAndCollide(state, player, player.wallriding || 0, 0)) {
        player.wallriding = -(player.wallriding || 0);
        playerSetState(player, "wallride");
        return;
      }
      if (!playerMoveAndCollide(state, player, 0, -4 * (player.jumpTime / 30))) {
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
    // #endregion walljumping
    // #region floating
    case "floating": {
      const inBlock = collideBlock(state, playerRectangle(player));
      if (!inBlock) {
        playerSetState(player, "jumping");
        return;
      }

      if (inBlock) {
        // move upward
        addPosition(0, -FLOAT_SPEED, player.pos);
      }
      break;
    }
    // #endregion floating
  }
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
      break;
    case "jumping":
      player.jumpTime = JUMP_TIME;
      break;
    case "walljumping":
      player.jumpTime = WALLJUMP_TIME;
      break;
    case "floating":
      player.jumpTime = FLOATING_TIME;
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

// #endregion player

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// #region state

interface GameState {
  time: number;
  seed: number;
  mode: "intro" | "playing" | "gameover";
  player: Player;
  camera: {
    pos: Position;
  };
  blocks: Array<Block>;
  nextBlockId: number;
  bottomRow: number;
  finishLineRow: number;
  debug: boolean;
  score: number;
}

function initialState(): GameState {
  return {
    time: 0,
    seed: 0,
    mode: "intro",
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
    bottomRow: 5,
    finishLineRow: 32,
    debug: false,
    score: 0,
  };
}

function createBlock(state: GameState, ix: number, iy: number, color: BlockColor): Block {
  const id = state.nextBlockId;
  state.nextBlockId += 1;
  const block: Block = {
    id,
    pos: {
      x: (ix + 0.5) * BLOCK_SIZE,
      y: iy * BLOCK_SIZE,
      ix,
      iy,
    },
    color,
    state: "idle",
    timer: 0,
    star: false,
  };
  state.blocks.push(block);
  return block;
}

function createBlockRow(state: GameState) {
  const row = ++state.bottomRow;
  for (let i = 0; i < GRID_WIDTH; i++) {
    if (Math.random() < 0.7) {
      createBlock(state, i, row, randomBlockColor());
    }
  }
  if (row % 6 === 5) {
    const ix = Math.floor(Math.random() * GRID_WIDTH * 2);
    const block = state.blocks.at(-ix);
    if (block) {
      block.star = true;
    }
  }
}

function randomBlockColor(): BlockColor {
  return blockColors[Math.floor(Math.random() * (3))];
}

// #endregion state

// #region modes

function updateIntro(state: GameState, controller: Controller) {
  state.camera.pos.y += 1;

  if (controller.a > 0) {
    state.mode = "playing";
    state.time = 0;
    state.camera.pos.y = 0;
  }
}

function updatePlaying(state: GameState, controller: Controller) {
  playerUpdate(state, state.player, controller);
  for (const block of state.blocks) {
    blockUpdate(state, block);
  }
  checkSolutions(state);
  setPosition(state.camera.pos.x, state.player.pos.y, state.camera.pos);

  while (state.player.pos.iy + BLOCK_ROW_BUFFER > state.bottomRow) {
    createBlockRow(state);
  }

  // sort blocks by y position descending
  state.blocks.sort((a, b) => b.pos.iy - a.pos.iy);
}

function updateGameOver(state: GameState, controller: Controller) {
  
}

function updateMode(state: GameState, controller: Controller) {
  switch (state.mode) {
    case "intro":
      updateIntro(state, controller);
      break;
    case "playing":
      updatePlaying(state, controller);
      break;
    case "gameover":
      updateGameOver(state, controller);
      break;
  }
}

function setCameraViewport(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.translate(SCREEN_WIDTH / 2 - state.camera.pos.x, SCREEN_HEIGHT / 2 - state.camera.pos.y);
}

function drawGridLines(ctx: CanvasRenderingContext2D, state: GameState) {
  // Draw grid lines
  ctx.beginPath();
  ctx.strokeStyle = "#92CBFA";
  ctx.lineWidth = 1;
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
}


function drawCenteredTextLine(ctx: CanvasRenderingContext2D, text: string, y: number) {
  const measurements = ctx.measureText(text);
  ctx.fillText(text, SCREEN_WIDTH / 2 - measurements.width / 2, y);
  y += measurements.fontBoundingBoxAscent + 10;
  return y;
}

function drawIntro(ctx: CanvasRenderingContext2D, rctx: RoughCanvas, state: GameState, seed: number) {
  ctx.save();
  setCameraViewport(ctx, state);
  drawGridLines(ctx, state);
  ctx.restore();

  ctx.font = "48px Indie Flower";
  let y = 100;
  // ctx.fillText(`state=${state.player.state} up=${controller.up} down=${controller.down} left=${controller.left} right=${controller.right} a=${controller.a} b=${controller.b}`, 10, 30);
  y = drawCenteredTextLine(ctx, "LD57 Depths", y);
  y += 20;

  ctx.font = "24px Indie Flower";
  const controls = "Keyboard Controls:\nWASD - Move/Jump\nJ - Lift Block\nK - Drop Block\n\nGamepad Controls:\nD-Pad - Move/Jump\nA - Lift Block\nB - Drop Block\nY - Jump";
  for (const line of controls.split("\n")) {
    y = drawCenteredTextLine(ctx, line, y);
  }
}

function drawPlaying(ctx: CanvasRenderingContext2D, rctx: RoughCanvas, state: GameState, seed: number) {
  ctx.save();
  setCameraViewport(ctx, state);

  drawGridLines(ctx, state);

  // Draw blocks
  for (const block of state.blocks) {
    const colorStr = blockColorString(block.color);
    const visualRect = blockVisualRectangle(block);
    const blockStyle: Options = {
      seed,
      fill: colorStr,
      fillStyle: "cross-hatch",
      fillWeight: 1,
      hachureGap: 5,
      stroke: colorStr
    };
    if (block.state === "lifted") {
      blockStyle.fillStyle = "hachure";
      blockStyle.fillWeight = 1;
      blockStyle.hachureGap = 4;
    }
    if (block.state === "solving") {
      blockStyle.fillStyle = "dots";
      blockStyle.fillWeight = 2;
      blockStyle.hachureGap = 6;
      blockStyle.stroke = "none";
    } else if (block.state === "thrown") {
      blockStyle.fillStyle = "hachure";
      blockStyle.fillWeight = 1;
      blockStyle.hachureGap = 4;
    } else if (block.state === "idle") {
      blockStyle.seed = 1;
      blockStyle.fillStyle = "hachure";
      blockStyle.fillWeight = 1;
      blockStyle.hachureGap = 4;
    }
    rctx.rectangle(visualRect.x, visualRect.y, visualRect.width, visualRect.height, blockStyle);
    if (block.star) {
      drawStar(rctx, visualRect.x + visualRect.width / 2, visualRect.y + visualRect.height / 2, visualRect.width / 5, visualRect.height / 3, 5, { seed, fill: "#FFEFb0", fillStyle: "solid", stroke: "#FFD700", strokeWidth: 3, roughness: 1 });
    }
  }

  drawCapsule(rctx, state.player.pos.x - state.player.width / 2, state.player.pos.y - state.player.height, state.player.width, state.player.height, { seed, fill: "#C058F8", fillWeight: 5, hachureGap: 6, stroke: "#8131AC", strokeWidth: 3, roughness: 1 })

  if (state.debug) {
    // draw collision rectangles
    for (const block of state.blocks) {
      const blockRect = blockRectangle(block);
      ctx.beginPath();
      ctx.rect(blockRect.x, blockRect.y, blockRect.width, blockRect.height);
      ctx.strokeStyle = "#0f0";
      ctx.stroke();
      ctx.fillText(`${block.state} (${block.pos.ix}, ${block.pos.iy})`, blockRect.x, blockRect.y);
    }

    {
      ctx.beginPath();
      const playerRect = playerRectangle(state.player);
      ctx.rect(playerRect.x, playerRect.y, playerRect.width, playerRect.height);
      ctx.strokeStyle = "#00f";
      ctx.stroke();
    }
  }
  ctx.restore();
  // UI viewport

    // ctx.font = "48px Indie Flower";
    // ctx.fillStyle = "#000";
    // ctx.fillText("Hello World", 640, 360);

    // ctx.font = "30px Indie Flower";
    // ctx.fillText(`state=${state.player.state} up=${controller.up} down=${controller.down} left=${controller.left} right=${controller.right} a=${controller.a} b=${controller.b}`, 10, 30);
}

function drawGameOver(ctx: CanvasRenderingContext2D, rctx: RoughCanvas, state: GameState, seed: number) {

}

function drawMode(ctx: CanvasRenderingContext2D, rctx: RoughCanvas, state: GameState, seed: number) {
  switch (state.mode) {
    case "intro":
      drawIntro(ctx, rctx, state, seed);
      break;
    case "playing":
      drawPlaying(ctx, rctx, state, seed);
      break;
    case "gameover":
      drawGameOver(ctx, rctx, state, seed);
      break;
  }
}

// #endregion modes

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gamepads: Map<number, Gamepad> = new Map();

    canvas.style.backgroundColor = "#e0efff";
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;

    const rctx = rough.canvas(canvas);
    const onWindowResize = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
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

    for (let j = 0; j < BLOCK_ROW_BUFFER; j++) {
      createBlockRow(state);
    }

    const step = () => {
      updateMode(state, controller);

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
      ctx.scale(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);

      drawMode(ctx, rctx, state, seed);

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

function drawStar(rctx: RoughCanvas, x: number, y: number, innerRadius: number, outerRadius: number, pointCount: number, options: Options) {
  const radiansPerPoint = Math.PI * 2 / pointCount;
  const points: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = i * radiansPerPoint;
    points.push([x + Math.sin(angle - radiansPerPoint / 2) * innerRadius, y - Math.cos(angle - radiansPerPoint / 2) * innerRadius]);
    points.push([x + Math.sin(angle) * outerRadius, y - Math.cos(angle) * outerRadius]);
  }
  rctx.polygon(points, options);
}

export default App;
