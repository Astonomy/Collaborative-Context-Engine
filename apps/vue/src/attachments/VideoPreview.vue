<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { AttachmentResponse } from "@cce/api-contracts";
import { contentUrl } from "./presentation";
defineProps<{ attachment: AttachmentResponse }>();
const emit = defineEmits<{ failed: [] }>();
const video = ref<HTMLVideoElement>();
onBeforeUnmount(() => {
  video.value?.pause();
  video.value?.removeAttribute("src");
  video.value?.load();
});
</script>
<template>
  <video
    ref="video"
    :src="contentUrl(attachment)"
    crossorigin="use-credentials"
    controls
    playsinline
    preload="metadata"
    :aria-label="attachment.originalFilename"
    @error="emit('failed')"
  >
    Video playback is unavailable. Use the download link.
  </video>
</template>
