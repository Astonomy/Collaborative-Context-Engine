<script setup lang="ts">
import { contextPath } from "../api/context";
import { finalizeMergeRequestResponseSchema } from "@cce/api-contracts";
import { useRoute } from "vue-router";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import ResourceState from "../components/ResourceState.vue";
// Reuse the existing public commit response shape without importing server code.
const commitsSchema = finalizeMergeRequestResponseSchema.options[0].shape.commit.array();
const route = useRoute();
const { session } = useAppContext();
const { data, loading, error, reload } = useResource(
  session.client,
  () => contextPath(String(route.params["projectId"])) + "/commits",
  commitsSchema,
);
</script>
<template>
  <h2>Commit history</h2>
  <ResourceState :loading="loading" :error="error" @retry="reload"
    ><p v-if="data?.length === 0">No commits.</p>
    <ol>
      <li v-for="commit in data" :key="commit.id">
        <article>
          <h3>{{ commit.summary }}</h3>
          <code>{{ commit.id }}</code>
          <p>
            Version {{ commit.version }} · {{ commit.kind }} · {{ commit.changes.length }} semantic
            changes
          </p>
          <time>{{ commit.createdAt }}</time>
        </article>
      </li>
    </ol></ResourceState
  >
</template>
