<script setup lang="ts">
import { computed, ref } from "vue";
import type { z } from "zod";
import type { mergeRequestDetailResponseSchema } from "@cce/api-contracts";
const props = defineProps<{
  conflict: z.infer<typeof mergeRequestDetailResponseSchema>["conflicts"][number];
  role: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  resolve: [
    id: string,
    choice: "keep_current" | "accept_proposed" | "keep_alternative",
    rationale: string,
  ];
}>();
const rationale = ref("");
// Presentation gate matching the established Next UI. The server decides authorization.
const highRisk = computed(() =>
  ["decision", "requirement", "constraint", "architecture"].includes(
    props.conflict.proposed?.kind ?? props.conflict.currentVersion?.kind ?? "",
  ),
);
const denied = computed(() => props.disabled || props.role === "viewer" || !rationale.value.trim());
</script>
<template>
  <article class="conflict-card">
    <h3>{{ conflict.proposed?.key ?? conflict.currentVersion?.key ?? "Deprecation" }}</h3>
    <p>{{ conflict.classification }} · {{ conflict.reason }}</p>
    <p v-if="highRisk">Owner approval required</p>
    <p v-if="role === 'viewer'">Read-only review</p>
    <div class="comparison">
      <div>
        <h4>Current</h4>
        <pre>{{
          JSON.stringify(conflict.currentVersion?.value ?? "No current value", null, 2)
        }}</pre>
      </div>
      <div>
        <h4>Proposed</h4>
        <pre>{{
          JSON.stringify(conflict.proposed?.value ?? "Deprecate current value", null, 2)
        }}</pre>
      </div>
    </div>
    <p v-if="conflict.resolution">
      Resolved as {{ conflict.resolution.choice }} — {{ conflict.resolution.rationale }}
    </p>
    <template v-else
      ><label :for="'rationale-' + conflict.id">Review rationale</label
      ><textarea
        :id="'rationale-' + conflict.id"
        v-model="rationale"
        maxlength="2000"
        :disabled="disabled || role === 'viewer'"
      />
      <div class="actions">
        <button :disabled="denied" @click="emit('resolve', conflict.id, 'keep_current', rationale)">
          Keep current</button
        ><template v-if="conflict.proposed"
          ><button
            :disabled="denied || (highRisk && role !== 'owner')"
            @click="emit('resolve', conflict.id, 'accept_proposed', rationale)"
          >
            Accept proposed</button
          ><button
            :disabled="denied || (highRisk && role !== 'owner')"
            @click="emit('resolve', conflict.id, 'keep_alternative', rationale)"
          >
            Keep alternative
          </button></template
        >
      </div></template
    >
  </article>
</template>
