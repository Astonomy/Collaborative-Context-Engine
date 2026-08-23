import { rawApiTokenSchema, type ContentHasher } from "@cce/shared";
import type { User } from "@cce/domain";

import { ApplicationError } from "./errors";
import type { UnitOfWork } from "./repositories";

export class SessionService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: ContentHasher,
  ) {}

  public async authenticateApiToken(rawToken: string): Promise<User> {
    if (!rawApiTokenSchema.safeParse(rawToken).success) {
      throw new ApplicationError("UNAUTHENTICATED", "Invalid API token.");
    }
    const tokenHash = this.hasher.sha256(rawToken);
    const user = await this.unitOfWork.run((repositories) =>
      repositories.identity.findUserByApiTokenHash(tokenHash),
    );
    if (user === null) {
      throw new ApplicationError("UNAUTHENTICATED", "Invalid API token.");
    }
    return user;
  }
}
