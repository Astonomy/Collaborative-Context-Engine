<script setup lang="ts">
import { projectsPath } from "../api/projects";
import { projectListResponseSchema, projectResponseSchema } from "@cce/api-contracts";
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import ResourceState from "../components/ResourceState.vue";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import { useAction } from "../data/use-action";
const { session } = useAppContext();
const router = useRouter();
const { data, loading, error, reload } = useResource(
  session.client,
  () => projectsPath,
  projectListResponseSchema,
);
const name = ref("");
const { busy, error: actionError, perform } = useAction();
function create() {
  return perform(async (signal) => {
    const project = await session.client.json(projectsPath, projectResponseSchema, {
      method: "POST",
      body: JSON.stringify({ name: name.value }),
      signal,
    });
    await router.push({ name: "project", params: { projectId: project.id } });
  });
}
</script>
<template>
  <section class="panel">
    <h1>Projects</h1>
    <form @submit.prevent="create">
      <label for="new-project">New project</label
      ><input id="new-project" v-model="name" required maxlength="160" /><button
        :disabled="busy || !name.trim()"
      >
        Create project
      </button>
    </form>
    <p v-if="actionError" role="alert">{{ actionError }}</p>
    <ResourceState :loading="loading" :error="error" @retry="reload">
      <p v-if="data?.length === 0">No accessible projects yet.</p>
      <ul class="resource-list">
        <li v-for="access in data" :key="access.project.id">
          <RouterLink :to="{ name: 'project', params: { projectId: access.project.id } }">{{
            access.project.name
          }}</RouterLink
          ><span
            >{{ access.member.role }} ·
            {{ access.project.archivedAt ? "archived" : "v" + access.project.version }}</span
          >
        </li>
      </ul>
    </ResourceState>
  </section>
</template>
