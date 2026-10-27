# Framework-independent authentication audit

Authentication lives in `packages/server-runtime/src/http-authentication.ts` and the AES-256-GCM v1 cookie codec in `session-cookie.ts`. `authenticateHttpRequest(Request, services)` returns an `AuthContext` containing only the database-resolved user, never a project role or approval. Both adapters consume this context through the existing `authenticateRequest` compatibility wrapper. Neither standalone production handlers nor server-runtime import Next.

## Existing mechanisms

- No NextAuth/Auth.js, `next/headers` cookies()/headers(), or OAuth implementation was found. NextRequest is confined to web adapters; NextResponse is not used for authentication. Next config headers() controls response headers, not identity.
- Authorization bearer takes precedence over cookies, including malformed bearer rejection without fallback. SessionService validates the opaque token, hashes it, and resolves the user through the identity repository on every request.
- POST /api/session validates an API token and sets an encrypted eight-hour HttpOnly cookie; GET authenticates; DELETE checks Origin and clears the cookie. Cookie writes require exact Origin/Host agreement. Missing origin and foreign origins fail. Forwarded Host is not trusted.
- Vue uses same-origin credentials for REST, SSE and attachment requests. Production retains Secure and SameSite=Strict. Deploy Vue and API behind one HTTPS origin (development uses the Vite proxy). Cross-origin credential CORS is not enabled; moving the listener does not authorize an additional browser origin. Session secrets and server credentials must never enter VITE_*.
- Application services read persisted project membership inside each operation/transaction and apply authorizeProjectMember. No role is cached in AuthContext. A missing membership retains the existing 404 resource-concealment policy; an insufficient member role returns 403. High-risk approval remains owner-only and server-side. Request schemas and explicit input construction exclude client-supplied actor, approval and provenance authority.
- MCP resolves the same CCE identity before passing actorUserId to project/import services, which recheck database RBAC. CCE_MCP_ACCESS_TOKEN denotes a CCE credential, not an OpenAI identity or session secret; never put its value in prompts, Skills or browser configuration. The Codex helper now reads only its process environment, while the standalone API validates the CCE bearer identity. Hosted deployments still require HTTPS/OAuth.
- Hosted ChatGPT OAuth is not implemented here. Its documented requirement for a separate CCE-issued OAuth 2.1 deployment remains; browser sessions and local MCP bearer credentials do not implement hosted OAuth.

## Verification and boundaries

HTTP contract tests cover anonymous 401, viewer 403, valid-role success, malformed bearer precedence, encrypted session tampering/expiration, and existing-cookie/bearer access after a database membership downgrade with forged owner/actor/approval headers. Membership lookup stays inside application transactions rather than adding a transport-layer role snapshot.

No domain/database schema or migration is changed. This work supplies independently executable standard Request authentication and handlers; the repository's default deployed host remains Next. A new production HTTP listener is outside this authentication extraction.
