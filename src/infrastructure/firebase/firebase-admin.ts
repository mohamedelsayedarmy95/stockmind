import * as admin from 'firebase-admin';

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (!firebaseApp && process.env.FIREBASE_PROJECT_ID) {
    try {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, '\n'),
        }),
      });
      console.log('[Firebase] Initialized successfully');
    } catch (error) {
      console.error('[Firebase] Initialization failed:', error);
    }
  }
  return firebaseApp!;
}

export function isFirebaseConfigured(): boolean {
  return !!process.env.FIREBASE_PROJECT_ID;
}

export function getAuth() {
  return getFirebaseAdmin().auth();
}

export function getMessaging() {
  return getFirebaseAdmin().messaging();
}

export function getStorage() {
  return getFirebaseAdmin().storage();
}
