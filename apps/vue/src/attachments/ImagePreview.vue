<script setup lang="ts">
import { computed } from "vue";
import type { AttachmentResponse } from "@cce/api-contracts";
import { contentUrl, type Inspection } from "./presentation";
import type { ApiClient } from "../data/api-client";
const props = defineProps<{
  attachment: AttachmentResponse;
  client?: ApiClient;
  inspection: Inspection;
}>();
const emit = defineEmits<{ failed: [] }>();
const dimensions = computed(() => props.inspection.description.metadata);
</script>
<template>
  <img
    class="attachment-full-image"
    :src="contentUrl(attachment)"
    crossorigin="use-credentials"
    :alt="attachment.originalFilename"
    :width="dimensions.width"
    :height="dimensions.height"
    @error="emit('failed')"
  />
</template>
