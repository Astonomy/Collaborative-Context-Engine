<script setup lang="ts">
import type { AttachmentResponse } from "@cce/api-contracts";
import type { ApiClient } from "../data/api-client";
import AttachmentRenderer from "./AttachmentRenderer.vue";
defineProps<{ attachments: AttachmentResponse[]; client: ApiClient }>();
</script>
<template>
  <section
    v-if="attachments.length"
    class="attachment-collection"
    :class="{ 'is-collected': attachments.length > 5 }"
    aria-label="Message attachments"
    :tabindex="attachments.length > 5 ? 0 : undefined"
  >
    <p v-if="attachments.length > 5" class="attachment-collection-label">
      {{ attachments.length }} attachments · Hover or focus to expand
    </p>
    <div class="attachment-collection-reveal">
      <div class="attachment-grid">
        <AttachmentRenderer
          v-for="attachment in attachments"
          :key="attachment.id"
          :attachment="attachment"
          :client="client"
        />
      </div>
    </div>
  </section>
</template>
