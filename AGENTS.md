# Agent Reference

## Coding Style

### Separation of Concerns

Every module should cleanly separate three categories of code:

**Data** — The values and state the module works with.

- Request, response, bucket, object, auth, and storage values passed through explicit types
- Module-level constants for fixed configuration (`UPPER_SNAKE_CASE`)
- Constructor options or function arguments for external configuration

**Operations (pure)** — Logic that transforms data without side effects.

- Extract as standalone exported functions at module scope (after the class definition)
- No `this` references, no DOM access, no side effects
- Takes explicit arguments, returns a value
- Use `function` declarations (not arrow functions)
- Examples: parsing S3 request paths, normalizing headers, validating bucket names, formatting XML responses

**Side effects** — Code that reads or mutates the outside world.

- HTTP handlers that read request streams or write responses
- Storage operations that read, write, rename, or delete filesystem entries
- Auth operations that read credential stores or compare signatures
- Server lifecycle operations such as starting and stopping the managed HTTP server
- Keep side effects in classes, adapters, or driver methods rather than pure helper functions

### Logic and Readability

**Guard clauses** — Handle invalid or edge-case conditions with early returns at the top of a function or handler. Place the guard before the main logic, not nested inside an else branch.

```ts
// Good
async function handlePutObjectRequest(request: S3Request): Promise<BentoResponse> {
  if (!request.bucket) {
    return createS3ErrorResponse("NoSuchBucket", "Bucket name is required");
  }

  if (!request.key) {
    return createS3ErrorResponse("InvalidRequest", "Object key is required");
  }

  const object = await storage.putObject(request.bucket, request.key, request.body);
  return createPutObjectResponse(object);
}

// Avoid
async function handlePutObjectRequest(request: S3Request): Promise<BentoResponse> {
  if (request.bucket) {
    if (request.key) {
      const object = await storage.putObject(request.bucket, request.key, request.body);
      return createPutObjectResponse(object);
    } else {
      return createS3ErrorResponse("InvalidRequest", "Object key is required");
    }
  } else {
    return createS3ErrorResponse("NoSuchBucket", "Bucket name is required");
  }
}
```

**Semantic naming** — Names should describe purpose, not implementation. Handlers follow the pattern `handle` + context + event.

```ts
// Good
const hasValidBucketName = validateBucketName(bucketName);
const handleCreateBucketRequest = (request) => { ... };
const parseS3RequestPath = (path) => { ... };

// Avoid
const flag = validateBucketName(bucketName);
const onRequest = (request) => { ... };
const parse2 = (raw) => { ... };
```

**No magic values** — Extract numeric and string literals into named constants at module scope. Use `UPPER_SNAKE_CASE`. Constants are placed between imports and the class definition.

```ts
// Good
const DEFAULT_PORT = 9000;
const DEFAULT_REGION = "us-east-1";
const METADATA_SUFFIX = ".meta.json";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

// Avoid
const endpoint = `http://127.0.0.1:9000`;
const metadataPath = `${objectPath}.meta.json`;
```

**Intent-based variables for complex expressions** — When a condition or computation is non-trivial, extract it into a named variable that expresses the intent. The variable name should read as a statement about what is being checked or computed, not how.

```ts
// Good
const isDeleteBucketBlocked = objectCount > 0;
if (isDeleteBucketBlocked) {
  return createS3ErrorResponse("BucketNotEmpty", "Bucket is not empty");
}

const listedObjects = objects.filter((object) => object.key.startsWith(prefix) && !object.isInternalMetadata);

// Avoid
if (objectCount > 0) {
  return createS3ErrorResponse("BucketNotEmpty", "Bucket is not empty");
}
```
