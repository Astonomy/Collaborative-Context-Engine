<script setup lang="ts">
import {
  mergeRequestDetailResponseSchema,
  resolveMergeConflictResponseSchema,
  finalizeMergeRequestResponseSchema,
  projectAccessResponseSchema,
} from "@cce/api-contracts";
import { computed, ref } from "vue";
import { useAppContext } from "../context";
import { useProject } from "../project-context";
import { useResource } from "../data/use-resource";
import { useAction } from "../data/use-action";
import ResourceState from "./ResourceState.vue";
import ConflictReview from "./ConflictReview.vue";
const props = defineProps<{ projectId: string; mergeId: string }>();
const emit = defineEmits<{ updated: [] }>();
const { session } = useAppContext();
const { access } = useProject();
const path =
  "/api/projects/" +
  encodeURIComponent(props.projectId) +
  "/merge-requests/" +
  encodeURIComponent(props.mergeId);
const {
  data,
  error: loadError,
  loading,
  reload,
} = useResource(session.client, () => path, mergeRequestDetailResponseSchema);
const { busy, error, perform } = useAction();
const notice = ref("");
const stale = computed(
  () => data.value?.request.evaluatedHeadCommitId !== access.value?.project.headCommitId,
);
const canWrite = computed(
  () => access.value?.member.role !== "viewer" && access.value?.project.archivedAt === null,
);
let finalizeAttempt: { head: string; key: string } | undefined;
function refresh() {
  return perform(async (signal) => {
    access.value = await session.client.json(
      "/api/projects/" + encodeURIComponent(props.projectId),
      projectAccessResponseSchema,
      { signal },
    );
    await reload();
    emit("updated");
  });
}
function resolve(
  id: string,
  choice: "keep_current" | "accept_proposed" | "keep_alternative",
  rationale: string,
) {
  return perform(async (signal) => {
    if (!canWrite.value || stale.value) return;
    await session.client.json(
      path + "/conflicts/" + id + "/resolution",
      resolveMergeConflictResponseSchema,
      { method: "PUT", body: JSON.stringify({ choice, editedProposal: null, rationale }), signal },
    );
    await reload();
    emit("updated");
  });
}
function finalize() {
  return perform(async (signal) => {
    if (!canWrite.value || stale.value || data.value?.request.status !== "ready" || !access.value)
      return;
    const head = access.value.project.headCommitId;
    if (!finalizeAttempt || finalizeAttempt.head !== head)
      finalizeAttempt = { head, key: crypto.randomUUID() };
    const result = await session.client.json(
      path + "/finalize",
      finalizeMergeRequestResponseSchema,
      {
        method: "POST",
        headers: { "idempotency-key": finalizeAttempt.key },
        body: JSON.stringify({
          expectedHeadCommitId: head,
          summary: "Merge reviewed proposal " + props.mergeId,
        }),
        signal,
      },
    );
    notice.value =
      result.outcome === "committed"
        ? "ContextCommit v" + result.commit.version + " is now canonical HEAD."
        : "Review completed without semantic changes.";
    access.value = await session.client.json(
      "/api/projects/" + encodeURIComponent(props.projectId),
      projectAccessResponseSchema,
      { signal },
    );
    await reload();
    emit("updated");
  });
}
</script>
<template>
  <section aria-label="Merge review">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <button :disabled="busy" @click="refresh">Reload latest state</button>
    <ResourceState :loading="loading" :error="loadError" @retry="reload"
      ><template v-if="data"
        ><h2>Review {{ data.request.id }}</h2>
        <p>{{ data.request.status }} · {{ data.conflicts.length }} proposed changes</p>
        <p v-if="stale && data.request.status !== 'committed'" role="alert">
          Canonical HEAD moved after evaluation. Return to the conversation and create a new review
          before finalizing.
        </p>
        <ConflictReview
          v-for="conflict in data.conflicts"
          :key="conflict.id"
          :conflict="conflict"
          :role="access?.member.role ?? 'viewer'"
          :disabled="
            busy || !canWrite || stale || !['reviewing', 'ready'].includes(data.request.status)
          "
          @resolve="resolve"
        /><button
          v-if="data.request.status === 'ready'"
          :disabled="busy || !canWrite || stale"
          @click="finalize"
        >
          Commit reviewed changes
        </button></template
      ></ResourceState
    >
  </section>
</template>
