import { getApps, initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { handleApi } from './design.mjs';

// firebase-admin powers the AI backbone (backbone.mjs): Firestore storage and Firebase ID token checks.
if (!getApps().length) initializeApp();

export const api = onRequest(
  {
    // AI_API_KEY: the chat provider key (Meta Muse in production).
    //   It also runs SAM 3.1 (reference picture parts) and Muse Voice Transcribe (robot speech-to-text).
    // GEMINI_API_KEY: robot text-to-speech on the backbone.
    secrets: ['AI_API_KEY', 'GEMINI_API_KEY'],
    cors: true,
    timeoutSeconds: 300,   // a voice turn = STT + chat + TTS
    memory: '1GiB',        // audio decode / resample
    region: 'us-central1',
  },
  async (req, res) => {
    // If request reached via Firebase Hosting rewrite, ensure path has /api prefix
    const rawUrl = req.url || '/';
    if (!rawUrl.startsWith('/api/') && rawUrl !== '/api') {
      req.url = '/api' + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);
    }
    return handleApi(req, res);
  }
);
