<script setup lang="ts">
import { errorMessage } from "../errors";
defineProps<{ loading: boolean; error?: unknown }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <p v-if="loading" role="status">Loading…</p>
  <div v-else-if="error" role="alert">
    <p>{{ errorMessage(error) }}</p>
    <button @click="$emit('retry')">Try again</button>
  </div>
  <slot v-else />
</template>
