import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATALOG,
  type ComponentDirectory,
  DEFAULT_KIT_DIRECTORY_ITEMS,
  POPULAR_KITS,
  getDirectoryTotals,
} from '../catalog/components';

interface DirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: ComponentDirectory;
  onSave: (inv: ComponentDirectory) => void;
  onboarding?: boolean;
  userEmail?: string | null;
  onSignOut?: () => void;
}

export function DirectoryModal(props: DirectoryModalProps) {
  const [inv, setInv] = useState<ComponentDirectory>({ ...props.inventory });
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [activePreset, setActivePreset] = useState<string | null>('cyberbrick');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setInv({ ...props.inventory });
  }, [props.inventory, props.isOpen]);

  const totals = useMemo(() => getDirectoryTotals(inv), [inv]);
  const catalogList = useMemo(() => Object.values(CATALOG), []);

  const selectedCount = useMemo(() => {
    return Object.values(inv).filter(q => q > 0).length;
  }, [inv]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogList.filter(item => {
      if (selectedCat === 'selected') {
        if ((inv[item.id] ?? 0) <= 0) return false;
      } else if (selectedCat !== 'all') {
        if (selectedCat === 'servo' && (item.kind === 'cservo' || item.kind === 'motor')) {
          // group continuous servos and motors
        } else if (selectedCat === 'sensor' && (item.kind === 'sensor' || item.kind === 'display' || item.kind === 'camera')) {
          // group sensors, displays, and cameras
        } else if (selectedCat === 'led' && item.kind === 'ledhub') {
          // group led hubs with leds
        } else if (item.kind !== selectedCat) {
          return false;
        }
      }
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.electrical?.toLowerCase().includes(q) ||
        item.mechanical?.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q)
      );
    });
  }, [catalogList, search, selectedCat, inv]);

  if (!props.isOpen) return null;

  const setQty = (id: string, qty: number) => {
    const val = Math.max(0, Math.min(99, Math.floor(qty) || 0));
    setInv(prev => ({ ...prev, [id]: val }));
    setActivePreset(null);
  };

  const adjustQty = (id: string, delta: number) => {
    const curr = inv[id] ?? 0;
    setQty(id, curr + delta);
  };

  const scrollToItem = (itemId: string) => {
    // Reset category to 'all' so the item is definitely visible and not hidden by filters
    setSelectedCat('all');
    setSearch('');

    // Wait a tick for React DOM update, then smoothly center the target item
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = itemRefs.current[itemId] || document.getElementById(`dir-item-${itemId}`);
        const container = containerRef.current;
        if (el && container) {
          const targetScrollTop = Math.max(0, el.offsetTop - (container.clientHeight / 2) + (el.offsetHeight / 2));
          container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
          setHighlightedId(itemId);
          setTimeout(() => setHighlightedId(null), 2200);
        }
      }, 50);
    });
  };

  const loadPreset = (presetKey: string, multiplier = 1) => {
    setActivePreset(multiplier > 1 ? `${presetKey}_${multiplier}` : presetKey);
    const presetItems = DEFAULT_KIT_DIRECTORY_ITEMS[presetKey] ?? DEFAULT_KIT_DIRECTORY_ITEMS.cyberbrick;
    const newInv: ComponentDirectory = {};
    for (const id of Object.keys(CATALOG)) {
      newInv[id] = 0;
    }
    for (const [id, count] of Object.entries(presetItems)) {
      newInv[id] = count * multiplier;
    }
    setInv(newInv);

    // Scroll smoothly to the primary controller of this component set
    const primaryId = POPULAR_KITS[presetKey]?.mainController ?? Object.keys(presetItems)[0];
    if (primaryId) {
      scrollToItem(primaryId);
    }
  };

  const clearAll = () => {
    setActivePreset(null);
    const zeroInv: ComponentDirectory = {};
    for (const id of Object.keys(CATALOG)) {
      zeroInv[id] = 0;
    }
    setInv(zeroInv);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectCat = (cat: string) => {
    setSelectedCat(cat);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSave = () => {
    props.onSave(inv);
    if (!props.onboarding) {
      props.onClose();
    }
  };

  return (
    <div
      className={props.onboarding ? 'login-screen' : 'modal-backdrop'}
      onClick={props.onboarding ? undefined : props.onClose}
    >
      {props.onboarding && (
        <>
          <div className="login-glow login-glow-1" />
          <div className="login-glow login-glow-2" />
        </>
      )}
      <div
        className="modal-dialog dir-modal"
        style={props.onboarding ? { position: 'relative', zIndex: 1, maxHeight: '90vh' } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            {props.onboarding ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="step-num-tag" style={{ fontSize: 10.5, padding: '2px 7px' }}>
                    ONBOARDING · STEP 1
                  </span>
                  {props.userEmail && (
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                      Signed in as <b style={{ color: '#e2e8f0' }}>{props.userEmail}</b>
                    </span>
                  )}
                </div>
                <h3>📦 Set Up Your Component Directory First</h3>
                <p className="sub">
                  Choose a starter kit preset or set the exact quantities of components you have on hand before designing. PICOCEO Builder will design robots strictly using your available parts.
                </p>
              </>
            ) : (
              <>
                <h3>📦 Component Directory Management</h3>
                <p className="sub">
                  Define your physical stock with exact quantities. The AI designer will build robots strictly within these parts.
                </p>
              </>
            )}
          </div>
          {props.onboarding ? (
            props.onSignOut && (
              <button className="ghost" onClick={props.onSignOut} style={{ fontSize: 11.5 }}>
                Sign out
              </button>
            )
          ) : (
            <button className="ghost close-btn" onClick={props.onClose} aria-label="Close">✕</button>
          )}
        </div>

        <div className="modal-body">
          {/* Quick Preset Loaders */}
          <div className="dir-presets-bar">
            <span className="preset-label">Load Component Set / Kit Preset:</span>
            <div className="chips">
              <button
                className={activePreset === 'cyberbrick' ? 'on' : ''}
                onClick={() => loadPreset('cyberbrick', 1)}
              >
                CyberBrick Kit (1x)
              </button>
              <button
                className={activePreset === 'xiaozhi_ai' ? 'on' : ''}
                onClick={() => loadPreset('xiaozhi_ai', 1)}
              >
                XiaoZhi AI Stand
              </button>
              <button
                className={activePreset === 'raspberry_pi' ? 'on' : ''}
                onClick={() => loadPreset('raspberry_pi', 1)}
              >
                Raspberry Pi Robotics
              </button>
              <button
                className={activePreset === 'arduino_maker' ? 'on' : ''}
                onClick={() => loadPreset('arduino_maker', 1)}
              >
                Arduino Uno Kit
              </button>
              <button
                className={activePreset === 'pico_robot' ? 'on' : ''}
                onClick={() => loadPreset('pico_robot', 1)}
              >
                Pico W Robotics
              </button>
              <button
                className={activePreset === 'esp32_diy' ? 'on' : ''}
                onClick={() => loadPreset('esp32_diy', 1)}
              >
                ESP32 Maker
              </button>
              <button
                className={activePreset === 'seeed_xiao' ? 'on' : ''}
                onClick={() => loadPreset('seeed_xiao', 1)}
              >
                Seeed XIAO
              </button>
              <button
                className={activePreset === 'jetson_ai' ? 'on' : ''}
                onClick={() => loadPreset('jetson_ai', 1)}
              >
                Jetson Edge AI
              </button>
              <button
                className={activePreset === 'cyberbrick_2' ? 'on' : ''}
                onClick={() => loadPreset('cyberbrick', 2)}
              >
                CyberBrick (2x Kits)
              </button>
              <button className="fix" onClick={clearAll}>Clear All (0)</button>
            </div>
          </div>

          {/* Search & Category Filter */}
          <div className="dir-filter-bar">
            <input
              type="text"
              placeholder="Search components by name, model ID, or spec..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="dir-search-input"
            />
            <div className="dir-cat-chips">
              <button className={selectedCat === 'all' ? 'on' : ''} onClick={() => handleSelectCat('all')}>
                All ({catalogList.length})
              </button>
              {selectedCount > 0 && (
                <button className={selectedCat === 'selected' ? 'on' : ''} onClick={() => handleSelectCat('selected')}>
                  ⭐ In My Kit ({selectedCount})
                </button>
              )}
              <button className={selectedCat === 'controller' ? 'on' : ''} onClick={() => handleSelectCat('controller')}>
                Controllers
              </button>
              <button className={selectedCat === 'shield' ? 'on' : ''} onClick={() => handleSelectCat('shield')}>
                Shields
              </button>
              <button className={selectedCat === 'servo' ? 'on' : ''} onClick={() => handleSelectCat('servo')}>
                Servos & Motors
              </button>
              <button className={selectedCat === 'sensor' ? 'on' : ''} onClick={() => handleSelectCat('sensor')}>
                Sensors & Displays
              </button>
              <button className={selectedCat === 'battery' ? 'on' : ''} onClick={() => handleSelectCat('battery')}>
                Batteries
              </button>
              <button className={selectedCat === 'speaker' ? 'on' : ''} onClick={() => handleSelectCat('speaker')}>
                Speakers
              </button>
              <button className={selectedCat === 'hardware' ? 'on' : ''} onClick={() => handleSelectCat('hardware')}>
                Magnets
              </button>
              <button className={selectedCat === 'led' ? 'on' : ''} onClick={() => handleSelectCat('led')}>
                LEDs
              </button>
            </div>
          </div>

          {/* Components Grid */}
          <div className="dir-items-container" ref={containerRef}>
            {filteredItems.length === 0 ? (
              <div className="empty-state">No components match your search.</div>
            ) : (
              filteredItems.map(item => {
                const count = inv[item.id] ?? 0;
                const isHighlighted = highlightedId === item.id;
                return (
                  <div
                    key={item.id}
                    id={`dir-item-${item.id}`}
                    ref={el => { itemRefs.current[item.id] = el; }}
                    className={`dir-item-row ${count > 0 ? 'active' : ''} ${isHighlighted ? 'highlight-pulse' : ''}`}
                  >
                    <div className="item-meta">
                      <div className="item-id-badge">
                        <span className="id-code">{item.id}</span>
                        <span className="kind-code">{item.kind}</span>
                      </div>
                      <div className="item-details">
                        <div className="item-title">{item.name}</div>
                        <div className="item-specs">
                          <span>{item.size[0]}×{item.size[1]}×{item.size[2]} mm</span>
                          <span>· {item.massG} g</span>
                          {item.electrical && <span className="item-elec">· {item.electrical.slice(0, 70)}...</span>}
                        </div>
                      </div>
                    </div>
                    <div className="item-stepper">
                      <button
                        className="step-btn minus"
                        disabled={count <= 0}
                        onClick={() => adjustQty(item.id, -1)}
                        title="Decrease quantity"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        value={count}
                        onChange={e => setQty(item.id, parseInt(e.target.value, 10) || 0)}
                        className="qty-input"
                        aria-label={`Quantity for ${item.name}`}
                      />
                      <button
                        className="step-btn plus"
                        onClick={() => adjustQty(item.id, 1)}
                        title="Increase quantity"
                      >
                        +
                      </button>
                      <div className="quick-steppers">
                        <button className="mini-btn" onClick={() => adjustQty(item.id, 2)}>+2</button>
                        <button className="mini-btn" onClick={() => adjustQty(item.id, 4)}>+4</button>
                        {count > 0 && <button className="mini-btn zero" onClick={() => setQty(item.id, 0)}>0</button>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="dir-stats-summary">
            <span className="stat-pill"><b>{totals.totalItems}</b> Total Items</span>
            <span className="stat-pill"><b>{totals.servos}</b> Servos</span>
            <span className="stat-pill"><b>{totals.motors}</b> Motors</span>
            <span className="stat-pill"><b>{totals.controllers}</b> Controllers</span>
            <span className="stat-pill"><b>{totals.batteries}</b> Batteries</span>
            <span className="stat-pill"><b>{totals.speakers}</b> Speakers</span>
            <span className="stat-pill"><b>{totals.hardware}</b> Magnets / Sensors</span>
          </div>
          <div className="footer-actions">
            {!props.onboarding && <button onClick={props.onClose}>Cancel</button>}
            <button
              className="primary"
              onClick={handleSave}
              disabled={props.onboarding && totals.totalItems === 0}
              title={props.onboarding && totals.totalItems === 0 ? 'Add at least 1 component to continue' : undefined}
            >
              {props.onboarding ? 'Save Directory & Start Designing →' : 'Save & Apply Directory'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
