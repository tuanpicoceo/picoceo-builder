// Firebase Authentication (Google Sign-In for tuan@picoceo.com) & Cloud Firestore persistence
// for PICOCEO Builder projects, version history, 7-step AI design flow records, and Component Directory.

import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { ComponentDirectory } from '../catalog/components';
import type { AiStepOutputs } from '../design/pipeline';
import type { RobotSpec } from '../design/spec';
import type { ChatMsg } from '../ui/Chat';

export const DEFAULT_ACCOUNT_EMAIL = 'tuan@picoceo.com';
const LS_FB_CONFIG = 'cyberbuild.firebase.config.v1';

export interface CloudProject {
  id: string;
  uid: string;
  name: string;
  spec: RobotSpec;
  hasDesign: boolean;
  versions: { spec: RobotSpec; label: string; at: number }[];
  chat: ChatMsg[];
  aiSteps?: AiStepOutputs;
  createdAt: number;
  updatedAt: number;
}

export interface UserCloudProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  inventory?: ComponentDirectory;
  activeProjectId?: string;
  updatedAt: number;
}

// The Firebase web config comes from VITE_FIREBASE_* at build time (.env.local, git-ignored; see .env.local.example),
// or from a config the user pasted in the sign-in dialog. Nothing is hard-coded here.
function getEnvFirebaseConfig(): FirebaseOptions | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (apiKey && projectId) {
    return {
      apiKey,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: env.VITE_FIREBASE_APP_ID || '',
      ...(env.VITE_FIREBASE_MEASUREMENT_ID ? { measurementId: env.VITE_FIREBASE_MEASUREMENT_ID } : {}),
    };
  }
  return null;
}

export function getSavedFirebaseConfig(): FirebaseOptions | null {
  const envCfg = getEnvFirebaseConfig();
  if (envCfg) return envCfg;
  try {
    const raw = localStorage.getItem(LS_FB_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.apiKey === 'string' && typeof parsed.projectId === 'string') {
        return parsed as FirebaseOptions;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveFirebaseConfigToStorage(cfg: FirebaseOptions): void {
  localStorage.setItem(LS_FB_CONFIG, JSON.stringify(cfg));
}

export function clearFirebaseConfigFromStorage(): void {
  localStorage.removeItem(LS_FB_CONFIG);
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function initFirebaseClient(customConfig?: FirebaseOptions): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} | null {
  const cfg = customConfig ?? getSavedFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) return null;

  try {
    if (!cachedApp) {
      const existing = getApps();
      cachedApp = existing.length > 0 ? existing[0] : initializeApp(cfg);
      cachedAuth = getAuth(cachedApp);
      cachedDb = getFirestore(cachedApp);
    }
    return { app: cachedApp!, auth: cachedAuth!, db: cachedDb! };
  } catch (e) {
    console.error('Firebase initialization error:', e);
    return null;
  }
}

export function isFirebaseConfigured(): boolean {
  return Boolean(getSavedFirebaseConfig());
}

/** Sign in with Google. */
export async function signInWithGoogle(): Promise<User> {
  const fb = initFirebaseClient();
  if (!fb) {
    throw new Error('Firebase Web SDK config is not set yet. Click "⚙ Firebase Config" or complete Firebase project setup.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  const cred = await signInWithPopup(fb.auth, provider);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  const fb = initFirebaseClient();
  if (!fb) return;
  await signOut(fb.auth);
}

export function subscribeAuthState(cb: (user: User | null) => void): () => void {
  const fb = initFirebaseClient();
  if (!fb) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(fb.auth, cb);
}

/** Recursively strip undefined values and oversize base64 dataUrls so Firestore documents stay clean and < 1 MiB. */
function sanitizeForFirestore<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(item => sanitizeForFirestore(item)).filter(x => x !== undefined) as unknown as T;
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (k === 'image' && v && typeof v === 'object' && 'dataUrl' in v) {
        const dUrl = String((v as { dataUrl?: string }).dataUrl ?? '');
        if (dUrl.length > 80_000) {
          // Keep metadata without bloating Firestore document past 1 MiB
          out[k] = {
            name: (v as { name?: string }).name || 'reference_image',
            mimeType: (v as { mimeType?: string }).mimeType || 'image/png',
            dataUrl: '',
          };
          continue;
        }
      }
      out[k] = sanitizeForFirestore(v);
    }
    return out as unknown as T;
  }
  return val;
}

/** Save user profile & Component Directory stock to `users/{uid}` in Cloud Firestore. */
export async function saveUserDirectoryToFirestore(
  user: User,
  inventory: ComponentDirectory,
  activeProjectId?: string,
): Promise<void> {
  const fb = initFirebaseClient();
  if (!fb) return;
  const payload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email || DEFAULT_ACCOUNT_EMAIL,
    displayName: user.displayName || user.email || 'PICOCEO Builder User',
    photoURL: user.photoURL || '',
    inventory: sanitizeForFirestore(inventory),
    updatedAt: Date.now(),
  };
  if (activeProjectId) {
    payload.activeProjectId = activeProjectId;
  }
  await setDoc(doc(fb.db, 'users', user.uid), payload, { merge: true });
}

/** Load user profile & Component Directory stock from `users/{uid}` in Cloud Firestore. */
export async function loadUserProfileFromFirestore(uid: string): Promise<UserCloudProfile | null> {
  const fb = initFirebaseClient();
  if (!fb) return null;
  const snap = await getDoc(doc(fb.db, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data() as UserCloudProfile;
}

/** Save a robot design project to `users/{uid}/projects/{projectId}` in Cloud Firestore. */
export async function saveProjectToFirestore(user: User, project: CloudProject): Promise<void> {
  const fb = initFirebaseClient();
  if (!fb) return;
  const docData = sanitizeForFirestore({
    id: project.id,
    uid: user.uid,
    name: (project.name || project.spec.name || 'Untitled Robot').slice(0, 100),
    spec: project.spec,
    hasDesign: Boolean(project.hasDesign),
    versions: (project.versions ?? []).slice(-30),
    chat: (project.chat ?? []).slice(-60).map(m => {
      const copy = { ...m };
      if (copy.image && copy.image.dataUrl && copy.image.dataUrl.length > 80_000) {
        delete copy.image;
      }
      return copy;
    }),
    aiSteps: project.aiSteps ?? {},
    createdAt: project.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  await setDoc(doc(fb.db, 'users', user.uid, 'projects', project.id), docData, { merge: true });
}

/** List all saved robot projects for `uid` from `users/{uid}/projects`. */
export async function listProjectsFromFirestore(uid: string): Promise<CloudProject[]> {
  const fb = initFirebaseClient();
  if (!fb) return [];
  const snap = await getDocs(collection(fb.db, 'users', uid, 'projects'));
  const list: CloudProject[] = [];
  snap.forEach(d => {
    list.push(d.data() as CloudProject);
  });
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Subscribe to real-time updates of all projects under `users/{uid}/projects`. */
export function subscribeProjectsFromFirestore(
  uid: string,
  onUpdate: (projects: CloudProject[]) => void,
): () => void {
  const fb = initFirebaseClient();
  if (!fb) return () => {};
  return onSnapshot(
    collection(fb.db, 'users', uid, 'projects'),
    snap => {
      const list: CloudProject[] = [];
      snap.forEach(d => list.push(d.data() as CloudProject));
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      onUpdate(list);
    },
    err => {
      console.warn('Firestore projects subscription warning:', err);
    },
  );
}

/** Delete a project from `users/{uid}/projects/{projectId}`. */
export async function deleteProjectFromFirestore(uid: string, projectId: string): Promise<void> {
  const fb = initFirebaseClient();
  if (!fb) return;
  await deleteDoc(doc(fb.db, 'users', uid, 'projects', projectId));
}
