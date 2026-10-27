<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from "vue-router";
import { onScopeDispose, ref } from "vue";
import { useAppContext } from "./context";
import { errorMessage } from "./errors";

const { session, fatal } = useAppContext();
const { user } = session;
const signingOut = ref(false);
const navigating = ref(false);
const router = useRouter();
const removeBefore = router.beforeEach(() => {
  navigating.value = true;
});
const removeAfter = router.afterEach(() => {
  navigating.value = false;
});
onScopeDispose(() => {
  removeBefore();
  removeAfter();
});
async function logout(): Promise<void> {
  signingOut.value = true;
  try {
    await session.logout();
  } catch (error: unknown) {
    fatal.value = errorMessage(error);
  } finally {
    signingOut.value = false;
  }
}
function reload(): void {
  window.location.reload();
}
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="topbar">
    <RouterLink class="brand" to="/projects">CCE <span>Project context</span></RouterLink>
    <div v-if="user" class="session">
      <span>{{ user.displayName }}</span>
      <button :disabled="signingOut" @click="logout">Sign out</button>
    </div>
  </header>
  <main id="main" tabindex="-1">
    <p v-if="navigating && !fatal" role="status">Loading page…</p>
    <section v-if="fatal" class="panel" role="alert">
      <h1>Unable to continue</h1>
      <p>{{ fatal }}</p>
      <button @click="reload">Reload</button>
    </section>
    <p v-else-if="signingOut" role="status">Signing out…</p>
    <RouterView v-else v-slot="{ Component, route }">
      <component :is="Component" v-if="Component" :key="route.params['projectId'] ?? route.path" />
      <p v-else role="status">Loading CCE…</p>
    </RouterView>
  </main>
</template>
