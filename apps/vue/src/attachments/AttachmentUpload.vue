<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { AttachmentResponse } from "@cce/api-contracts";
import type { ApiClient } from "../data/api-client";
import { validateFile, type UploadTarget } from "./upload";
const props = defineProps<{ client: ApiClient; target: UploadTarget; disabled: boolean }>();
const emit = defineEmits<{ uploaded: [attachment: AttachmentResponse] }>();
const selected = shallowRef<File | null>(null);
const clientMessageId = ref("");
const error = ref("");
const status = ref("");
const busy = ref(false);
const progress = ref(0);
let controller: AbortController | undefined;
function choose(files: FileList | null | undefined) {
  if (props.disabled || busy.value) return;
  error.value = "";
  status.value = "";
  selected.value = null;
  if (!files?.length) return;
  if (files.length !== 1) {
    error.value = "Choose one file at a time.";
    return;
  }
  const file = files.item(0);
  if (!file) return;
  const invalid = validateFile(file);
  if (invalid) {
    error.value = invalid;
    return;
  }
  selected.value = file;
  clientMessageId.value = crypto.randomUUID();
}
function picked(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    choose(event.target.files);
    event.target.value = "";
  }
}
async function upload() {
  if (!selected.value || props.disabled || busy.value) return;
  busy.value = true;
  error.value = "";
  status.value = "";
  progress.value = 0;
  const request = new AbortController();
  controller = request;
  const target = { ...props.target };
  try {
    const result = await props.client.upload(
      target,
      selected.value,
      clientMessageId.value,
      (value) => {
        if (!request.signal.aborted) progress.value = value;
      },
      request.signal,
    );
    if (request.signal.aborted) return;
    emit("uploaded", result);
    selected.value = null;
    status.value = "Attachment saved as a new message.";
  } catch (failure: unknown) {
    if (!request.signal.aborted)
      error.value = failure instanceof Error ? failure.message : "Upload failed.";
  } finally {
    if (controller === request) busy.value = false;
  }
}
function cancel() {
  controller?.abort();
  status.value =
    "Upload canceled. Retry checks the same upload; a completed server commit may already exist.";
}
watch(
  () => [props.target.projectId, props.target.conversationId],
  () => {
    controller?.abort();
    selected.value = null;
    error.value = "";
    status.value = "";
  },
);
watch(
  () => props.disabled,
  (value) => {
    if (value) controller?.abort();
  },
);
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <section
    class="attachment-upload"
    aria-label="Upload attachment"
    @dragover.prevent
    @drop.prevent="choose($event.dataTransfer?.files)"
  >
    <label
      >Choose attachment<input type="file" :disabled="disabled || busy" @change="picked"
    /></label>
    <p>
      Drop one file here (up to 100 MiB). Each upload creates a new message in this conversation.
    </p>
    <p v-if="selected">{{ selected.name }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="status" role="status">{{ status }}</p>
    <template v-if="busy">
      <progress :value="progress" max="100" aria-label="Attachment upload progress" />
      <span role="status">{{
        progress === 100 ? "Validating and saving…" : `Uploading ${progress}%`
      }}</span>
      <button @click="cancel">Cancel upload</button>
    </template>
    <button v-else :disabled="disabled || !selected" @click="upload">
      {{ error || status.startsWith("Upload canceled") ? "Retry upload" : "Upload attachment" }}
    </button>
  </section>
</template>
