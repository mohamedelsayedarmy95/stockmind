# Pull Request Checklist

Please ensure your PR meets the following requirements:

## Code Quality
- [ ] Code follows the project's coding standards
- [ ] No console.log() or debugging statements left in code
- [ ] No hardcoded secrets, passwords, or API keys
- [ ] All new code is properly tested
- [ ] Code is well-documented where necessary

## Testing
- [ ] Unit tests pass (`npm run test:unit`)
- [ ] Integration tests pass (`npm run test:integration`)
- [ ] New code includes adequate test coverage
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

## Security
- [ ] No sensitive data exposed in logs or error messages
- [ ] Tenant isolation properly implemented and tested
- [ ] Authentication and authorization checks in place
- [ ] Input validation and sanitization applied

## Database
- [ ] Database migrations are backward compatible
- [ ] Migration scripts tested in isolation
- [ ] No raw SQL queries that could lead to injection
- [ ] Proper use of transactions where needed

## Documentation
- [ ] README updated if necessary
- [ ] Complex logic explained with comments
- [ ] Public API changes documented