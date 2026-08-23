# Application rules

- Own use cases, repository/provider ports, authorization, transaction boundaries, and idempotency policy.
- Authenticate at transport boundaries and authorize again in each project-scoped use case.
- Load resources by `(projectId, resourceId)` and never trust actor, project, status, approval, or provenance fields supplied by clients/models.
- Do not keep a database transaction open during a network/model call.
- Convert infrastructure failures into stable application errors without leaking secrets.

