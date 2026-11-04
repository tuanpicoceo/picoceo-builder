import { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  getSavedFirebaseConfig,
  saveFirebaseConfigToStorage,
  clearFirebaseConfigFromStorage,
  type CloudProject,
} from '../firebase/client';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  cloudStatus: 'idle' | 'syncing' | 'synced' | 'error';
  cloudError: string | null;
  projects: CloudProject[];
  activeProjectId: string;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSelectProject: (p: CloudProject) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onNewCloudProject: () => void;
  onConfigUpdated: () => void;
}

export function AuthModal(props: AuthModalProps) {
  const existingCfg = getSavedFirebaseConfig();
  const [configText, setConfigText] = useState(() =>
    existingCfg ? JSON.stringify(existingCfg, null, 2) : '',
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [showConfigEditor, setShowConfigEditor] = useState(!existingCfg);

  if (!props.isOpen) return null;

  const handleSaveConfig = () => {
    setConfigError(null);
    try {
      // Allow pasting either strict JSON or a JS object snippet from Firebase Console / CLI
      let raw = configText.trim();
      const braceStart = raw.indexOf('{');
      const braceEnd = raw.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        raw = raw.slice(braceStart, braceEnd + 1);
      }
      // Convert unquoted JS keys if pasted from Firebase console snippet
      const normalizedJson = raw
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/,\s*}/g, '}');
      const parsed = JSON.parse(normalizedJson);
      if (!parsed.apiKey || !parsed.projectId) {
        throw new Error('Config must include at least "apiKey" and "projectId".');
      }
      if (!parsed.authDomain) {
        parsed.authDomain = `${parsed.projectId}.firebaseapp.com`;
      }
      saveFirebaseConfigToStorage(parsed);
      setShowConfigEditor(false);
      props.onConfigUpdated();
    } catch (e) {
      setConfigError((e as Error).message || 'Invalid Firebase configuration JSON.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-content directory-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>☁️ Firebase Auth & Cloud Firestore</h2>
            <p className="modal-sub">
              Google Sign-In & real-time Cloud Firestore storage for your Robot Projects and Component Directory
            </p>
          </div>
          <button className="close-btn" onClick={props.onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          {/* Account Section */}
          <div style={{ background: '#121926', border: '1px solid #24354f', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {props.user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {props.user.photoURL && (
                    <img
                      src={props.user.photoURL}
                      alt={props.user.displayName || 'User'}
                      style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #3d8ef0' }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>
                      {props.user.displayName || 'Signed-In User'}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#93b4dc' }}>{props.user.email}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>Google Authentication</div>
                  <div style={{ fontSize: 11.5, color: '#8fa6c4' }}>
                    Sign in with Google to sync projects & component directory to Cloud Firestore
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {props.user ? (
                  <>
                    <span className={`kit-badge ${props.cloudStatus === 'error' ? 'err' : 'ok'}`}>
                      {props.cloudStatus === 'syncing'
                        ? 'Syncing…'
                        : props.cloudStatus === 'synced'
                          ? '✓ Firestore Synced'
                          : props.cloudStatus === 'error'
                            ? 'Sync Error'
                            : 'Connected'}
                    </span>
                    <button type="button" onClick={props.onSignOut}>Sign out</button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={props.onSignIn}
                    disabled={!existingCfg}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}
                  >
                    <span>🔐 Sign in with Google</span>
                  </button>
                )}
              </div>
            </div>

            {props.cloudError && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(240, 78, 93, 0.14)', border: '1px solid var(--fail)', borderRadius: 6, color: '#ffb3ba', fontSize: 11.5 }}>
                ⚠ {props.cloudError}
              </div>
            )}
          </div>

          {/* Cloud Projects List (when signed in) */}
          {props.user && (
            <div style={{ background: '#101620', border: '1px solid #202c40', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <b style={{ fontSize: 12.5, color: '#fff' }}>Cloud Robot Projects ({props.projects.length})</b>
                  <div style={{ fontSize: 11, color: '#8fa6c4' }}>
                    Synced to your personal cloud workspace
                  </div>
                </div>
                <button type="button" className="mini-btn primary" onClick={props.onNewCloudProject}>
                  + New Cloud Project
                </button>
              </div>

              {props.projects.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--mute)', padding: '12px 0', textAlign: 'center' }}>
                  No saved cloud projects yet. Your current project will automatically sync to Firestore.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {props.projects.map(p => {
                    const isCurrent = p.id === props.activeProjectId;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: isCurrent ? '#182842' : '#141c28',
                          border: `1px solid ${isCurrent ? '#3d8ef0' : '#223046'}`,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <b style={{ fontSize: 12, color: '#fff' }}>{p.name || p.spec?.name || 'Untitled'}</b>
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#21324c', color: '#a9d4ff' }}>
                              {p.spec?.archetype || 'rover'}
                            </span>
                            {isCurrent && (
                              <span style={{ fontSize: 10, color: 'var(--pass)', fontWeight: 600 }}>● Active</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--mute)', marginTop: 2 }}>
                            Updated {new Date(p.updatedAt).toLocaleString()} · {p.versions?.length ?? 0} versions · {p.chat?.length ?? 0} messages
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!isCurrent && (
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => {
                                props.onSelectProject(p);
                                props.onClose();
                              }}
                            >
                              Load
                            </button>
                          )}
                          <button
                            type="button"
                            className="mini-btn"
                            style={{ color: 'var(--fail)' }}
                            onClick={() => props.onDeleteProject(p.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Firebase Web SDK Configuration Section */}
          <div style={{ background: '#0e131c', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b style={{ fontSize: 12, color: '#cbd5e1' }}>
                  Advanced Connection Settings
                </b>
                <div style={{ fontSize: 10.5, color: 'var(--mute)' }}>
                  Default cloud workspace is connected. Optional custom backend override.
                </div>
              </div>
              <button
                type="button"
                className="mini-btn"
                onClick={() => setShowConfigEditor(v => !v)}
              >
                {showConfigEditor ? 'Hide Config' : '⚙ Edit Config'}
              </button>
            </div>

            {showConfigEditor && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={configText}
                  onChange={e => setConfigText(e.target.value)}
                  placeholder={`{\n  "apiKey": "AIza...",\n  "authDomain": "your-project.firebaseapp.com",\n  "projectId": "your-project",\n  "storageBucket": "your-project.firebasestorage.app",\n  "messagingSenderId": "...",\n  "appId": "1:...:web:..."\n}`}
                  rows={6}
                  style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, width: '100%' }}
                />
                {configError && (
                  <div style={{ color: 'var(--fail)', fontSize: 11 }}>{configError}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  {existingCfg && (
                    <button
                      type="button"
                      onClick={() => {
                        clearFirebaseConfigFromStorage();
                        setConfigText('');
                        props.onConfigUpdated();
                      }}
                    >
                      Clear Saved Config
                    </button>
                  )}
                  <button type="button" className="primary" onClick={handleSaveConfig}>
                    Save Firebase Config
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
