import { ApiError } from "./data/api-client";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 404
      ? "This resource was not found or is not accessible."
      : error.message;
  return "Unable to load CCE. Please try again.";
}
