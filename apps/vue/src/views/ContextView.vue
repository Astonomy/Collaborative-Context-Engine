<script setup lang="ts">
import { contextPath } from "../api/context";
import { contextSnapshotResponseSchema } from "@cce/api-contracts";
import { useRoute } from "vue-router";
import { useAppContext } from "../context";
import { useResource } from "../data/use-resource";
import ResourceState from "../components/ResourceState.vue";
const route = useRoute();
const { session } = useAppContext();
const { data, loading, error, reload } = useResource(
  session.client,
  () => contextPath(String(route.params["projectId"])),
  contextSnapshotResponseSchema,
);
</script>
<template>
  <h2>Canonical context</h2>
  <ResourceState :loading="loading" :error="error" @retry="reload"
    ><template v-if="data"
      ><p>HEAD {{ data.commitId }}</p>
      <p v-if="!data.items.length">
        No canonical items yet. Extract, review and commit conversation evidence.
      </p>
      <article v-for="item in data.items" :key="item.id" class="context-card">
        <h3>{{ item.key }}</h3>
        <p>{{ item.kind }} · {{ item.lifecycle }}</p>
        <pre>{{ JSON.stringify(item.value, null, 2) }}</pre>
        <dl>
          <dt>Authority</dt>
          <dd>{{ item.authority }}</dd>
          <dt>Confidence</dt>
          <dd>{{ Math.round(item.confidence * 100) }}%</dd>
          <dt>Evidence</dt>
          <dd>
            {{ item.provenance.reduce((sum, entry) => sum + entry.messageIds.length, 0) }} messages
          </dd>
          <dt>Recorded</dt>
          <dd>{{ item.createdAt }}</dd>
        </dl>
        <details>
          <summary>Provenance</summary>
          <pre>{{ JSON.stringify(item.provenance, null, 2) }}</pre>
        </details>
      </article></template
    ></ResourceState
  >
</template>
