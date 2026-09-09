import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const repositoryEnvironmentPath = fileURLToPath(new URL("../.env", import.meta.url));

export function loadRepositoryEnvironment(path: string = repositoryEnvironmentPath): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

loadRepositoryEnvironment();
