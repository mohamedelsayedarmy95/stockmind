// The API docs (/api/docs) list every route and schema, so they are opt-in: on for local development, or when
// SWAGGER_ENABLED=true is set deliberately. A deployment without NODE_ENV (or with 'staging') does not publish them.
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.SWAGGER_ENABLED === 'true';
}
