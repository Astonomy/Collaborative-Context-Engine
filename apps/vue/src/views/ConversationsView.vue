<script setup lang="ts">
import { conversationsPath } from "../api/conversations";
import { conversationListResponseSchema, conversationResponseSchema } from "@cce/api-contracts";
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ResourceState from "../components/ResourceState.vue";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import { useAction } from "../data/use-action";
import { useProject } from "../project-context";
const route = useRoute();
const router = useRouter();
const { session } = useAppContext();
const { access } = useProject();
const path = () => conversationsPath(String(route.params["projectId"]));
const { data, loading, error, reload } = useResource(
  session.client,
  path,
  conversationListResponseSchema,
);
const title = ref("");
const canCreate = computed(
  () => access.value?.member.role !== "viewer" && access.value?.project.archivedAt === null,
);
const { busy, error: actionError, perform } = useAction();
function create() {
  return perform(async (signal) => {
    if (!canCreate.value || !access.value) return;
    const conversation = await session.client.json(path(), conversationResponseSchema, {
      method: "POST",
      body: JSON.stringify({ title: title.value }),
      signal,
    });
    await router.push({
      name: "conversation",
      params: { projectId: access.value.project.id, conversationId: conversation.id },
    });
  });
}
</script>
<template>
  <h2>Conversations</h2>
  <form @submit.prevent="create">
    <label for="new-conversation">New conversation</label
    ><input
      id="new-conversation"
      v-model="title"
      maxlength="200"
      required
      :disabled="!canCreate"
    /><button :disabled="busy || !canCreate || !title.trim()">Create conversation</button>
  </form>
  <p v-if="!canCreate">Read-only access</p>
  <p v-if="actionError" role="alert">{{ actionError }}</p>
  <ResourceState :loading="loading" :error="error" @retry="reload"
    ><p v-if="data?.length === 0">No conversations yet.</p>
    <ul class="resource-list">
      <li v-for="conversation in data" :key="conversation.id">
        <RouterLink
          :to="{
            name: 'conversation',
            params: { projectId: route.params['projectId'], conversationId: conversation.id },
          }"
          >{{ conversation.title }}</RouterLink
        ><span>{{ conversation.status }}</span>
      </li>
    </ul></ResourceState
  >
</template>
