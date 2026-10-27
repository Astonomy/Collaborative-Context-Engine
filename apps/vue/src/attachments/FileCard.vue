<script setup lang="ts">
import type { AttachmentResponse } from "@cce/api-contracts";
import { contentUrl, formatBytes } from "./presentation";
defineProps<{ attachment: AttachmentResponse; model?: boolean }>();
</script>
<template>
  <div class="attachment-metadata">
    <span aria-hidden="true">{{ model ? "◇" : "▤" }}</span>
    <strong>{{ attachment.originalFilename }}</strong>
    <small>{{ attachment.detectedMimeType }} · {{ formatBytes(attachment.byteSize) }}</small>
    <span v-if="model">Model file</span>
    <a
      :href="contentUrl(attachment)"
      download
      :aria-label="`Download ${attachment.originalFilename}`"
      >Download</a
    >
  </div>
</template>
