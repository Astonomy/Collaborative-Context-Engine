<script setup lang="ts">
import { projectPath as projectApiPath } from "../api/projects";
import { mergeRequestListResponseSchema } from "@cce/api-contracts";
import { RouterLink, useRoute } from "vue-router";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import ResourceState from "../components/ResourceState.vue";
import MergeReview from "../components/MergeReview.vue";
const route = useRoute();
const { session } = useAppContext();
const { data, loading, error, reload } = useResource(
  session.client,
  () => projectApiPath(String(route.params["projectId"])) + "/merge-requests",
  mergeRequestListResponseSchema,
);
</script>
<template>
  <h2>Merge requests</h2>
  <ResourceState :loading="loading" :error="error" @retry="reload"
    ><p v-if="data?.length === 0">
      No merge requests. Extract a Delta from a conversation to begin review.
    </p>
    <ul class="resource-list">
      <li v-for="request in data" :key="request.id">
        <RouterLink
          :to="{
            name: 'merges',
            params: { projectId: route.params['projectId'], mergeId: request.id },
          }"
          >{{ request.id }}</RouterLink
        ><span>{{ request.status }} · {{ request.updatedAt }}</span>
      </li>
    </ul></ResourceState
  ><MergeReview
    v-if="route.params['mergeId']"
    :key="String(route.params['mergeId'])"
    :project-id="String(route.params['projectId'])"
    :merge-id="String(route.params['mergeId'])"
    @updated="reload"
  />
</template>
