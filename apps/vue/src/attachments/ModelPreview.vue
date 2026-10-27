<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { AttachmentResponse } from "@cce/api-contracts";
import { contentPath, modelByteLimit } from "./presentation";
import type { ApiClient } from "../data/api-client";
import { readContent } from "./read-content";
import type { ModelGeometry } from "./model-geometry";
import { inspectModel } from "./model-worker-client";
const props = defineProps<{ attachment: AttachmentResponse; client?: ApiClient }>();
const emit = defineEmits<{ failed: [] }>();
const canvas = ref<HTMLCanvasElement>();
const loading = ref(true);
const count = ref(0);
const controller = new AbortController();
let geometry: ModelGeometry | undefined;
let yaw = 0.4,
  pitch = 0.3,
  zoom = 1;
let pointer: { id: number; x: number; y: number } | undefined;
function draw() {
  const context = canvas.value?.getContext("2d");
  if (!context || !geometry) return;
  context.clearRect(0, 0, 640, 480);
  context.fillStyle = "#101c2c";
  context.fillRect(0, 0, 640, 480);
  context.strokeStyle = "#8ed4ff";
  context.lineWidth = 1;
  context.beginPath();
  const values = geometry.triangles;
  for (let i = 0; i < values.length; i += 3) {
    const x = values[i] ?? 0,
      y = values[i + 1] ?? 0,
      z = values[i + 2] ?? 0;
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
    const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
    const px = 320 + rx * 320 * zoom,
      py = 240 - ry * 320 * zoom;
    if (i % 9 === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
    if (i % 9 === 6) context.closePath();
  }
  context.stroke();
}
function rotate(horizontal: number, vertical = 0) {
  yaw += horizontal;
  pitch += vertical;
  draw();
}
function scale(amount: number) {
  zoom = Math.max(0.25, Math.min(4, zoom * amount));
  draw();
}
function key(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "+") scale(1.2);
  else if (event.key === "-") scale(1 / 1.2);
  else
    rotate(
      event.key === "ArrowLeft" ? -0.15 : event.key === "ArrowRight" ? 0.15 : 0,
      event.key === "ArrowUp" ? -0.15 : event.key === "ArrowDown" ? 0.15 : 0,
    );
}
function start(event: PointerEvent) {
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.value?.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  rotate((event.clientX - pointer.x) * 0.01, (event.clientY - pointer.y) * 0.01);
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
}
onMounted(async () => {
  try {
    const bytes = await readContent(
      contentPath(props.attachment),
      modelByteLimit,
      controller.signal,
      props.client,
    );
    if (controller.signal.aborted) return;
    geometry = await inspectModel(bytes, controller.signal);
    if (controller.signal.aborted) return;
    if (!canvas.value?.getContext("2d")) throw new Error("Canvas unavailable.");
    count.value = geometry.triangleCount;
    loading.value = false;
    draw();
  } catch {
    if (!controller.signal.aborted) emit("failed");
  }
});
onBeforeUnmount(() => {
  controller.abort();
  geometry = undefined;
  pointer = undefined;
});
</script>
<template>
  <p v-if="loading" role="status">Loading 3D preview…</p>
  <p>Wireframe preview · {{ count }} triangles. Drag or use arrow keys to rotate; + / − to zoom.</p>
  <canvas
    ref="canvas"
    width="640"
    height="480"
    tabindex="0"
    role="img"
    :aria-label="`Interactive wireframe of ${attachment.originalFilename}. Arrow keys rotate; plus and minus zoom.`"
    @keydown="key"
    @pointerdown="start"
    @pointermove="move"
    @pointerup="pointer = undefined"
    @pointercancel="pointer = undefined"
    @lostpointercapture="pointer = undefined"
  />
  <div aria-label="3D controls">
    <button @click="rotate(-0.2)">Rotate left</button
    ><button @click="rotate(0.2)">Rotate right</button> <button @click="scale(1.2)">Zoom in</button
    ><button @click="scale(1 / 1.2)">Zoom out</button>
    <button
      @click="
        yaw = 0.4;
        pitch = 0.3;
        zoom = 1;
        draw();
      "
    >
      Reset view
    </button>
  </div>
</template>
