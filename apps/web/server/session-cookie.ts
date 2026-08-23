import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { NextResponse } from "next/server";
import { rawApiTokenSchema } from "@cce/shared";
import { z } from "zod";

export const sessionCookieName = "cce_session";
export const sessionLifetimeSeconds = 8 * 60 * 60;

const sessionPayloadSchema = z
  .object({
    apiToken: rawApiTokenSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();

export class SessionCookieCodec {
  readonly #key: Buffer;

  public constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("CCE_SESSION_SECRET must contain at least 32 bytes.");
    }
    this.#key = createHash("sha256").update(secret, "utf8").digest();
  }

  public seal(apiToken: string, now = Date.now()): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const payload = Buffer.from(
      JSON.stringify({
        apiToken,
        expiresAt: now + sessionLifetimeSeconds * 1_000,
      }),
      "utf8",
    );
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      "v1",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  public open(value: string, now = Date.now()): string | null {
    const parts = value.split(".");
    const [version, encodedIv, encodedCiphertext, encodedTag] = parts;
    if (
      parts.length !== 4 ||
      version !== "v1" ||
      encodedIv === undefined ||
      encodedCiphertext === undefined ||
      encodedTag === undefined
    ) {
      return null;
    }

    try {
      const iv = Buffer.from(encodedIv, "base64url");
      const ciphertext = Buffer.from(encodedCiphertext, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      if (iv.length !== 12 || tag.length !== 16) {
        return null;
      }
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
      const payload = sessionPayloadSchema.parse(JSON.parse(plaintext) as unknown);
      return payload.expiresAt > now ? payload.apiToken : null;
    } catch {
      return null;
    }
  }
}

export function setSessionCookie(
  response: NextResponse,
  encryptedSession: string,
  secure: boolean,
): void {
  response.cookies.set(sessionCookieName, encryptedSession, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
}

export function clearSessionCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 0,
  });
}
