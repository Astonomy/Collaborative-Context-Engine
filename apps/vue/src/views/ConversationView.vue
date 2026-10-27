<script setup lang="ts">
import { projectPath as projectApiPath } from "../api/projects";
import { conversationPath, messagesPath } from "../api/messages";
import { agentsPath } from "../api/agents";
import {
  agentRunResponseSchema,
  contextDeltaResponseSchema,
  conversationResponseSchema,
  messageListResponseSchema,
  mergeRequestDetailResponseSchema,
  type AttachmentResponse,
} from "@cce/api-contracts";
import { computed, ref, shallowRef } from "vue";
import type { z } from "zod";
import { useRoute, useRouter } from "vue-router";
import { useAppContext } from "../context";
import { useProject } from "../project-context";
import { useResource } from "../data/use-resource";
import { useAction } from "../data/use-action";
import { ApiError } from "../data/api-client";
import MessageList from "../components/MessageList.vue";
import ResourceState from "../components/ResourceState.vue";
import AttachmentCollection from "../attachments/AttachmentCollection.vue";
import AttachmentUpload from "../attachments/AttachmentUpload.vue";
const { session } = useAppContext();
const { access } = useProject();
const route = useRoute();
const router = useRouter();
const projectPath = projectApiPath(String(route.params["projectId"]));
const path = conversationPath(
  String(route.params["projectId"]),
  String(route.params["conversationId"]),
);
const conversation = useResource(session.client, () => path, conversationResponseSchema);
const evidence = useResource(
  session.client,
  () => messagesPath(String(route.params["projectId"]), String(route.params["conversationId"])),
  messageListResponseSchema,
);
const attachmentTarget = {
  projectId: String(route.params["projectId"]),
  conversationId: String(route.params["conversationId"]),
};
async function uploaded(attachment: AttachmentResponse) {
  if (
    attachment.projectId !== attachmentTarget.projectId ||
    attachment.conversationId !== attachmentTarget.conversationId
  )
    return;
  await evidence.reload();
}
const { busy, error, perform } = useAction();
const title = ref("");
const message = ref("");
const objective = ref("");
const rationale = ref("");
const streaming = ref<string | null>(null);
const delta = shallowRef<z.infer<typeof contextDeltaResponseSchema> | null>(null);
const agent = shallowRef<z.infer<typeof agentRunResponseSchema> | null>(null);
const canWrite = computed(
  () =>
    access.value?.member.role !== "viewer" &&
    access.value?.project.archivedAt === null &&
    conversation.data.value?.status === "active",
);
const throughSequence = computed(() =>
  (evidence.data.value ?? []).reduce((last, entry) => Math.max(last, entry.sequence), 0),
);
function update(update: { title?: string; archive?: true }) {
  return perform(async (signal) => {
    if (!canWrite.value) return;
    conversation.data.value = await session.client.json(path, conversationResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(update),
      signal,
    });
    if (update.archive) {
      delta.value = null;
      agent.value = null;
    }
  });
}
function chat() {
  return perform(async (signal) => {
    if (!canWrite.value) return;
    const content = message.value;
    const { streamChat } = await import("../data/chat-stream");
    try {
      await streamChat(
        path + "/chat",
        { clientMessageId: crypto.randomUUID(), content },
        (event) => {
          if (signal.aborted) return;
          if (event.type === "user_persisted" || event.type === "completed") {
            evidence.data.value = [
              ...(evidence.data.value ?? []).filter((entry) => entry.id !== event.message.id),
              event.message,
            ].sort((a, b) => a.sequence - b.sequence);
            if (event.type === "user_persisted") message.value = "";
            else streaming.value = null;
          } else if (event.type === "assistant_started") streaming.value = "";
          else streaming.value = (streaming.value ?? "") + event.text;
        },
        signal,
        undefined,
        session.client,
      );
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.status === 401) {
        session.user.value = null;
        session.client.cancelAll();
      }
      // Persisted evidence is authoritative after an interrupted stream. Never resend automatically.
      if (!signal.aborted && session.user.value) await evidence.reload();
      throw failure;
    } finally {
      streaming.value = null;
    }
  });
}
function extract() {
  return perform(async (signal) => {
    if (!canWrite.value) return;
    delta.value = await session.client.json(path + "/deltas", contextDeltaResponseSchema, {
      method: "POST",
      body: "{}",
      signal,
    });
  });
}
function review() {
  return perform(async (signal) => {
    if (!canWrite.value || !delta.value) return;
    const detail = await session.client.json(
      projectPath + "/merge-requests",
      mergeRequestDetailResponseSchema,
      { method: "POST", body: JSON.stringify({ deltaId: delta.value.id }), signal },
    );
    await router.push({
      name: "merges",
      params: { projectId: route.params["projectId"], mergeId: detail.request.id },
    });
  });
}
function runAgent() {
  return perform(async (signal) => {
    if (!canWrite.value || !conversation.data.value) return;
    agent.value = await session.client.json(
      agentsPath(attachmentTarget.projectId),
      agentRunResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          conversationId: conversation.data.value.id,
          throughMessageSequence: throughSequence.value,
          objective: objective.value,
        }),
        signal,
      },
    );
    if (agent.value.run.status === "completed") delta.value = agent.value.proposal;
  });
}
function resume(decision: "approve" | "reject") {
  return perform(async (signal) => {
    if (
      !canWrite.value ||
      !agent.value ||
      (decision === "approve" && access.value?.member.role !== "owner")
    )
      return;
    agent.value = await session.client.json(
      agentsPath(attachmentTarget.projectId) + "/" + agent.value.run.id + "/resume",
      agentRunResponseSchema,
      { method: "POST", body: JSON.stringify({ decision, rationale: rationale.value }), signal },
    );
    if (agent.value.run.status === "completed") delta.value = agent.value.proposal;
  });
}
</script>
<template>
  <p v-if="error" role="alert">{{ error }}</p>
  <ResourceState
    :loading="conversation.loading.value"
    :error="conversation.error.value"
    @retry="conversation.reload"
  >
    <template v-if="conversation.data.value"
      ><h2>{{ conversation.data.value.title }}</h2>
      <p>{{ conversation.data.value.status }}</p>
      <p v-if="!canWrite">Read-only conversation</p>
      <form @submit.prevent="update({ title })">
        <label for="rename-conversation">Conversation title</label
        ><input
          id="rename-conversation"
          v-model="title"
          :placeholder="conversation.data.value.title"
          maxlength="200"
          :disabled="!canWrite || busy"
          required
        /><button :disabled="!canWrite || busy || !title.trim()">Rename conversation</button
        ><button type="button" :disabled="!canWrite || busy" @click="update({ archive: true })">
          Archive conversation
        </button>
      </form>

      <ResourceState
        :loading="evidence.loading.value"
        :error="evidence.error.value"
        @retry="evidence.reload"
        ><MessageList :messages="evidence.data.value ?? []" :streaming="streaming">
          <template #attachments="{ message: entry }">
            <AttachmentCollection :attachments="entry.attachments" :client="session.client" />
          </template> </MessageList
      ></ResourceState>
      <AttachmentUpload
        :client="session.client"
        :target="attachmentTarget"
        :disabled="!canWrite || busy"
        @uploaded="uploaded"
      />
      <form @submit.prevent="chat">
        <label for="chat-message">Message</label
        ><textarea
          id="chat-message"
          v-model="message"
          maxlength="1000000"
          required
          :disabled="!canWrite || busy"
        />
        <p>Conversation is evidence, not project state.</p>
        <button
          :disabled="
            !canWrite || busy || !message.trim() || evidence.loading.value || !!evidence.error.value
          "
        >
          Send
        </button>
      </form>
      <button
        :disabled="
          !canWrite || busy || !throughSequence || evidence.loading.value || !!evidence.error.value
        "
        @click="extract"
      >
        Extract context
      </button>
      <section v-if="delta" aria-label="Delta preview">
        <h3>{{ delta.changes.length }} proposed changes</h3>
        <p>
          Evidence through message #{{ delta.throughMessageSequence }}. These changes are proposals
          until reviewed and committed.
        </p>
        <article v-for="change in delta.changes" :key="change.id" class="context-card">
          <template v-if="change.operation !== 'deprecate'"
            ><h4>{{ change.operation }} · {{ change.proposal.key }}</h4>
            <p>
              {{ change.proposal.kind }} · {{ Math.round(change.proposal.confidence * 100) }}%
              confidence
            </p>
            <pre>{{ JSON.stringify(change.proposal.value, null, 2) }}</pre>
          </template>
          <p v-else>Deprecate context item {{ change.targetLogicalItemId }}</p>
        </article>
        <button :disabled="!canWrite || busy" @click="review">Review changes</button>
      </section>
      <form @submit.prevent="runAgent">
        <label for="agent-objective">Agent objective</label
        ><textarea
          id="agent-objective"
          v-model="objective"
          maxlength="4000"
          :disabled="!canWrite || busy"
          required
        /><button
          :disabled="
            !canWrite ||
            busy ||
            !throughSequence ||
            !objective.trim() ||
            evidence.loading.value ||
            !!evidence.error.value
          "
        >
          Run agent
        </button>
      </form>
      <section v-if="agent" aria-label="Agent result">
        <p role="status">
          {{ agent.run.status.replaceAll("_", " ") }} ·
          {{ agent.proposal?.changes.length ?? 0 }} changes proposed
        </p>
        <template v-if="agent.run.status === 'awaiting_approval'"
          ><label for="approval-rationale">Approval rationale</label
          ><input id="approval-rationale" v-model="rationale" maxlength="2000" /><button
            :disabled="!canWrite || busy || access?.member.role !== 'owner' || !rationale.trim()"
            @click="resume('approve')"
          >
            Owner approve</button
          ><button :disabled="!canWrite || busy || !rationale.trim()" @click="resume('reject')">
            Reject
          </button>
          <p v-if="access?.member.role !== 'owner'">
            Only an Owner can approve this high-risk proposal.
          </p></template
        >
      </section>
    </template></ResourceState
  >
</template>
