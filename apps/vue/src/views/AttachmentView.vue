<script setup lang="ts">
import { attachmentsPath } from "../api/attachments";

import { attachmentResponseSchema } from "@cce/api-contracts";
import { useRoute } from "vue-router";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import ResourceState from "../components/ResourceState.vue";
import AttachmentRenderer from "../attachments/AttachmentRenderer.vue";
const route = useRoute();
const { session } = useAppContext();
const attachment = useResource(
  session.client,
  () =>
    attachmentsPath(String(route.params["projectId"])) +
    "/" +
    encodeURIComponent(String(route.params["attachmentId"])),
  attachmentResponseSchema,
);
</script>
<template>
  <ResourceState
    :loading="attachment.loading.value"
    :error="attachment.error.value"
    @retry="attachment.reload"
  >
    <div v-if="attachment.data.value" class="attachment-view">
      <h2>{{ attachment.data.value.originalFilename }}</h2>
      <AttachmentRenderer
        :key="attachment.data.value.id"
        :attachment="attachment.data.value"
        :client="session.client"
        full
      />
    </div>
  </ResourceState>
</template>
