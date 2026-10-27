<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { z } from "zod";
import type { messageListResponseSchema } from "@cce/api-contracts";
const props = defineProps<{
  messages: z.infer<typeof messageListResponseSchema>;
  streaming: string | null;
}>();
const page = ref(0);
const ordered = computed(() => [...props.messages].sort((a, b) => a.sequence - b.sequence));
const lastPage = computed(() => Math.max(0, Math.ceil(ordered.value.length / 100) - 1));
watch(
  () => props.messages.length,
  () => {
    page.value = lastPage.value;
  },
  { immediate: true },
);
const visible = computed(() => ordered.value.slice(page.value * 100, (page.value + 1) * 100));
</script>
<template>
  <section aria-label="Conversation evidence">
    <nav v-if="lastPage > 0" aria-label="Message pages">
      <button :disabled="page === 0" @click="page--">Earlier messages</button
      ><span>Page {{ page + 1 }} / {{ lastPage + 1 }}</span
      ><button :disabled="page === lastPage" @click="page++">Later messages</button>
    </nav>
    <p v-if="!messages.length">No evidence yet.</p>
    <article v-for="message in visible" :key="message.id" class="message">
      <strong>{{ message.role }}</strong>
      <small>#{{ message.sequence }} · {{ message.deliveryState }}</small>
      <p>{{ message.content }}</p>
      <slot name="attachments" :message="message" />
    </article>
    <article v-if="streaming !== null" class="message" role="status">
      <strong>CCE assistant · streaming</strong>
      <p>{{ streaming || "Thinking…" }}</p>
    </article>
  </section>
</template>
