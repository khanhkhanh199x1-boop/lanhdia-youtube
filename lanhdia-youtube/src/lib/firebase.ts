import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Cấu hình Firebase Client — đọc 100% từ biến môi trường VITE_FIREBASE_*.
// KHÔNG hardcode apiKey trong code (Mục 10.10). Fallback projectId mặc định "lanhdia--2027".
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'gemini-ai-tuchay.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'gemini-ai-tuchay',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'gemini-ai-tuchay.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseProjectId: string = firebaseConfig.projectId;

/** Firebase client đã cấu hình đủ để khởi tạo chưa (cần apiKey + projectId). */
export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId,
);

let app: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase chưa được cấu hình. Hãy điền các biến VITE_FIREBASE_* trong Vercel → Settings → Environment Variables rồi Redeploy.',
    );
  }
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

export function getAuthInstance(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export { firebaseConfig };
