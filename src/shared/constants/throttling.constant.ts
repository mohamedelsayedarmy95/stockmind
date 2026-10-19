// Global request throttling (ThrottlerModule in AppModule). Every route is limited per client per route, unless a
// handler opts out of this named throttler with @SkipThrottle({ [GLOBAL_THROTTLER]: true }).
// Note: a bare @SkipThrottle() only skips a throttler named 'default', not this one.
export const GLOBAL_THROTTLER = 'short';

export const THROTTLERS = [{ name: GLOBAL_THROTTLER, ttl: 60_000, limit: 100 }];
