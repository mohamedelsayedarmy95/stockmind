/**
 * API docs are opt-in. With "NODE_ENV !== 'production'" a deployment that does not set NODE_ENV (or sets
 * 'staging') would publish the full route and schema map at /api/docs.
 */
import { swaggerEnabled } from '../../src/shared/http/swagger';

describe('swaggerEnabled', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }, true],
    [{}, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'staging' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{ SWAGGER_ENABLED: '1' }, false],
  ])('%j -> %s', (env, expected) => {
    expect(swaggerEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
