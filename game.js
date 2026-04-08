document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('bridge-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const levelSelector = document.getElementById('level-selector');
    const budgetDisplay = document.getElementById('budget-display');
    const statusBanner = document.getElementById('game-status');
    const statusText = document.getElementById('status-text');
    const statusClose = document.getElementById('btn-status-close');
    
    // Resize canvas dimensions only — does NOT reset the level.
    // Call initEnvironment() explicitly when a full reset is required.
    // True while the browser is animating into/out of fullscreen.
    // During this window the native 'resize' event fires but we must NOT
    // call initEnvironment — that would wipe the user's structure.
    let isFullscreenTransitioning = false;

    function resizeCanvas(preserveStructure = false) {
        if (!canvas.parentElement) return;
        if (isSimulating) return; // Never corrupt physics mid-run
        if (isFullscreenTransitioning) return; // Ignore resize events from fullscreen toggle

        const snapshot = preserveStructure && nodes.length > 0 ? captureRelativeDesign() : null;

        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.clientHeight || (canvas.width * 0.5);

        initEnvironment(false);

        if (snapshot) {
            restoreRelativeDesign(snapshot);
        } else if (nodes.length > 0) {
            draw();
        }
    }
    window.addEventListener('resize', () => resizeCanvas(true));

    // Simulation Data
    let nodes = [];
    let beams = [];
    let isSimulating = false;
    let animFrame = null;
    let currentLevel = 'river';

    // Puzzle Economy Data
    let budget = 15000;
    let currentSpend = 0;
    const UNLIMITED_BUDGET = 999999999;

    // Interaction State
    let hoveredNode = null;
    let hoveredBeam = null;
    let draggingStartNode = null;
    let mousePos = { x: 0, y: 0 };
    let snapRadius = 15;
    let operationMode = 'road'; // 'road', 'truss', or 'delete'
    let helpBlueprint = null; // Stores pedagogical ghost lines

    // Physics constants
    const GRAVITY = 0.6;
    const RELAXATION_ITERATIONS = 50;
    const MAX_BEAM_LENGTH = 125; // Rebalanced from 140 to force trussing

    const MATERIAL_CONFIG = {
        road: { cost: 5, yield: 0.02, color: 'road' },
        light: { cost: 3, yield: 0.012, color: 'light' },
        standard: { cost: 5, yield: 0.02, color: 'standard' },
        heavy: { cost: 20, yield: 0.06, color: 'heavy' } // Cost increase for balance
    };

    let themePalette = {};
    const updateThemePalette = () => {
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (theme === 'vibrant') {
            themePalette = { riverBank: '#7e22ce', cityBank: '#4c1d95', hwBank: '#6d28d9', pier1: '#7e22ce', pier2: '#581c87', beam: '#ff007f', beamDraft: '#fbcfe8', nodeFixed: '#d8b4fe', nodeFree: '#00e6ff', nodeBorder: '#ffffff', carBase: '#d8b4fe', carBox: '#c084fc', wheel: '#581c87', mtnColor: '#1e1b4b' };
        } else if (theme === 'dark') {
            themePalette = { riverBank: '#1e293b', cityBank: '#334155', hwBank: '#334155', pier1: '#64748b', pier2: '#475569', beam: '#f8fafc', beamDraft: '#cbd5e1', nodeFixed: '#94a3b8', nodeFree: '#3b82f6', nodeBorder: '#cbd5e1', carBase: '#cbd5e1', carBox: '#94a3b8', wheel: '#94a3b8', mtnColor: '#064e3b' };
        } else {
            themePalette = { riverBank: '#4b5563', cityBank: '#1e293b', hwBank: '#64748b', pier1: '#475569', pier2: '#334155', beam: '#1f2937', beamDraft: '#9ca3af', nodeFixed: '#111827', nodeFree: '#2563eb', nodeBorder: '#111827', carBase: '#1e293b', carBox: '#374151', wheel: '#111827', mtnColor: '#065f46' };
        }
    };
    updateThemePalette();
    
    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                updateThemePalette();
                if (!isSimulating && nodes.length > 0) draw();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });
    
    // Grid State
    let isGridEnabled = false;
    const GRID_SIZE = 75;
    
    // Background State
    let levelBackgroundData = {
        river: [],
        city: [],
        highway: [],
        pylons: [],
        mountain: []
    };

    // Vehicle Data
    let car = { active: false, x: 0, y: 0, vy: 0, rotation: 0, speed: 1.5, state: 'idle' };

    function isUnlimitedBudget() {
        return budget >= UNLIMITED_BUDGET;
    }

    function resetVehicleToStart() {
        car.x = levelState.bLeftX - 50;
        if (currentLevel === 'mountain') {
            car.y = levelState.bankY - 15;
        } else {
            car.y = levelState.bankY - 15;
        }
        car.vy = 0;
        car.rotation = 0;
        car.speed = 1.5;
        car.state = 'idle';
        car.active = false;
    }

    function setSimulatingUI(simulating) {
        // IDs of all buttons/selects that must be locked during simulation.
        const LIKELY_LOCKED = [
            'btn-mode-toggle', 'btn-undo', 'btn-redo', 'btn-save-checkpoint',
            'btn-simulate', 'btn-fullscreen', 'level-selector', 
            'beam-size-selector', 'budget-selector'
        ];

        LIKELY_LOCKED.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = simulating;
            el.style.opacity = simulating ? '0.4' : '';
            el.style.pointerEvents = simulating ? 'none' : '';
        });

        // Diagnostic & Emergency Tools - ALWAYS interactive for engineering iteration
        const PERMANENT_TOOLS = ['btn-reset', 'btn-restore-checkpoint', 'btn-grid-toggle'];
        PERMANENT_TOOLS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.disabled = false;
        });

        // Post-failure Safeguard: Keep Save greyed out so a collapsed structure 
        // cannot overwrite a valid design checkpoint.
        if (!simulating && car.state === 'failed') {
            const saveBtn = document.getElementById('btn-save-checkpoint');
            const simBtn = document.getElementById('btn-simulate');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.4';
                saveBtn.style.pointerEvents = 'none';
                saveBtn.title = 'Cannot save - structure has collapsed';
            }
            if (simBtn) {
                 simBtn.disabled = true;
                 simBtn.style.opacity = '0.4';
                 simBtn.style.pointerEvents = 'none';
            }
        } else if (!simulating) {
            // Restore tooltips/states when simulation is properly exited
            const saveBtn = document.getElementById('btn-save-checkpoint');
            if (saveBtn) saveBtn.title = 'Save Structure State';
            updateUndoButtons();
            updateRestoreButtonState();
        }
    }

    function updateRestoreButtonState() {
        const btn = document.getElementById('btn-restore-checkpoint');
        if (!btn) return;
        
        const saves = getPersistentSaves();
        const hasSave = saves[currentLevel] && saves[currentLevel].nodes && saves[currentLevel].nodes.length > 0;
        
        if (hasSave) {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.cursor = 'pointer';
        } else {
            btn.style.opacity = '0.35';
            btn.style.pointerEvents = 'none';
            btn.style.cursor = 'not-allowed';
        }
    }

    // Undo/Redo System
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;

    const LEVEL_SOLUTIONS = {
        river: [
            {
                // Variation 1: 5-Panel Standard Warren (Optimized for 50% stress)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true}, // 0,1
                    {relX: 0.2, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false},
                    {relX: 0.6, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false}, // 2-5 (Road)
                    {relX: 0.1, relY: -0.12, fixed: false}, {relX: 0.3, relY: -0.15, fixed: false},
                    {relX: 0.5, relY: -0.15, fixed: false}, {relX: 0.7, relY: -0.15, fixed: false},
                    {relX: 0.9, relY: -0.12, fixed: false} // 6-10 (Truss)
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'standard', isRoad: true}, {idxA: 2, idxB: 3, size: 'standard', isRoad: true}, {idxA: 3, idxB: 4, size: 'standard', isRoad: true}, {idxA: 4, idxB: 5, size: 'standard', isRoad: true}, {idxA: 5, idxB: 1, size: 'standard', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'standard'}, {idxA: 6, idxB: 2, size: 'light'}, {idxA: 6, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 3, size: 'light'}, {idxA: 7, idxB: 8, size: 'standard'}, {idxA: 8, idxB: 4, size: 'light'}, {idxA: 8, idxB: 9, size: 'standard'}, {idxA: 9, idxB: 5, size: 'light'}, {idxA: 9, idxB: 10, size: 'standard'}, {idxA: 10, idxB: 1, size: 'standard'}
                ]
            },
            {
                // Variation 2: Under-chord Warren (50% stress target)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.25, relY: 0, fixed: false}, {relX: 0.5, relY: 0, fixed: false}, {relX: 0.75, relY: 0, fixed: false},
                    {relX: 0.12, relY: 0.12, fixed: false}, {relX: 0.37, relY: 0.15, fixed: false}, {relX: 0.63, relY: 0.15, fixed: false}, {relX: 0.88, relY: 0.12, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'standard', isRoad: true}, {idxA: 2, idxB: 3, size: 'standard', isRoad: true}, {idxA: 3, idxB: 4, size: 'standard', isRoad: true}, {idxA: 4, idxB: 1, size: 'standard', isRoad: true},
                    {idxA: 0, idxB: 5, size: 'standard'}, {idxA: 5, idxB: 2, size: 'light'}, {idxA: 2, idxB: 6, size: 'standard'}, {idxA: 6, idxB: 3, size: 'light'}, {idxA: 3, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 4, size: 'light'}, {idxA: 4, idxB: 8, size: 'standard'}, {idxA: 8, idxB: 1, size: 'standard'},
                    {idxA: 5, idxB: 6, size: 'light'}, {idxA: 6, idxB: 7, size: 'light'}, {idxA: 7, idxB: 8, size: 'light'}
                ]
            },
            {
                // Variation 3: Deep Pratt (Standard/Light Mix)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.2, relY: -0.15, fixed: false}, {relX: 0.4, relY: -0.15, fixed: false}, {relX: 0.6, relY: -0.15, fixed: false}, {relX: 0.8, relY: -0.15, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'standard', isRoad: true}, {idxA: 2, idxB: 3, size: 'standard', isRoad: true}, {idxA: 3, idxB: 4, size: 'standard', isRoad: true}, {idxA: 4, idxB: 5, size: 'standard', isRoad: true}, {idxA: 5, idxB: 1, size: 'standard', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'standard'}, {idxA: 6, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 8, size: 'standard'}, {idxA: 8, idxB: 9, size: 'standard'}, {idxA: 9, idxB: 1, size: 'standard'},
                    {idxA: 6, idxB: 2, size: 'light'}, {idxA: 7, idxB: 3, size: 'light'}, {idxA: 8, idxB: 4, size: 'light'}, {idxA: 9, idxB: 5, size: 'light'},
                    {idxA: 0, idxB: 7, size: 'light'}, {idxA: 3, idxB: 9, size: 'light'}, {idxA: 4, idxB: 1, size: 'light'}
                ]
            }
        ],
        city: [
            {
                // Variation 1: 8-Panel Deck Truss (Mixed Material)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.125, relY: 0, fixed: false}, {relX: 0.25, relY: 0, fixed: false}, 
                    {relX: 0.375, relY: 0, fixed: false}, {relX: 0.5, relY: 0, fixed: false},
                    {relX: 0.625, relY: 0, fixed: false}, {relX: 0.75, relY: 0, fixed: false},
                    {relX: 0.875, relY: 0, fixed: false},
                    {relX: 0.125, relY: 0.15, fixed: false}, {relX: 0.375, relY: 0.15, fixed: false}, 
                    {relX: 0.625, relY: 0.15, fixed: false}, {relX: 0.875, relY: 0.15, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 9, size: 'standard'}, {idxA: 9, idxB: 3, size: 'standard'}, {idxA: 3, idxB: 10, size: 'standard'}, {idxA: 10, idxB: 5, size: 'standard'}, {idxA: 5, idxB: 11, size: 'standard'}, {idxA: 11, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 1, size: 'standard'},
                    {idxA: 9, idxB: 10, size: 'light'}, {idxA: 10, idxB: 11, size: 'light'}, {idxA: 11, idxB: 12, size: 'light'}
                ]
            },
            {
                // Variation 2: Cable-braced Suspension (Optimized)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.2, relY: -0.2, fixed: false}, {relX: 0.8, relY: -0.2, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'standard'}, {idxA: 1, idxB: 7, size: 'standard'}, {idxA: 6, idxB: 2, size: 'standard'}, {idxA: 6, idxB: 3, size: 'standard'}, {idxA: 7, idxB: 4, size: 'standard'}, {idxA: 7, idxB: 3, size: 'standard'}, {idxA: 6, idxB: 7, size: 'light'}
                ]
            },
            {
                // Variation 3: 10-Panel Under-arch
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.3, relY: 0.2, fixed: false}, {relX: 0.5, relY: 0.25, fixed: false}, {relX: 0.7, relY: 0.2, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'standard'}, {idxA: 6, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 8, size: 'standard'}, {idxA: 8, idxB: 1, size: 'standard'},
                    {idxA: 6, idxB: 2, size: 'light'}, {idxA: 7, idxB: 3, size: 'light'}, {idxA: 8, idxB: 4, size: 'light'}
                ]
            }
        ],
        highway: [
            {
                // Variation 1: 10-Panel Warren (50% stress, aligned anchors)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true}, // 0,1
                    {relX: 0.1, relY: 0, fixed: false}, {relX: 0.2, relY: 0, fixed: false}, 
                    {relX: 0.3, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false},
                    {relX: 0.5, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false},
                    {relX: 0.7, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.9, relY: 0, fixed: false}, // 2-10 (Road)
                    {relX: 0.05, relY: -0.15, fixed: false}, {relX: 0.25, relY: -0.15, fixed: false},
                    {relX: 0.5, relY: -0.2, fixed: false}, {relX: 0.75, relY: -0.15, fixed: false},
                    {relX: 0.95, relY: -0.15, fixed: false} // 11-15 (Truss)
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 9, size: 'heavy', isRoad: true}, {idxA: 9, idxB: 10, size: 'heavy', isRoad: true}, {idxA: 10, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 11, size: 'standard'}, {idxA: 11, idxB: 3, size: 'standard'}, {idxA: 3, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 5, size: 'standard'}, {idxA: 5, idxB: 13, size: 'standard'}, {idxA: 13, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 14, size: 'standard'}, {idxA: 14, idxB: 9, size: 'standard'}, {idxA: 9, idxB: 15, size: 'standard'}, {idxA: 15, idxB: 1, size: 'standard'},
                    {idxA: 11, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 13, size: 'standard'}, {idxA: 13, idxB: 14, size: 'standard'}, {idxA: 14, idxB: 15, size: 'standard'}
                ]
            },
            {
                // Variation 2: Pylon-anchored Deck Truss
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.1, relY: 0, fixed: false}, {relX: 0.2, relY: 0, fixed: false}, 
                    {relX: 0.3, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false},
                    {relX: 0.5, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false},
                    {relX: 0.7, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.9, relY: 0, fixed: false},
                    {relX: 0.457, relY: -0.07, fixed: true}, {relX: 0.543, relY: -0.07, fixed: true} // Aligned with internal pylon tops
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 9, size: 'heavy', isRoad: true}, {idxA: 9, idxB: 10, size: 'heavy', isRoad: true}, {idxA: 10, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 11, idxB: 4, size: 'standard'}, {idxA: 11, idxB: 5, size: 'standard'}, {idxA: 11, idxB: 6, size: 'standard'}, 
                    {idxA: 12, idxB: 6, size: 'standard'}, {idxA: 12, idxB: 7, size: 'standard'}, {idxA: 12, idxB: 8, size: 'standard'}
                ]
            },
            {
                // Variation 3: Deep Cable-stayed Space Hub
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, 
                    {relX: 0.6, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.5, relY: -0.3, fixed: false},
                    {relX: 0.457, relY: -0.07, fixed: true}, {relX: 0.543, relY: -0.07, fixed: true}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 6, idxB: 7, size: 'heavy'}, {idxA: 6, idxB: 8, size: 'heavy'},
                    {idxA: 6, idxB: 0, size: 'standard'}, {idxA: 6, idxB: 2, size: 'standard'}, {idxA: 6, idxB: 3, size: 'standard'}, {idxA: 6, idxB: 4, size: 'standard'}, {idxA: 6, idxB: 5, size: 'standard'}, {idxA: 6, idxB: 1, size: 'standard'}
                ]
            }
        ],
        pylons: [
            {
                // Variation 1: 12-Panel Triple-Span Warren (Pinned to 6 anchorage nodes)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.1, relY: 0, fixed: false}, {relX: 0.2, relY: 0, fixed: false}, 
                    {relX: 0.3, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false},
                    {relX: 0.5, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false},
                    {relX: 0.7, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false},
                    {relX: 0.9, relY: 0, fixed: false},
                    // Aligned Pylon Anchors
                    {relX: 0.297, relY: 0.045, fixed: true}, {relX: 0.363, relY: 0.045, fixed: true},
                    {relX: 0.627, relY: 0.045, fixed: true}, {relX: 0.693, relY: 0.045, fixed: true}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 9, size: 'heavy', isRoad: true}, {idxA: 9, idxB: 10, size: 'heavy', isRoad: true}, {idxA: 10, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 11, idxB: 3, size: 'standard'}, {idxA: 11, idxB: 4, size: 'standard'}, {idxA: 12, idxB: 5, size: 'standard'}, {idxA: 12, idxB: 6, size: 'standard'},
                    {idxA: 13, idxB: 7, size: 'standard'}, {idxA: 13, idxB: 8, size: 'standard'}, {idxA: 14, idxB: 9, size: 'standard'}, {idxA: 14, idxB: 10, size: 'standard'},
                    {idxA: 11, idxB: 12, size: 'standard'}, {idxA: 13, idxB: 14, size: 'standard'}
                ]
            },
            {
                // Variation 2: Heavy Deck Under-arch Cable Support
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.1, relY: 0, fixed: false}, {relX: 0.25, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false}, {relX: 0.75, relY: 0, fixed: false}, {relX: 0.9, relY: 0, fixed: false},
                    {relX: 0.297, relY: 0.045, fixed: true}, {relX: 0.693, relY: 0.045, fixed: true},
                    {relX: 0.297, relY: 0.25, fixed: false}, {relX: 0.693, relY: 0.25, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 8, idxB: 10, size: 'heavy'}, {idxA: 9, idxB: 11, size: 'heavy'},
                    {idxA: 10, idxB: 2, size: 'standard'}, {idxA: 10, idxB: 3, size: 'standard'}, {idxA: 10, idxB: 4, size: 'standard'},
                    {idxA: 11, idxB: 5, size: 'standard'}, {idxA: 11, idxB: 6, size: 'standard'}, {idxA: 11, idxB: 7, size: 'standard'},
                    {idxA: 10, idxB: 11, size: 'light'}
                ]
            },
            {
                // Variation 3: Deep Pratt Space Truss (Pinned)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.1, relY: 0, fixed: false}, {relX: 0.2, relY: 0, fixed: false}, {relX: 0.3, relY: 0, fixed: false}, {relX: 0.4, relY: 0, fixed: false}, {relX: 0.5, relY: 0, fixed: false}, {relX: 0.6, relY: 0, fixed: false}, {relX: 0.7, relY: 0, fixed: false}, {relX: 0.8, relY: 0, fixed: false}, {relX: 0.9, relY: 0, fixed: false},
                    {relX: 0.33, relY: -0.2, fixed: false}, {relX: 0.66, relY: -0.2, fixed: false},
                    {relX: 0.363, relY: 0.045, fixed: true}, {relX: 0.627, relY: 0.045, fixed: true}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 9, size: 'heavy', isRoad: true}, {idxA: 9, idxB: 10, size: 'heavy', isRoad: true}, {idxA: 10, idxB: 12, size: 'heavy', isRoad: true}, {idxA: 12, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 11, size: 'standard'}, {idxA: 11, idxB: 13, size: 'standard'}, {idxA: 13, idxB: 14, size: 'standard'}, {idxA: 14, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 1, size: 'standard'},
                    {idxA: 11, idxB: 4, size: 'light'}, {idxA: 14, idxB: 9, size: 'light'}
                ]
            }
        ],
        mountain: [
            {
                // Variation 1: 8-Panel Sloped Warren (50% stress target)
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true}, // 0,1
                    {relX: 0.125, relY: 0.05, fixed: false}, {relX: 0.25, relY: 0.1, fixed: false}, 
                    {relX: 0.375, relY: 0.15, fixed: false}, {relX: 0.5, relY: 0.2, fixed: false},
                    {relX: 0.625, relY: 0.25, fixed: false}, {relX: 0.75, relY: 0.3, fixed: false},
                    {relX: 0.875, relY: 0.35, fixed: false}, // 2-8
                    {relX: 0.05, relY: -0.1, fixed: false}, {relX: 0.25, relY: -0.1, fixed: false},
                    {relX: 0.5, relY: -0.05, fixed: false}, {relX: 0.75, relY: 0.1, fixed: false},
                    {relX: 0.95, relY: 0.2, fixed: false} // 9-13
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 6, size: 'heavy', isRoad: true}, {idxA: 6, idxB: 7, size: 'heavy', isRoad: true}, {idxA: 7, idxB: 8, size: 'heavy', isRoad: true}, {idxA: 8, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 9, size: 'standard'}, {idxA: 9, idxB: 3, size: 'standard'}, {idxA: 3, idxB: 10, size: 'standard'}, {idxA: 10, idxB: 5, size: 'standard'}, {idxA: 5, idxB: 11, size: 'standard'}, {idxA: 11, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 1, size: 'standard'},
                    {idxA: 9, idxB: 10, size: 'standard'}, {idxA: 10, idxB: 11, size: 'standard'}, {idxA: 11, idxB: 12, size: 'standard'}, {idxA: 12, idxB: 13, size: 'standard'}
                ]
            },
            {
                // Variation 2: Deep Anchor Cable-suspension
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0.08, fixed: false}, {relX: 0.4, relY: 0.16, fixed: false}, {relX: 0.6, relY: 0.24, fixed: false}, {relX: 0.8, relY: 0.32, fixed: false},
                    {relX: 0.1, relY: -0.3, fixed: false}, {relX: 0.9, relY: 0.2, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'heavy'}, {idxA: 1, idxB: 7, size: 'heavy'},
                    {idxA: 6, idxB: 2, size: 'standard'}, {idxA: 6, idxB: 3, size: 'standard'}, {idxA: 6, idxB: 4, size: 'standard'},
                    {idxA: 7, idxB: 4, size: 'standard'}, {idxA: 7, idxB: 5, size: 'standard'}, {idxA: 6, idxB: 7, size: 'light'}
                ]
            },
            {
                // Variation 3: Zig-zag Sloped Foundation Truss
                nodes: [
                    {relX: 0, relY: 0, fixed: true}, {relX: 1, relY: 0, fixed: true},
                    {relX: 0.2, relY: 0.08, fixed: false}, {relX: 0.4, relY: 0.16, fixed: false}, {relX: 0.6, relY: 0.24, fixed: false}, {relX: 0.8, relY: 0.32, fixed: false},
                    {relX: 0.3, relY: 0.4, fixed: false}, {relX: 0.7, relY: 0.6, fixed: false}
                ],
                beams: [
                    {idxA: 0, idxB: 2, size: 'heavy', isRoad: true}, {idxA: 2, idxB: 3, size: 'heavy', isRoad: true}, {idxA: 3, idxB: 4, size: 'heavy', isRoad: true}, {idxA: 4, idxB: 5, size: 'heavy', isRoad: true}, {idxA: 5, idxB: 1, size: 'heavy', isRoad: true},
                    {idxA: 0, idxB: 6, size: 'standard'}, {idxA: 6, idxB: 3, size: 'standard'}, {idxA: 3, idxB: 7, size: 'standard'}, {idxA: 7, idxB: 1, size: 'standard'},
                    {idxA: 6, idxB: 7, size: 'light'}
                ]
            }
        ]
    };

    function onDesignChange() {
        if (!isSimulating && (car.state === 'failed' || car.state === 'passed')) {
            restoreGhostNodePositions();
            resetVehicleToStart();
            ghostStructure = null;
            firstBrokenBeam = null;
            brokeAtX = 0;
            brokeAtY = 0;
            brokeStrain = 0;
            statusBanner.classList.add('hidden');
            isSimulating = false;
            setSimulatingUI(false);
            draw();
        }
    }

    function saveHistory() {
        if (isSimulating) return;
        const snapshot = {
            nodes: nodes.map(n => ({ x: n.x, y: n.y, fixed: n.fixed })),
            beams: beams.map(b => ({
                idxA: nodes.indexOf(b.nodeA),
                idxB: nodes.indexOf(b.nodeB),
                size: b.size,
                isRoad: !!b.isRoad
            }))
        };
        undoStack.push(snapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = []; // Clear redo on any new action
        updateUndoButtons();
    }

    function restoreFromSnapshot(snapshot) {
        nodes = snapshot.nodes.map(n => new Node(n.x, n.y, n.fixed));
        // Guard against stale indices (-1) that can occur after level switches
        beams = snapshot.beams
            .filter(b => b.idxA >= 0 && b.idxB >= 0 && b.idxA < nodes.length && b.idxB < nodes.length)
            .map(b => new Beam(nodes[b.idxA], nodes[b.idxB], b.size, !!b.isRoad));

        if (!isSimulating && (car.state === 'failed' || car.state === 'passed')) {
            resetVehicleToStart();
            ghostStructure = null;
            firstBrokenBeam = null;
            brokeAtX = 0;
            brokeAtY = 0;
            brokeStrain = 0;
            statusBanner.classList.add('hidden');
            setSimulatingUI(false);
        }

        updateBudgetUI();
        draw();
    }

    function updateUndoButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) {
            btnUndo.disabled = undoStack.length === 0;
            btnUndo.style.opacity = undoStack.length === 0 ? '0.4' : '1';
        }
        if (btnRedo) {
            btnRedo.disabled = redoStack.length === 0;
            btnRedo.style.opacity = redoStack.length === 0 ? '0.4' : '1';
        }
    }

    function undo() {
        if (undoStack.length === 0 || isSimulating) return;
        const current = {
            nodes: nodes.map(n => ({ x: n.x, y: n.y, fixed: n.fixed })),
            beams: beams.map(b => ({
                idxA: nodes.indexOf(b.nodeA),
                idxB: nodes.indexOf(b.nodeB),
                size: b.size,
                isRoad: !!b.isRoad
            }))
        };
        redoStack.push(current);
        const prev = undoStack.pop();
        restoreFromSnapshot(prev);
        updateUndoButtons();
    }

    function redo() {
        if (redoStack.length === 0 || isSimulating) return;
        const current = {
            nodes: nodes.map(n => ({ x: n.x, y: n.y, fixed: n.fixed })),
            beams: beams.map(b => ({
                idxA: nodes.indexOf(b.nodeA),
                idxB: nodes.indexOf(b.nodeB),
                size: b.size,
                isRoad: !!b.isRoad
            }))
        };
        undoStack.push(current);
        const next = redoStack.pop();
        restoreFromSnapshot(next);
        updateUndoButtons();
    }

    // Checkpoints & Tracking (Persistent)
    const STORAGE_KEY = 'bridge_puzzle_saves';
    let firstBrokenBeam = null;
    let brokeAtX = 0; let brokeAtY = 0; let brokeStrain = 0;
    let ghostStructure = null;

    function getPersistentSaves() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.error('Failed to load storage:', e);
            return {};
        }
    }

    function saveToPersistentStorage(levelId, design) {
        try {
            const saves = getPersistentSaves();
            saves[levelId] = design;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
        } catch (e) {
            console.error('Failed to save to storage:', e);
        }
    }

    function restoreGhostNodePositions() {
        if (!ghostStructure?.nodes || ghostStructure.nodes.length !== nodes.length) {
            return;
        }

        ghostStructure.nodes.forEach((savedNode, index) => {
            const node = nodes[index];
            if (!node) return;

            node.x = savedNode.x;
            node.y = savedNode.y;
            node.oldX = savedNode.x;
            node.oldY = savedNode.y;

            if (typeof savedNode.fixed === 'boolean') {
                node.fixed = savedNode.fixed;
            }
        });

        beams.forEach(beam => {
            beam.broken = false;
            beam.strain = 0;
        });
    }

    function captureRelativeDesign() {
        const sourceNodes = (
            ghostStructure &&
            (car.state === 'failed' || car.state === 'passed') &&
            ghostStructure.nodes &&
            ghostStructure.nodes.length === nodes.length
        ) ? ghostStructure.nodes : nodes;

        return {
            nodes: sourceNodes.map(n => {
                const relX = levelState.gapWidth > 0 ? (n.x - levelState.bLeftX) / levelState.gapWidth : 0;
                const bankYAtX = levelState.isAsymmetric
                    ? levelState.bankY + relX * (levelState.bankYRight - levelState.bankY)
                    : levelState.bankY;

                return {
                    relX,
                    relY: levelState.gapWidth > 0 ? (n.y - bankYAtX) / levelState.gapWidth : 0,
                    fixed: !!n.fixed
                };
            }),
            beams: beams.map(b => ({
                idxA: nodes.indexOf(b.nodeA),
                idxB: nodes.indexOf(b.nodeB),
                size: b.size,
                isRoad: !!b.isRoad
            }))
        };
    }

    function restoreRelativeDesign(design) {
        if (!design || !design.nodes || design.nodes.length === 0) {
            return false;
        }

        isSimulating = false;
        if (animFrame) cancelAnimationFrame(animFrame);

        hoveredNode = null;
        hoveredBeam = null;
        draggingStartNode = null;
        ghostStructure = null;
        helpBlueprint = null;
        firstBrokenBeam = null;
        brokeAtX = 0;
        brokeAtY = 0;
        brokeStrain = 0;
        statusBanner.classList.add('hidden');

        nodes = design.nodes.map(n => {
            const absX = levelState.bLeftX + (n.relX * levelState.gapWidth);
            const bankYAtX = levelState.isAsymmetric
                ? levelState.bankY + n.relX * (levelState.bankYRight - levelState.bankY)
                : levelState.bankY;
            const absY = bankYAtX + (n.relY * levelState.gapWidth);
            return new Node(absX, absY, n.fixed);
        });

        beams = design.beams
            .filter(b => b.idxA >= 0 && b.idxB >= 0 && b.idxA < nodes.length && b.idxB < nodes.length)
            .map(b => new Beam(nodes[b.idxA], nodes[b.idxB], b.size, !!b.isRoad));

        resetVehicleToStart();
        updateBudgetUI();
        setSimulatingUI(false);
        draw();
        return true;
    }

    function performSave() {
        if(isSimulating) return;
        const design = captureRelativeDesign();
        saveToPersistentStorage(currentLevel, design);
        updateRestoreButtonState();
        if (window.showToast) {
            window.showToast('Level Design Saved!', 'success');
        } else {
            showPuzzleStatus(true, 'Level Design Saved!');
            setTimeout(() => statusBanner.classList.add('hidden'), 2000);
        }
    }

    function performRestore(levelId) {
        const saves = getPersistentSaves();
        const design = saves[levelId];
        return restoreRelativeDesign(design);
    }

    // Anchor points for fixed geometry (Fixed Coordinate Locking)
    let levelState = {
        bLeftX: 0,
        bRightX: 0,
        bankY: 0,
        bankYRight: 0, // Differential height for mountain
        gapWidth: 0,
        isAsymmetric: false
    };

    class Node {
        constructor(x, y, fixed = false) {
            this.x = x; this.y = y;
            this.oldX = x; this.oldY = y;
            this.fixed = fixed;
        }
    }

    class Beam {
        constructor(nodeA, nodeB, size, isRoad = false) {
            this.nodeA = nodeA; this.nodeB = nodeB;
            this.length = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
            this.strain = 0; this.broken = false;
            this.size = size || 'standard';
            this.isRoad = isRoad;
        }
    }

    function updateBudgetUI() {
        currentSpend = beams.reduce((acc, b) => {
            const config = MATERIAL_CONFIG[b.size] || MATERIAL_CONFIG.standard;
            return acc + (b.length * config.cost);
        }, 0);
        const remaining = budget - currentSpend;
        if (isUnlimitedBudget()) {
            budgetDisplay.innerText = 'Unlimited';
            budgetDisplay.classList.remove('over-budget');
        } else {
            budgetDisplay.innerText = `$${Math.round(remaining).toLocaleString()}`;
            if (remaining < 0) {
                budgetDisplay.classList.add('over-budget');
            } else {
                budgetDisplay.classList.remove('over-budget');
            }
        }
    }

    function setOperationMode(mode) {
        operationMode = mode;

        const modeBtnEl = document.getElementById('btn-mode-toggle');
        if (!modeBtnEl) return;

        const modeSpan = modeBtnEl.querySelector('span');
        const isDelete = mode === 'delete';

        if (modeSpan) {
            modeSpan.innerText = mode === 'truss' ? 'Truss' : isDelete ? 'Delete' : 'Road';
        }

        modeBtnEl.classList.toggle('danger-btn', isDelete);
        modeBtnEl.style.color = isDelete
            ? '#ef4444'
            : mode === 'truss'
                ? 'var(--accent)'
                : 'var(--text-primary)';
    }

    function initEnvironment(shouldRestore = false) {
        nodes = [];
        beams = [];
        hoveredNode = null;
        hoveredBeam = null;
        draggingStartNode = null;
        ghostStructure = null;
        helpBlueprint = null; // Clear pedagogical lines on reset/restore
        isSimulating = false;
        car.active = false;
        car.state = 'idle';
        firstBrokenBeam = null;
        brokeAtX = 0; brokeAtY = 0; brokeStrain = 0;
        statusBanner.classList.add('hidden');

        // Clear undo/redo history — stale snapshots from a previous level
        // reference wrong node indices and would corrupt restore.
        undoStack = [];
        redoStack = [];
        updateUndoButtons(); // Reflect the cleared stacks in the UI immediately

        setOperationMode('road');

        if(animFrame) cancelAnimationFrame(animFrame);
        currentLevel = levelSelector ? levelSelector.value : 'river';
        
        updateRestoreButtonState();
        
        if (currentLevel === 'river') {
            budget = 15000;
            levelState.gapWidth = Math.min(canvas.width * 0.45, 400);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.6;
            levelState.isAsymmetric = false;
            
            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 50, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY + 50, true));
        } else if (currentLevel === 'city') {
            budget = 22000;
            levelState.gapWidth = Math.min(canvas.width * 0.8, 800);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.4;
            levelState.isAsymmetric = false;
            
            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 80, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY + 80, true));
        } else if (currentLevel === 'highway') {
            budget = 30000;
            levelState.gapWidth = Math.min(canvas.width * 0.7, 700);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.5;
            levelState.isAsymmetric = false;
            
            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 80, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY + 80, true));

            const pX = canvas.width / 2;
            nodes.push(new Node(pX - 30, canvas.height * 0.45, true));
            nodes.push(new Node(pX + 30, canvas.height * 0.45, true));
            nodes.push(new Node(pX - 30, canvas.height * 0.6, true));
            nodes.push(new Node(pX + 30, canvas.height * 0.6, true));
        } else if (currentLevel === 'pylons') {
            budget = 40000;
            levelState.gapWidth = Math.min(canvas.width * 0.85, 900);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.55;
            levelState.isAsymmetric = false;

            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 80, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY + 80, true));

            const p1X = levelState.bLeftX + levelState.gapWidth * 0.33;
            const p2X = levelState.bLeftX + levelState.gapWidth * 0.66;
            [p1X, p2X].forEach(px => {
                nodes.push(new Node(px - 15, levelState.bankY + 40, true));
                nodes.push(new Node(px + 15, levelState.bankY + 40, true));
                nodes.push(new Node(px - 15, levelState.bankY + 120, true));
                nodes.push(new Node(px + 15, levelState.bankY + 120, true));
            });
        } else if (currentLevel === 'mountain') {
            budget = 42000;
            levelState.gapWidth = Math.min(canvas.width * 0.7, 750);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.75;
            levelState.bankYRight = canvas.height * 0.35;
            levelState.isAsymmetric = true;

            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 80, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankYRight, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankYRight + 80, true));
        }

        // Logic to disable/enable Heavy beam based on level
        const beamSelector = document.getElementById('beam-size-selector');
        if (beamSelector) {
            const heavyOption = Array.from(beamSelector.options).find(opt => opt.value === 'heavy');
            if (heavyOption) {
                if (currentLevel === 'river') {
                    heavyOption.disabled = true;
                    if (beamSelector.value === 'heavy') {
                        beamSelector.value = 'standard';
                    }
                } else {
                    heavyOption.disabled = false;
                }
            }
        }

        // Pre-generate Level Backgrounds for stability
        const genBG = (count, relMinH, relMaxH) => {
            let data = [];
            for (let i = 0; i < count; i++) {
                data.push({
                    relX: Math.random(),
                    relW: 0.1 + Math.random() * 0.15, // Proportion of canvas width
                    relH: relMinH + Math.random() * (relMaxH - relMinH), // Proportion of canvas height
                    alpha: 0.05 + Math.random() * 0.1
                });
            }
            return data;
        };

        if (currentLevel === 'river') {
            // River elements scale slightly but stay small (4% to 12% of height)
            levelBackgroundData.river = genBG(10, 0.04, 0.12);
        } else if (currentLevel === 'city') {
            levelBackgroundData.city = genBG(15, 0.28, 0.58);
        } else if (currentLevel === 'highway') {
            levelBackgroundData.highway = genBG(8, 0.18, 0.48);
        } else if (currentLevel === 'pylons') {
            levelBackgroundData.pylons = genBG(12, 0.14, 0.44);
        } else if (currentLevel === 'mountain') {
            levelBackgroundData.mountain = [];
            const gs = levelState.bLeftX;
            const ge = levelState.bRightX;
            const gw = ge - gs;

            const farCount = 5;
            for (let i = 0; i < farCount; i++) {
                const t = i / (farCount - 1);
                const relW = 0.12 + Math.random() * 0.14; // Relative to gap width
                levelBackgroundData.mountain.push({
                    layer: 'far',
                    // Relative to gap width and start position
                    relX: (-0.1 + 1.2 * t - relW * 0.5 + (Math.random() - 0.5) * 0.07),
                    relW: relW,
                    relH: 0.40 + Math.random() * 0.30, // 40-70% of canvas height
                    alpha: 0.13 + Math.random() * 0.12
                });
            }

            const midCount = 3;
            for (let i = 0; i < midCount; i++) {
                const t = i / (midCount - 1);
                const relW = 0.16 + Math.random() * 0.18;
                levelBackgroundData.mountain.push({
                    layer: 'mid',
                    relX: (-0.05 + 1.1 * t - relW * 0.5 + (Math.random() - 0.5) * 0.06),
                    relW: relW,
                    relH: 0.48 + Math.random() * 0.27, // 48-75% of canvas height
                    alpha: 0.18 + Math.random() * 0.10
                });
            }
        }

        // Apply Budget Override from Selector
        const budgetSel = document.getElementById('budget-selector');
        if (budgetSel) {
            const mode = budgetSel.value;
            if (mode === 'pro') budget *= 0.8;
            else if (mode === 'easy') budget *= 1.5;
            else if (mode === 'infinite') budget = UNLIMITED_BUDGET;
        }

        resetVehicleToStart();
        
        if (shouldRestore) {
            performRestore(currentLevel);
        } else {
            updateBudgetUI();
            draw();
        }
    }

    const budgetSelector = document.getElementById('budget-selector');
    if (budgetSelector) {
        budgetSelector.addEventListener('change', () => {
            if (isSimulating) return;
            initEnvironment(false); 
        });
    }
 
    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);
 
    const gridToggleBtn = document.getElementById('btn-grid-toggle');
    if (gridToggleBtn) {
        gridToggleBtn.addEventListener('click', () => {
            isGridEnabled = !isGridEnabled;
            const span = gridToggleBtn.querySelector('span');
            if (span) span.innerText = 'Grid';
            gridToggleBtn.classList.toggle('active', isGridEnabled);
            draw();
        });
    }
 
    levelSelector?.addEventListener('change', () => initEnvironment(false));

    // --- Buttons & UI Logic ---
    const modeToggleBtn = document.getElementById('btn-mode-toggle');
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', () => {
            // Cycle: Road -> Truss -> Delete
            if (operationMode === 'road') {
                setOperationMode('truss');
            } else if (operationMode === 'truss') {
                setOperationMode('delete');
            } else {
                setOperationMode('road');
            }
        });
    }

    // ── Fullscreen transition overlay ──────────────────────────────
    // IMPORTANT: The overlay MUST be inside .game-container, not body.
    // When .game-container becomes the fullscreen element, browsers only
    // render that element's subtree — everything on <body> outside it is
    // hidden, so a position:fixed overlay on body is invisible during fullscreen.
    const gameContainerEl = document.querySelector('.game-container');
    const fsOverlay = document.createElement('div');
    fsOverlay.style.cssText = [
        'position:absolute', 'inset:0',
        'background:#000',
        'opacity:0', 'pointer-events:none',
        'z-index:9999',
        'transition:opacity 0.25s ease'
    ].join(';');
    if (gameContainerEl) gameContainerEl.appendChild(fsOverlay);

    const OVERLAY_FADE_MS = 250;

    function animateOverlay(show, callback) {
        fsOverlay.style.opacity = show ? '1' : '0';
        setTimeout(callback, OVERLAY_FADE_MS + 20);
    }

    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            isFullscreenTransitioning = true;
            const container = document.querySelector('.game-container');
            const entering = !document.fullscreenElement && !document.webkitFullscreenElement;

            // ① Snapshot structure IMMEDIATELY before layout shifts
            window._fsSnapshot = captureRelativeDesign();

            // ② Fade out and switch mode
            animateOverlay(true, () => {
                if (entering) {
                    const req = container.requestFullscreen
                        ? container.requestFullscreen()
                        : (container.webkitRequestFullscreen ? container.webkitRequestFullscreen() : null);
                    if (req && req.then) {
                        req.then(() => {
                            if (screen.orientation && screen.orientation.lock) {
                                screen.orientation.lock('landscape').catch(e => console.warn(e));
                            }
                        }).catch(e => {
                            console.warn(e);
                            animateOverlay(false, () => { isFullscreenTransitioning = false; });
                        });
                    }
                } else {
                    const req = document.exitFullscreen
                        ? document.exitFullscreen()
                        : (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);
                    if (req && req.then) {
                        req.then(() => {
                            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
                        }).catch(e => {
                            console.warn(e);
                            animateOverlay(false, () => { isFullscreenTransitioning = false; });
                        });
                    }
                }
            });
        });
    }

    const toggleFsText = () => {
        const entering = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const span = fullscreenBtn ? fullscreenBtn.querySelector('span') : null;
        if (span) span.innerText = entering ? 'Exit' : 'Full';

        // snapshot relative state IMMEDIATELY before layout settles
        const structuralSnapshot = window._fsSnapshot || captureRelativeDesign();
        window._fsSnapshot = null;

        // Wait for CSS/Browser layout to settle
        setTimeout(() => {
            if (!canvas.parentElement) {
                animateOverlay(false, () => { isFullscreenTransitioning = false; });
                return;
            }

            // Compute new canvas dimensions reliably from container
            const uiBar = canvas.parentElement.querySelector('.game-ui');
            const uiH  = uiBar ? uiBar.offsetHeight : 0;
            const newW = canvas.parentElement.clientWidth  || window.innerWidth;
            const newH = (canvas.parentElement.clientHeight - uiH) || Math.round(newW * 0.5);

            canvas.width  = Math.max(newW, 1);
            canvas.height = Math.max(newH, 1);

            // Re-init recalibrates levelState (gapWidth, bLeftX, bankY) for new size
            initEnvironment(false);
            restoreRelativeDesign(structuralSnapshot);
            animateOverlay(false, () => { isFullscreenTransitioning = false; });
        }, 250);
    };
    document.addEventListener('fullscreenchange', toggleFsText);
    document.addEventListener('webkitfullscreenchange', toggleFsText);



    // --- Interaction ---
    canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        let rawX = e.clientX - rect.left;
        let rawY = e.clientY - rect.top;
        
        mousePos.x = rawX;
        mousePos.y = rawY;

        if(!isSimulating) {
            hoveredNode = nodes.find(n => Math.hypot(n.x - rawX, n.y - rawY) < snapRadius && n !== draggingStartNode);
            
            if (isGridEnabled && !hoveredNode) {
                rawX = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
                rawY = Math.round(rawY / GRID_SIZE) * GRID_SIZE;
            }

            if (hoveredNode) {
                mousePos.x = hoveredNode.x;
                mousePos.y = hoveredNode.y;
            } else if (draggingStartNode) {
                // Ortho Snapping
                let dx = rawX - draggingStartNode.x;
                let dy = rawY - draggingStartNode.y;
                let angle = Math.atan2(dy, dx);
                const snapAngle = Math.PI / 4;
                const nearestAngle = Math.round(angle / snapAngle) * snapAngle;
                if (Math.abs(angle - nearestAngle) < 0.17) { // ~10 degrees tolerance
                    let dist = Math.hypot(dx, dy);
                    mousePos.x = draggingStartNode.x + Math.cos(nearestAngle) * dist;
                    mousePos.y = draggingStartNode.y + Math.sin(nearestAngle) * dist;
                }
            }

            hoveredBeam = null;
            if(!hoveredNode && !draggingStartNode) {
                for(let beam of beams) {
                    const d = distToSegment(mousePos, beam.nodeA, beam.nodeB);
                    if(d < 5) {
                        hoveredBeam = beam;
                        break;
                    }
                }
            }
            draw();
        }
    });

    canvas.addEventListener('pointerdown', (e) => {
        if(isSimulating) return;
        
        // Use pointer capture to keep receiving events even if the pointer moves outside the element slightly
        canvas.setPointerCapture(e.pointerId);

        const isDeleteAction = (e.button === 2) || (operationMode === 'delete');

        if (!isDeleteAction && e.button === 0) { 
            if (hoveredNode) {
                // Starting drag from existing node — save history now so undo reverts the upcoming beam
                saveHistory();
                onDesignChange();
                draggingStartNode = hoveredNode;
            } else {
                // Creating a brand new node + potentially a beam — save history before both
                saveHistory();
                onDesignChange();
                const rect = canvas.getBoundingClientRect();
                mousePos.x = e.clientX - rect.left;
                mousePos.y = e.clientY - rect.top;
                const newNode = new Node(mousePos.x, mousePos.y, false);
                nodes.push(newNode);
                draggingStartNode = newNode;
                hoveredNode = newNode;
            }
        } 
        else if (isDeleteAction) { 
            if (hoveredNode && !hoveredNode.fixed) {
                saveHistory();
                onDesignChange();
                beams = beams.filter(b => b.nodeA !== hoveredNode && b.nodeB !== hoveredNode);
                nodes = nodes.filter(n => n !== hoveredNode);
                hoveredNode = null;
            } else if (hoveredBeam) {
                saveHistory();
                onDesignChange();
                beams = beams.filter(b => b !== hoveredBeam);
                hoveredBeam = null;
            }
            updateBudgetUI();
            draw();
        }
    });

    canvas.addEventListener('pointerup', (e) => {
        canvas.releasePointerCapture(e.pointerId);
        if (e.button === 0 && draggingStartNode && !isSimulating && operationMode !== 'delete') {
            let targetNode = hoveredNode;
            
            let dist = Math.hypot(mousePos.x - draggingStartNode.x, mousePos.y - draggingStartNode.y);
            
            // Check illegal lengths
            if (dist > MAX_BEAM_LENGTH) {
                let angle = Math.atan2(mousePos.y - draggingStartNode.y, mousePos.x - draggingStartNode.x);
                mousePos.x = draggingStartNode.x + Math.cos(angle) * MAX_BEAM_LENGTH;
                mousePos.y = draggingStartNode.y + Math.sin(angle) * MAX_BEAM_LENGTH;
                dist = MAX_BEAM_LENGTH;
                
                if (hoveredNode && Math.hypot(mousePos.x - hoveredNode.x, mousePos.y - hoveredNode.y) > snapRadius) {
                    targetNode = null;
                }
            }

            if (!targetNode && dist > 20) {
                targetNode = new Node(mousePos.x, mousePos.y, false);
                nodes.push(targetNode);
            }
            if (targetNode && targetNode !== draggingStartNode) {
                let actualDist = Math.hypot(targetNode.x - draggingStartNode.x, targetNode.y - draggingStartNode.y);
                if (actualDist <= MAX_BEAM_LENGTH) {
                    const exists = beams.some(b => 
                        (b.nodeA === draggingStartNode && b.nodeB === targetNode) ||
                        (b.nodeB === draggingStartNode && b.nodeA === targetNode)
                    );
                    if(!exists) {
                        // No saveHistory here — it was already called in pointerdown
                        const beamSize = (operationMode === 'road') ? 'road' : (document.getElementById('beam-size-selector') ? document.getElementById('beam-size-selector').value : 'standard');
                        beams.push(new Beam(draggingStartNode, targetNode, beamSize, operationMode === 'road'));
                        updateBudgetUI();
                    }
                }
            }
            draggingStartNode = null;
            draw();
        }
    });

    canvas.addEventListener('pointerleave', () => {
        if (draggingStartNode && !isSimulating) {
            // If we were dragging from a freshly-created node (it has no beams yet
            // and wasn't there before pointerdown), remove it to avoid orphan nodes.
            const hasNoBeams = !beams.some(b => b.nodeA === draggingStartNode || b.nodeB === draggingStartNode);
            if (!draggingStartNode.fixed && hasNoBeams) {
                // Also roll back the history entry that was pushed for this node
                undoStack.pop();
                nodes = nodes.filter(n => n !== draggingStartNode);
                updateUndoButtons();
            }
            draggingStartNode = null;
            draw();
        }
    });

    // --- Physics Engine (Verlet + Raycast Pathing) ---
    function simulate() {
        if(!isSimulating) return;

        // Apply external forces (Gravity)
        nodes.forEach(n => {
            if (!n.fixed) {
                const vx = n.x - n.oldX;
                const vy = n.y - n.oldY;
                n.oldX = n.x;
                n.oldY = n.y;
                n.x += vx * 0.99;
                n.y += vy * 0.99 + GRAVITY;
            }
        });

        // Resolve Beams
        for (let i = 0; i < RELAXATION_ITERATIONS; i++) {
            beams.forEach(b => {
                if(b.broken) return;

                const dx = b.nodeB.x - b.nodeA.x;
                const dy = b.nodeB.y - b.nodeA.y;
                const dist = Math.hypot(dx, dy);
                if (dist === 0) return;
                
                const diff = b.length - dist;
                b.strain = Math.abs(diff) / b.length;
                
                const material = MATERIAL_CONFIG[b.size] || MATERIAL_CONFIG.standard;
                const targetYield = material.yield;
                
                if(b.strain > targetYield && isSimulating) {
                    b.broken = true;  // Snap!
                    if (!firstBrokenBeam) {
                        firstBrokenBeam = b;
                        // ANCHOR: Use original coordinates from ghostStructure for the X mark
                        const bIdx = beams.indexOf(b);
                        if (ghostStructure && ghostStructure.beams[bIdx]) {
                            brokeAtX = ghostStructure.beams[bIdx].midX;
                            brokeAtY = ghostStructure.beams[bIdx].midY;
                        } else {
                            brokeAtX = (b.nodeA.x + b.nodeB.x) / 2;
                            brokeAtY = (b.nodeA.y + b.nodeB.y) / 2;
                        }
                        brokeStrain = b.strain / targetYield;
                    }
                }

                const percent = diff / dist / 2;
                const offsetX = dx * percent;
                const offsetY = dy * percent;

                if (!b.nodeA.fixed) {
                    b.nodeA.x -= offsetX;
                    b.nodeA.y -= offsetY;
                }
                if (!b.nodeB.fixed) {
                    b.nodeB.x += offsetX;
                    b.nodeB.y += offsetY;
                }
            });
        }

        // --- Logic: Vehicle Pathfinding ---
        if (car.active && car.state === 'driving') {
            car.x += car.speed;
            
            // Find track: Prefer the track (beam or ground) physically spanning car's X coordinate 
            // that is closest to the car's current elevation (car.y+10).
            let trackY = null;
            let currentBeam = null;
            let minDiff = Infinity;
            const carBottom = car.y + 10;
            
            // Check all solid beams - ONLY Road beams can be driveable track
            beams.forEach(b => {
                if (b.broken || !b.isRoad) return;
                let minX = Math.min(b.nodeA.x, b.nodeB.x);
                let maxX = Math.max(b.nodeA.x, b.nodeB.x);
                
                // Add tiny buffer so car doesn't fall through connecting joints
                if (car.x >= minX - 1 && car.x <= maxX + 1) {
                    let yAtX;
                    let t = (car.x - b.nodeA.x) / (b.nodeB.x - b.nodeA.x);
                    if (Number.isFinite(t)) {
                        yAtX = b.nodeA.y + t * (b.nodeB.y - b.nodeA.y);
                    } else {
                        yAtX = Math.min(b.nodeA.y, b.nodeB.y);
                    }
                    
                    let diff = Math.abs(yAtX - carBottom);
                    if (diff < minDiff) {
                        minDiff = diff;
                        trackY = yAtX;
                        currentBeam = b;
                    }
                }
            });

            // Check Ground Surfaces (Banks and Pylons)
            const checkGround = (gy, rangeStart, rangeEnd) => {
                if (car.x >= rangeStart && car.x <= rangeEnd) {
                    let diff = Math.abs(gy - carBottom);
                    if (diff < minDiff) {
                        minDiff = diff;
                        trackY = gy;
                        currentBeam = null;
                    }
                }
            };

            // Main Banks (Ground)
            checkGround(levelState.bankY, -1000, levelState.bLeftX);
            if (currentLevel === 'mountain') {
                checkGround(levelState.bankYRight, levelState.bRightX, canvas.width + 1000);
            } else {
                checkGround(levelState.bankY, levelState.bRightX, canvas.width + 1000);
            }

            // Industrial Pylons (Levels 3 & 4) - Register tops as solid ground
            if (currentLevel === 'highway') {
                const pX = canvas.width / 2;
                checkGround(canvas.height * 0.45, pX - 55, pX + 55);
            } else if (currentLevel === 'pylons') {
                const p1X = levelState.bLeftX + levelState.gapWidth * 0.33;
                const p2X = levelState.bLeftX + levelState.gapWidth * 0.66;
                [p1X, p2X].forEach(px => checkGround(levelState.bankY + 40, px - 35, px + 35));
            }

            if (trackY !== null) {
                // Stick to track
                car.y = trackY - 10;
                car.vy = 0;
                car.rotation = car.rotation * 0.9; // Level out on track
                
                // Track Slope Calculation
                // Only apply vehicle load while the car is over the bridge span,
                // not when it is still riding the fixed ground banks.
                if(currentBeam && car.x > levelState.bLeftX && car.x < levelState.bRightX) {
                    if(car.speed > 0) {
                        let totalDx = currentBeam.nodeB.x - currentBeam.nodeA.x;
                        let tPrc = totalDx !== 0 ? (car.x - currentBeam.nodeA.x) / totalDx : 0.5;
                        let load = GRAVITY * 7.5; // Calibrated for structural challenge (mandatory trussing)
                        
                        if (!currentBeam.nodeA.fixed) currentBeam.nodeA.y += load * (1 - tPrc);
                        if (!currentBeam.nodeB.fixed) currentBeam.nodeB.y += load * tPrc;
                    }
                }
            } else {
                // Realistic Physics Fall
                car.vy += GRAVITY;
                car.y += car.vy;
                car.rotation += 0.05 * car.speed;
            }

            // Win / Loss Conditions
            if (car.state === 'driving' && car.y > canvas.height) {
                // First time falling below screen
                car.state = 'failed';
                isSimulating = false;
                let failReason = firstBrokenBeam ? `Beam snapped at ${(brokeStrain * 100).toFixed(0)}% stress!` : 'Catastrophic Structural Failure! The vehicle fell.';
                showPuzzleStatus(false, failReason);
                // Keep UI DISABLED until explicitly closed or reset
            } else if (car.y > canvas.height + 200) {
                // Done simulating entirely - hide car
                car.active = false;
            } else if (car.state === 'driving' && car.x > levelState.bRightX + 20) {
                car.state = 'passed';
                // Success: Stop the loop since we usually transition or celebrate
                isSimulating = false;
                showPuzzleStatus(true, 'Structural Integrity Confirmed! You Win!');
                setSimulatingUI(false); 
            }
        }

        draw();
        
        if (isSimulating) {
             animFrame = requestAnimationFrame(simulate);
        }
    }

    function showPuzzleStatus(isSuccess, message) {
        statusBanner.className = 'game-status';
        statusBanner.classList.add(isSuccess ? 'success' : 'failure');
        statusBanner.classList.remove('hidden');
        statusText.innerText = message;
        
        const helpBtn = document.getElementById('btn-status-help');
        if (helpBtn) {
            helpBtn.style.display = (!isSuccess && LEVEL_SOLUTIONS[currentLevel]?.length > 0) ? 'block' : 'none';
        }
    }

    document.getElementById('btn-status-help')?.addEventListener('click', () => {
        const solutions = LEVEL_SOLUTIONS[currentLevel];
        if (solutions && solutions.length > 0) {
            const randomSol = solutions[Math.floor(Math.random() * solutions.length)];
            
            // pedagogical mode: don't auto-solve, just projection ghost blueprint
            statusBanner.classList.add('hidden');

            const solNodes = randomSol.nodes.map(n => {
                let absX = levelState.bLeftX + (n.relX * levelState.gapWidth);
                let bankYAtX = levelState.isAsymmetric 
                    ? levelState.bankY + n.relX * (levelState.bankYRight - levelState.bankY)
                    : levelState.bankY;
                let absY = bankYAtX + (n.relY * levelState.gapWidth);
                return { x: absX, y: absY };
            });

            helpBlueprint = {
                nodes: solNodes,
                beams: randomSol.beams.map(b => ({
                    nodeA: solNodes[b.idxA],
                    nodeB: solNodes[b.idxB]
                }))
            };
            
            if (window.showToast) window.showToast('Blueprint displayed! Trace the ghost lines.', 'success');
            
            isSimulating = false;
            onDesignChange();
            draw();
        }
    });

    statusClose.addEventListener('click', () => {
        statusBanner.classList.add('hidden');
        if (car.state === 'failed') {
            // Re-enable UI so the user can BUILD (or delete), 
            // but the Run button will stay disabled (managed in setSimulatingUI) 
            // until they make a change.
            restoreGhostNodePositions();
            ghostStructure = null;
            isSimulating = false;
            setSimulatingUI(false);
            draw();
        } else if (car.state === 'passed') {
            restoreGhostNodePositions();
            ghostStructure = null;
            isSimulating = false;
            setSimulatingUI(false);
            car.active = false;
            draw();
        }
    });

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';

        // 1. SKY & DISTANT BACKGROUND (Atmospheric Layer)
        const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (currentLevel === 'river') {
            // Anchor elements to just above the river surface (riverDepthY = bankY + 120).
            const riverDepthY = levelState.bankY + 120;
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#2d064e'); skyGrad.addColorStop(0.6, '#160436');
            } else if (theme === 'light') {
                skyGrad.addColorStop(0, '#bae6fd'); skyGrad.addColorStop(0.6, '#f0f9ff');
            } else {
                skyGrad.addColorStop(0, '#0c4a6e'); skyGrad.addColorStop(0.6, '#075985');
            }
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
            levelBackgroundData.river.forEach(n => {
                ctx.fillStyle = theme === 'vibrant' ? '#d8b4fe' : (theme === 'light' ? '#7dd3fc' : '#38bdf8');
                ctx.globalAlpha = n.alpha;
                const h = n.relH * canvas.height;
                const w = n.relW * canvas.width;
                ctx.fillRect(n.relX * canvas.width, riverDepthY - h, w, h);
            });

        } else if (currentLevel === 'city') {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#160436'); skyGrad.addColorStop(0.6, '#090014');
            } else if (theme === 'light') {
                skyGrad.addColorStop(0, '#cbd5e1'); skyGrad.addColorStop(0.6, '#f8fafc');
            } else {
                skyGrad.addColorStop(0, '#0f172a'); skyGrad.addColorStop(0.6, '#141e33');
            }
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
            levelBackgroundData.city.forEach(n => {
                ctx.fillStyle = theme === 'vibrant' ? '#b249f8' : (theme === 'light' ? '#64748b' : '#cbd5e1');
                ctx.globalAlpha = n.alpha;
                const h = n.relH * canvas.height;
                const w = n.relW * canvas.width;
                ctx.fillRect(n.relX * canvas.width, canvas.height - h, w, h);
            });

        } else if (currentLevel === 'mountain') {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#2d064e'); skyGrad.addColorStop(0.6, '#090014');
            } else if (theme === 'light') {
                skyGrad.addColorStop(0, '#e2e8f0'); skyGrad.addColorStop(0.6, '#f1f5f9');
            } else {
                skyGrad.addColorStop(0, '#1e1b4b'); skyGrad.addColorStop(0.6, '#312e81');
            }
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);

            const gs = levelState.bLeftX;
            const ge = levelState.bRightX;
            const gw = ge - gs;

            levelBackgroundData.mountain.forEach(n => {
                if (n.layer === 'far') {
                    ctx.fillStyle = theme === 'vibrant' ? '#ff007f' : (theme === 'light' ? '#94a3b8' : '#818cf8');
                } else {
                    ctx.fillStyle = theme === 'vibrant' ? '#c2185b' : (theme === 'light' ? '#64748b' : '#6366f1');
                }
                ctx.globalAlpha = n.alpha;
                const h = n.relH * canvas.height;
                const w = n.relW * gw;
                const x = gs + n.relX * gw;
                ctx.beginPath(); ctx.moveTo(x, canvas.height);
                ctx.lineTo(x + w / 2, canvas.height - h);
                ctx.lineTo(x + w, canvas.height); ctx.fill();
            });

        } else {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#160436'); skyGrad.addColorStop(0.6, '#090014');
            } else if (theme === 'light') {
                skyGrad.addColorStop(0, '#cbd5e1'); skyGrad.addColorStop(0.6, '#f8fafc');
            } else {
                skyGrad.addColorStop(0, '#0f172a'); skyGrad.addColorStop(0.6, '#1e293b');
            }
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const depthBG = (currentLevel === 'highway') ? levelBackgroundData.highway : levelBackgroundData.pylons;
            depthBG.forEach(n => {
                ctx.fillStyle = theme === 'vibrant' ? '#b249f8' : (theme === 'light' ? '#94a3b8' : '#cbd5e1');
                ctx.globalAlpha = n.alpha;
                const h = n.relH * canvas.height;
                const w = n.relW * canvas.width;
                ctx.fillRect(n.relX * canvas.width, canvas.height - h, w, h);
            });
        }
        ctx.globalAlpha = 1.0;

        // 2. GRID (Utility Layer)
        if (isGridEnabled) {
            ctx.fillStyle = theme === 'light' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)';
            for (let x = 0; x < canvas.width; x += GRID_SIZE) {
                for (let y = 0; y < canvas.height; y += GRID_SIZE) {
                    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
                }
            }
        }

        // 3. TERRAIN (Level Specific)
        const p = themePalette;
        if (currentLevel === 'river') {
            ctx.fillStyle = p.riverBank;
            ctx.fillRect(0, levelState.bankY, levelState.bLeftX, canvas.height);
            ctx.fillRect(levelState.bRightX, levelState.bankY, canvas.width, canvas.height);
            
            const riverGrad = ctx.createLinearGradient(levelState.bLeftX, 0, levelState.bRightX, 0);
            riverGrad.addColorStop(0, '#0284c7'); riverGrad.addColorStop(0.5, '#0ea5e9'); riverGrad.addColorStop(1, '#0284c7');
            ctx.fillStyle = riverGrad; ctx.fillRect(levelState.bLeftX, levelState.bankY + 120, levelState.gapWidth, canvas.height);
            
            ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
            const waveOff = (Date.now() * 0.05) % 100;
            for(let i = 0; i < 5; i++) {
                ctx.beginPath(); ctx.moveTo(levelState.bLeftX, levelState.bankY + 130 + i*15); ctx.lineTo(levelState.bRightX, levelState.bankY + 130 + i*15);
                ctx.setLineDash([20, 30]); ctx.lineDashOffset = waveOff * (i%2 ? 1 : -1); ctx.stroke();
            }
            ctx.setLineDash([]);
        } else if (currentLevel === 'city') {
            const drawBuilding = (startX, width) => {
                ctx.fillStyle = p.cityBank; ctx.fillRect(startX, levelState.bankY, width, canvas.height);
                ctx.fillStyle = p.pier2; ctx.fillRect(startX + width * 0.1, levelState.bankY + 20, width * 0.8, canvas.height);
                ctx.strokeStyle = p.cityBank; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(startX + width * 0.5, levelState.bankY); ctx.lineTo(startX + width * 0.5, levelState.bankY - 30); ctx.stroke();
                if (Math.sin(Date.now() * 0.005) > 0) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(startX + width * 0.5, levelState.bankY - 30, 3, 0, Math.PI*2); ctx.fill(); }
                ctx.shadowBlur = 10; ctx.shadowColor = '#fef08a'; ctx.fillStyle = '#fef08a'; ctx.globalAlpha = 0.4;
                const cols = Math.floor(width / 35);
                for(let c = 0; c < cols; c++) {
                    let wx = startX + 10 + (c * 35);
                    if (wx + 15 > startX + width) continue;
                    for(let y = levelState.bankY + 30; y < canvas.height - 40; y += 50) {
                        if ((c + y) % 7 !== 0) { ctx.fillRect(wx, y, 6, 10); ctx.fillRect(wx + 10, y, 6, 10); }
                    }
                }
                ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
            };
            drawBuilding(0, levelState.bLeftX); drawBuilding(levelState.bRightX, canvas.width - levelState.bRightX);
        } else if (currentLevel === 'highway') {
            ctx.fillStyle = p.hwBank;
            ctx.fillRect(0, levelState.bankY, levelState.bLeftX, canvas.height); 
            ctx.fillRect(levelState.bRightX, levelState.bankY, canvas.width, canvas.height);
            const pX = canvas.width / 2;
            ctx.fillStyle = p.pier1; ctx.fillRect(pX - 40, canvas.height * 0.45, 80, canvas.height);
            ctx.fillStyle = p.pier2; ctx.fillRect(pX - 55, canvas.height * 0.45, 110, 20);
        } else if (currentLevel === 'pylons') {
            ctx.fillStyle = p.hwBank;
            ctx.fillRect(0, levelState.bankY, levelState.bLeftX, canvas.height); 
            ctx.fillRect(levelState.bRightX, levelState.bankY, canvas.width, canvas.height);
            const p1X = levelState.bLeftX + levelState.gapWidth * 0.33;
            const p2X = levelState.bLeftX + levelState.gapWidth * 0.66;
            [p1X, p2X].forEach(px => {
                ctx.fillStyle = p.pier1; ctx.fillRect(px - 20, levelState.bankY + 40, 40, canvas.height);
                ctx.fillStyle = p.pier2; ctx.fillRect(px - 35, levelState.bankY + 40, 70, 20);
            });
        } else if (currentLevel === 'mountain') {
            // Helper: fill a triangular mountain peak
            const drawPeak = (x, peakY, w, color, alpha = 1.0) => {
                ctx.fillStyle = color;
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height);
                ctx.lineTo(x + w / 2, peakY);
                ctx.lineTo(x + w, canvas.height);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            };

            // Solid bank fills (flat rectangles)
            ctx.fillStyle = p.riverBank;
            ctx.fillRect(0, levelState.bankY, levelState.bLeftX, canvas.height);
            ctx.fillRect(levelState.bRightX, levelState.bankYRight, canvas.width, canvas.height);

            const bankW = levelState.bLeftX;
            const rightW = canvas.width - levelState.bRightX;

            // ── LEFT BANK: 4 staggered ridge peaks ──────────────────
            // Peaks overlap and vary in height to break the flat rectangle top.
            drawPeak(-bankW * 0.15,  levelState.bankY - canvas.height * 0.08,  bankW * 0.65, p.mtnColor);
            drawPeak( bankW * 0.20,  levelState.bankY - canvas.height * 0.04,  bankW * 0.60, p.riverBank, 0.9);
            drawPeak(-bankW * 0.05,  levelState.bankY - canvas.height * 0.12,  bankW * 0.50, p.mtnColor, 0.85);
            drawPeak( bankW * 0.40,  levelState.bankY - canvas.height * 0.06,  bankW * 0.70, p.mtnColor, 0.7);

            // ── RIGHT BANK: 4 staggered ridge peaks ─────────────────
            drawPeak(levelState.bRightX - rightW * 0.15, levelState.bankYRight - canvas.height * 0.14, rightW * 0.65, p.mtnColor);
            drawPeak(levelState.bRightX + rightW * 0.15, levelState.bankYRight - canvas.height * 0.08, rightW * 0.60, p.riverBank, 0.9);
            drawPeak(levelState.bRightX - rightW * 0.05, levelState.bankYRight - canvas.height * 0.18, rightW * 0.50, p.mtnColor, 0.85);
            drawPeak(levelState.bRightX + rightW * 0.35, levelState.bankYRight - canvas.height * 0.10, rightW * 0.70, p.mtnColor, 0.7);
        }
        
        // 3.5 Pedagogical Ghost Blueprint
        if (helpBlueprint) {
            ctx.save();
            ctx.setLineDash([8, 8]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = theme === 'light' ? 'rgba(71, 85, 105, 0.4)' : 'rgba(148, 163, 184, 0.4)';
            
            helpBlueprint.beams.forEach(gb => {
                ctx.beginPath();
                ctx.moveTo(gb.nodeA.x, gb.nodeA.y);
                ctx.lineTo(gb.nodeB.x, gb.nodeB.y);
                ctx.stroke();
            });

            ctx.fillStyle = ctx.strokeStyle;
            helpBlueprint.nodes.forEach(gn => {
                ctx.beginPath();
                ctx.arc(gn.x, gn.y, 3, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }

        // 4. NODES, BEAMS, CAR (Interactive Layer)
        if (draggingStartNode && !isSimulating) {
            ctx.beginPath(); ctx.moveTo(draggingStartNode.x, draggingStartNode.y);
            let currentDist = Math.hypot(mousePos.x - draggingStartNode.x, mousePos.y - draggingStartNode.y);
            let drawX = mousePos.x, drawY = mousePos.y;
            if (currentDist > MAX_BEAM_LENGTH) {
                let angle = Math.atan2(mousePos.y - draggingStartNode.y, mousePos.x - draggingStartNode.x);
                drawX = draggingStartNode.x + Math.cos(angle) * MAX_BEAM_LENGTH;
                drawY = draggingStartNode.y + Math.sin(angle) * MAX_BEAM_LENGTH;
            }
            ctx.lineTo(drawX, drawY); ctx.strokeStyle = p.beamDraft; ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        }

        beams.forEach(b => {
            if(b.broken) return;
            ctx.beginPath(); ctx.moveTo(b.nodeA.x, b.nodeA.y); ctx.lineTo(b.nodeB.x, b.nodeB.y);

            // Material and Stress Logic
            const material = MATERIAL_CONFIG[b.size] || MATERIAL_CONFIG.standard;
            const targetYield = material.yield;
            const stressPrc = Math.min(b.strain / targetYield, 1);

            if (b.isRoad) {
                // Specialized Road drawing: Thick dark gray line (the deck)
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 12;
                ctx.stroke();
                
                // Add center line
                ctx.setLineDash([10, 10]);
                ctx.strokeStyle = '#fde047';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Final thin highlight
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                if(isSimulating) {
                    // Professional Heatmap: Green -> Yellow -> Orange -> Red
                    const hue = (1 - stressPrc) * 120; // 120 is green, 0 is red
                    ctx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
                    if (stressPrc > 0.8) {
                        ctx.shadowBlur = 8;
                        ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
                    }
                } else {
                    ctx.strokeStyle = hoveredBeam === b ? '#ef4444' : p.beam;
                }
                ctx.lineWidth = b.size === 'light' ? 2.5 : (b.size === 'heavy' ? 8 : 4.5);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Shared telemetry display for ALL beams (Truss + Road)
            if (isSimulating) {
                let centerX = (b.nodeA.x + b.nodeB.x) / 2; 
                let centerY = (b.nodeA.y + b.nodeB.y) / 2;
                
                if (stressPrc > 0.05) {
                    ctx.font = 'bold 12px sans-serif'; 
                    ctx.fillStyle = stressPrc > 0.9 ? '#ff0000' : '#ffffff'; 
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    
                    // Offset text slightly above the beam to ensure visibility
                    // even on thick Road pieces (12px) or Heavy beams (8px)
                    const labelOffset = b.isRoad ? 18 : 12;
                    
                    // High-contrast outline
                    ctx.save();
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = '#000000';
                    ctx.strokeText(`${(stressPrc * 100).toFixed(0)}%`, centerX, centerY - labelOffset);
                    ctx.fillText(`${(stressPrc * 100).toFixed(0)}%`, centerX, centerY - labelOffset);
                    ctx.restore();
                }
            }
        });

        // Diagnostic Ghost View (Pre-simulation Structure)
        if (ghostStructure && car.state === 'failed') {
            ctx.globalAlpha = 0.45;
            ctx.setLineDash([4, 4]);
            
            // Theme-aware contrast for the blueprint layer
            let ghostColor = '#94a3b8'; // Default
            if (theme === 'light') ghostColor = '#475569';
            else if (theme === 'vibrant') ghostColor = '#d8b4fe';
            else ghostColor = '#cbd5e1'; 

            ctx.strokeStyle = ghostColor;
            ctx.lineWidth = 2;
            
            // Draw Ghost Beams
            ghostStructure.beams.forEach(gb => {
                ctx.beginPath(); ctx.moveTo(gb.x1, gb.y1); ctx.lineTo(gb.x2, gb.y2); ctx.stroke();
            });
            ctx.setLineDash([]);
            
            // Draw Ghost Nodes
            ctx.fillStyle = ghostColor;
            ghostStructure.nodes.forEach(gn => {
                ctx.beginPath(); ctx.arc(gn.x, gn.y, 3, 0, Math.PI * 2); ctx.fill();
            });
            
            ctx.globalAlpha = 1.0;
        }

        nodes.forEach(n => {
            ctx.beginPath(); ctx.arc(n.x, n.y, n.fixed ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = n.fixed ? p.nodeFixed : (hoveredNode === n ? '#ef4444' : p.nodeFree); ctx.fill();
            ctx.strokeStyle = p.nodeBorder; ctx.lineWidth = n.fixed ? 2 : 1; ctx.stroke();
        });

        if (car.active || (!isSimulating && car.x > 0)) {
            let wheelRot = car.x * 0.1; 
            let bounceY = car.y + (car.active && car.state === 'driving' ? Math.abs(Math.sin(car.x * 0.15)) * 1.5 : 0);
            
            ctx.save();
            ctx.translate(car.x + 20, bounceY - 10);
            ctx.rotate(car.rotation);
            ctx.translate(-(car.x + 20), -(bounceY - 10));

            if (car.active && car.speed > 0 && car.state === 'driving') {
                ctx.fillStyle = `rgba(150, 150, 150, 0.4)`; ctx.beginPath();
                ctx.arc(car.x - 15, car.y - 5 + Math.sin(car.x*0.5)*3, 6, 0, Math.PI*2); ctx.fill();
                ctx.arc(car.x - 22, car.y - 10 + Math.cos(car.x*0.4)*5, 10, 0, Math.PI*2); ctx.fill();
            }
            ctx.fillStyle = p.carBase; ctx.fillRect(car.x - 2, bounceY - 8, 42, 6);
            ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.roundRect(car.x + 22, bounceY - 24, 18, 18, 4); ctx.fill();
            ctx.fillStyle = p.beamDraft; ctx.fillRect(car.x + 28, bounceY - 20, 10, 8);
            ctx.fillStyle = '#eab308'; ctx.fillRect(car.x + 38, bounceY - 10, 3, 4);
            ctx.fillStyle = p.carBox; ctx.fillRect(car.x, bounceY - 32, 24, 26);
            const drawWheel = (wx, wy, rot) => {
                ctx.save(); ctx.translate(wx, wy); ctx.rotate(rot); ctx.fillStyle = p.wheel; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = p.beamDraft; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = p.nodeFixed; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke(); ctx.restore();
            };
            drawWheel(car.x + 6, car.y - 2, wheelRot); drawWheel(car.x + 32, car.y - 2, wheelRot);
            ctx.restore();
        }

        if (mousePos.x > 0 && mousePos.y > 0 && !isSimulating && operationMode !== 'delete') {
            ctx.fillStyle = p.nodeFixed; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
            ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
            ctx.fillText(`(X: ${Math.round(mousePos.x)}, Y: ${Math.round(mousePos.y)})`, mousePos.x + 15, mousePos.y + 15); ctx.shadowBlur = 0;
        }

        if (firstBrokenBeam && car.state === 'failed') {
            const pulse = (Math.sin(Date.now() * 0.01) + 1) * 5;
            ctx.beginPath(); ctx.arc(brokeAtX, brokeAtY, 20 + pulse, 0, Math.PI * 2); 
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444'; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(brokeAtX - 12, brokeAtY - 12); ctx.lineTo(brokeAtX + 12, brokeAtY + 12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(brokeAtX + 12, brokeAtY - 12); ctx.lineTo(brokeAtX - 12, brokeAtY + 12); ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    // (Theme change redraws are handled by the MutationObserver above)

    function distToSegment(p, v, w) {
        let l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    }

    // --- Buttons ---
    document.getElementById('btn-save-checkpoint')?.addEventListener('click', performSave);

    document.getElementById('btn-restore-checkpoint')?.addEventListener('click', () => {
        const success = performRestore(currentLevel);
        if (!success) {
            showPuzzleStatus(false, 'No saved structure for this level!');
            setTimeout(() => statusBanner.classList.add('hidden'), 2000);
        }
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        // Force blank slate (passing false to initEnvironment)
        initEnvironment(false);
        setSimulatingUI(false);
    });

    document.getElementById('btn-simulate').addEventListener('click', () => {
        // Allow Restart if not simulating OR if already failed/passed (Visual Review phase)
        if(!isSimulating || car.state === 'failed' || car.state === 'passed') {
            updateBudgetUI(); // One last check
            if (budget - currentSpend < 0 && !isUnlimitedBudget()) {
                showPuzzleStatus(false, 'Cannot test: You are over budget! Delete beams.');
                return;
            }
            isSimulating = true;
            statusBanner.classList.add('hidden');
            resetVehicleToStart();
            car.active = true;
            car.state = 'driving';
            firstBrokenBeam = null;
            brokeAtX = 0; brokeAtY = 0; brokeStrain = 0;
            
            // Capture Ghost State for post-mortem analysis
            ghostStructure = {
                nodes: nodes.map(n => ({ x: n.x, y: n.y, fixed: n.fixed })),
                beams: beams.map(b => ({
                    x1: b.nodeA.x, y1: b.nodeA.y,
                    x2: b.nodeB.x, y2: b.nodeB.y,
                    midX: (b.nodeA.x + b.nodeB.x) / 2,
                    midY: (b.nodeA.y + b.nodeB.y) / 2
                }))
            };

            // Reset beam state from any previous run
            beams.forEach(b => { b.broken = false; b.strain = 0; });
            nodes.forEach(n => { n.oldX = n.x; n.oldY = n.y; });
            setSimulatingUI(true); // Lock all tool buttons while simulation runs
            simulate();
        }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement?.tagName;
        const isTypingTarget = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';

        if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget && (e.key === 'g' || e.key === 'G')) {
            e.preventDefault();
            gridToggleBtn?.click();
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                undo();
            } else if (e.key === 'y' || e.key === 'Y' || ( (e.key === 'z' || e.key === 'Z') && e.shiftKey)) {
                e.preventDefault();
                redo();
            }
        }
    });

    // Boot — explicit full init on first load (keepLevel = false → calls initEnvironment)
    setTimeout(() => {
        resizeCanvas(false);
        updateUndoButtons();
    }, 100);
});
