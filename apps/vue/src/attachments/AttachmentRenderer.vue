<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  h,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  ref,
  shallowRef,
} from "vue";
import type { AttachmentResponse } from "@cce/api-contracts";
import type { ApiClient } from "../data/api-client";
import { contentPath, inspectionSchema, rendererFor, type Inspection } from "./presentation";
import { previewPath } from "./preview-path";
import FileCard from "./FileCard.vue";
import ImagePreview from "./ImagePreview.vue";
import VideoPreview from "./VideoPreview.vue";
const ModelPreview = defineAsyncComponent({
  loader: () => import("./ModelPreview.vue"),
  delay: 0,
  timeout: 15_000,
  loadingComponent: defineComponent(() => () => h("p", { role: "status" }, "Loading 3D viewer…")),
});
const props = defineProps<{
  attachment: AttachmentResponse;
  client: ApiClient;
  capability?: Inspection;
  full?: boolean;
}>();
const root = ref<HTMLElement>();
const visible = ref(false);
const failed = ref(false);
const loading = ref(false);
const inspection = shallowRef<Inspection | null>(null);
const controller = new AbortController();
let observer: IntersectionObserver | undefined;
const kind = computed(() =>
  failed.value ? "file" : rendererFor(props.attachment, inspection.value),
);
async function inspect() {
  if (visible.value) return;
  visible.value = true;
  loading.value = true;
  observer?.disconnect();
  try {
    inspection.value = props.capability
      ? inspectionSchema.parse(props.capability)
      : await props.client.json(
          contentPath(props.attachment).replace(/\/content$/, "/inspection"),
          inspectionSchema,
          { signal: controller.signal },
        );
  } catch {
    if (!controller.signal.aborted) failed.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  if (typeof IntersectionObserver === "undefined") {
    void inspect();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void inspect();
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  controller.abort();
  observer?.disconnect();
});
onErrorCaptured(() => {
  failed.value = true;
  return false;
});
</script>
<template>
  <section
    ref="root"
    class="attachment-card"
    :aria-label="`Attachment ${attachment.originalFilename}`"
  >
    <FileCard :attachment="attachment" :model="kind === 'model' || kind === 'model-file'" />
    <p v-if="loading" role="status">Checking preview…</p>
    <p v-if="failed" role="status">Preview unavailable. Download the original file.</p>
    <ImagePreview
      v-if="kind === 'image' && inspection"
      :attachment="attachment"
      :inspection="inspection"
      :client="client"
      @failed="failed = true"
    />
    <VideoPreview v-else-if="kind === 'video'" :attachment="attachment" @failed="failed = true" />
    <ModelPreview
      v-else-if="kind === 'model'"
      :client="client"
      :attachment="attachment"
      @failed="failed = true"
    />
    <a
      v-if="!full"
      class="attachment-open"
      :href="previewPath(attachment)"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`View full content ${attachment.originalFilename}`"
      >View full content ↗</a
    >
  </section>
</template>
