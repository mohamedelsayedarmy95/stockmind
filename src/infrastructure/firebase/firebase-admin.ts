import * as admin from 'firebase-admin';

// FirebaseService (Nest-managed) is the only owner of the Firebase Admin app: it initialises the default app once,
// from a complete credential set. These helpers only read that app. Initialising a second default app here failed
// with a duplicate-app error, so every FCM send failed as soon as Firebase was configured.

export function getFirebaseAdmin(): admin.app.App | null {
  return admin.apps.find((app) => app?.name === '[DEFAULT]') ?? null;
}

/** True once FirebaseService has initialised the Admin app; false when Firebase is deliberately disabled. */
export function isFirebaseConfigured(): boolean {
  return getFirebaseAdmin() !== null;
}

// Callers check isFirebaseConfigured() first.
export function getAuth() {
  return getFirebaseAdmin()!.auth();
}

export function getMessaging() {
  return getFirebaseAdmin()!.messaging();
}

export function getStorage() {
  return getFirebaseAdmin()!.storage();
}
