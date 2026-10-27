<script setup lang="ts">
import { projectPath as projectApiPath } from "../api/projects";
import { projectAccessResponseSchema, projectResponseSchema } from "@cce/api-contracts";
import { computed, provide, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import ResourceState from "../components/ResourceState.vue";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import { useAction } from "../data/use-action";
import { projectContextKey } from "../project-context";
const route = useRoute();
const { session } = useAppContext();
const { data, loading, error, reload } = useResource(
  session.client,
  () => projectApiPath(String(route.params["projectId"])),
  projectAccessResponseSchema,
);
provide(projectContextKey, { access: data, reload });
const name = ref("");
const { busy, error: actionError, perform } = useAction();
const canManage = computed(
  () => data.value?.member.role === "owner" && data.value.project.archivedAt === null,
);
function update(update: { name?: string; archive?: true }) {
  return perform(async (signal) => {
    if (!canManage.value || !data.value) return;
    const project = await session.client.json(
      projectApiPath(data.value.project.id),
      projectResponseSchema,
      { method: "PATCH", body: JSON.stringify(update), signal },
    );
    data.value = { ...data.value, project };
  });
}
</script>
<template>
  <RouterLink to="/projects">← All projects</RouterLink>
  <section class="panel">
    <ResourceState :loading="loading" :error="error" @retry="reload"
      ><template v-if="data">
        <h1>{{ data.project.name }}</h1>
        <p>
          {{ data.member.role }} · Version {{ data.project.version }} · HEAD
          {{ data.project.headCommitId }}
        </p>
        <p v-if="data.project.archivedAt">Archived project · read-only</p>
        <form v-if="data.member.role === 'owner'" @submit.prevent="update({ name })">
          <label for="rename-project">Project name</label
          ><input
            id="rename-project"
            v-model="name"
            :placeholder="data.project.name"
            maxlength="160"
            required
            :disabled="busy || !canManage"
          /><button :disabled="busy || !canManage || !name.trim()">Rename project</button
          ><button type="button" :disabled="busy || !canManage" @click="update({ archive: true })">
            Archive project
          </button>
        </form>
        <p v-if="actionError" role="alert">{{ actionError }}</p>
        <nav aria-label="Project navigation">
          <RouterLink :to="{ name: 'project', params: { projectId: data.project.id } }"
            >Overview</RouterLink
          ><RouterLink
            v-for="entry in ['conversations', 'context', 'history', 'merges']"
            :key="entry"
            :to="{ name: entry, params: { projectId: data.project.id } }"
            >{{
              entry === "merges" ? "Merge review" : entry.charAt(0).toUpperCase() + entry.slice(1)
            }}</RouterLink
          >
        </nav>
        <RouterView
          :key="
            String(route.params['projectId']) + ':' + String(route.params['conversationId'] ?? '')
          "
        /> </template
    ></ResourceState>
  </section>
</template>
