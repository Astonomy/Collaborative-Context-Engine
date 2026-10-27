<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAppContext } from "../context";
import { errorMessage } from "../errors";
const { session } = useAppContext();
const router = useRouter();
const token = ref("");
const pending = ref(false);
const error = ref("");
async function login(): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  error.value = "";
  const credential = token.value;
  token.value = "";
  try {
    await session.login(credential);
    await router.replace({ name: "projects" });
  } catch (failure: unknown) {
    error.value = errorMessage(failure);
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <section class="panel login">
    <p class="eyebrow">Collaborative Context Engine</p>
    <h1>Sign in</h1>
    <p>Use your CCE API token to access your projects.</p>
    <form @submit.prevent="login">
      <label for="api-token">API token</label>
      <input
        id="api-token"
        v-model="token"
        type="password"
        autocomplete="off"
        required
        :disabled="pending"
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="pending">{{ pending ? "Signing in…" : "Sign in" }}</button>
    </form>
  </section>
</template>
