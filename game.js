document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('bridge-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const levelSelector = document.getElementById('level-selector');
    const budgetDisplay = document.getElementById('budget-display');
    const statusBanner = document.getElementById('game-status');
    const statusText = document.getElementById('status-text');
    const statusClose = document.getElementById('btn-status-close');
    
    function resizeCanvas() {
        if (!canvas.parentElement) return;
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.clientHeight || (canvas.width * 0.5);
        initEnvironment();
    }
    window.addEventListener('resize', resizeCanvas);

    // Simulation Data
    let nodes = [];
    let beams = [];
    let isSimulating = false;
    let animFrame = null;
    let currentLevel = 'river';

    // Game Economy Data
    let budget = 15000;
    let currentSpend = 0;

    // Interaction State
    let hoveredNode = null;
    let hoveredBeam = null;
    let draggingStartNode = null;
    let mousePos = { x: 0, y: 0 };
    let snapRadius = 15;
    let operationMode = 'build'; // 'build' or 'delete'

    // Physics constants
    const GRAVITY = 0.6;
    const RELAXATION_ITERATIONS = 50;
    const MAX_BEAM_LENGTH = 140; // Max allowed distance to draw a beam

    const MATERIAL_CONFIG = {
        light: { cost: 3, yield: 0.015, color: 'light' },
        standard: { cost: 5, yield: 0.03, color: 'standard' },
        heavy: { cost: 8, yield: 0.05, color: 'heavy' }
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
    let car = { active: false, x: 0, y: 0, speed: 1.5, state: 'idle' };

    // Undo/Redo System
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;

    function saveHistory() {
        if (isSimulating) return;
        const snapshot = {
            nodes: nodes.map(n => ({ x: n.x, y: n.y, fixed: n.fixed })),
            beams: beams.map(b => ({
                idxA: nodes.indexOf(b.nodeA),
                idxB: nodes.indexOf(b.nodeB),
                size: b.size
            }))
        };
        undoStack.push(snapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = []; // Clear redo on any new action
        updateUndoButtons();
    }

    function restoreFromSnapshot(snapshot) {
        nodes = snapshot.nodes.map(n => new Node(n.x, n.y, n.fixed));
        beams = snapshot.beams.map(b => new Beam(nodes[b.idxA], nodes[b.idxB], b.size));
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
                size: b.size
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
                size: b.size
            }))
        };
        undoStack.push(current);
        const next = redoStack.pop();
        restoreFromSnapshot(next);
        updateUndoButtons();
    }

    // Checkpoints & Tracking
    let checkpointData = { nodes: [], beams: [] };
    let firstBrokenBeam = null;
    let brokeAtX = 0; let brokeAtY = 0; let brokeStrain = 0;

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
        constructor(nodeA, nodeB, size) {
            this.nodeA = nodeA; this.nodeB = nodeB;
            this.length = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
            this.strain = 0; this.broken = false;
            this.size = size || 'standard';
        }
    }

    function updateBudgetUI() {
        currentSpend = beams.reduce((acc, b) => {
            const config = MATERIAL_CONFIG[b.size] || MATERIAL_CONFIG.standard;
            return acc + (b.length * config.cost);
        }, 0);
        let remaining = budget - currentSpend;
        if (budget > 1000000) {
            budgetDisplay.innerText = "♾️ Unlimited";
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

    function initEnvironment() {
        nodes = [];
        beams = [];
        isSimulating = false;
        car.active = false;
        car.state = 'idle';
        firstBrokenBeam = null;
        brokeAtX = 0; brokeAtY = 0; brokeStrain = 0;
        statusBanner.classList.add('hidden');

        if(animFrame) cancelAnimationFrame(animFrame);
        currentLevel = levelSelector ? levelSelector.value : 'river';
        
        if (currentLevel === 'river') {
            budget = 15000;
            levelState.gapWidth = Math.min(canvas.width * 0.5, 500);
            levelState.bLeftX = (canvas.width - levelState.gapWidth) / 2;
            levelState.bRightX = levelState.bLeftX + levelState.gapWidth;
            levelState.bankY = canvas.height * 0.6;
            levelState.isAsymmetric = false;

            nodes.push(new Node(levelState.bLeftX, levelState.bankY, true));
            nodes.push(new Node(levelState.bLeftX, levelState.bankY + 50, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY, true));
            nodes.push(new Node(levelState.bRightX, levelState.bankY + 50, true));
        } else if (currentLevel === 'city') {
            budget = 25000;
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
            budget = 20000;
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
            budget = 18000;
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
            budget = 30000;
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
        const genBG = (count, minH, maxH) => {
            let data = [];
            for (let i = 0; i < count; i++) {
                data.push({
                    x: Math.random() * canvas.width,
                    w: 60 + Math.random() * 100,
                    h: minH + Math.random() * (maxH - minH),
                    alpha: 0.05 + Math.random() * 0.1
                });
            }
            return data;
        };

        if (currentLevel === 'river') {
            levelBackgroundData.river = genBG(10, 50, 120);
        } else if (currentLevel === 'city') {
            levelBackgroundData.city = genBG(15, 100, 250);
        } else if (currentLevel === 'highway') {
            levelBackgroundData.highway = genBG(8, 80, 200);
        } else if (currentLevel === 'pylons') {
            levelBackgroundData.pylons = genBG(12, 60, 180);
        } else if (currentLevel === 'mountain') {
            levelBackgroundData.mountain = [];
            // Jagged mountain peaks
            for (let i = 0; i < 6; i++) {
                levelBackgroundData.mountain.push({
                    x: (canvas.width / 5) * i - 50 + Math.random() * 100,
                    w: 250 + Math.random() * 200,
                    h: 150 + Math.random() * 200
                });
            }
        }

        // Apply Budget Override from Selector
        const budgetSel = document.getElementById('budget-selector');
        if (budgetSel) {
            const mode = budgetSel.value;
            if (mode === 'pro') budget *= 0.8;
            else if (mode === 'easy') budget *= 1.5;
            else if (mode === 'infinite') budget = 999999999;
        }

        car.x = levelState.bLeftX - 50;
        car.y = levelState.bankY - 15;
        
        updateBudgetUI();
        draw();
    }

    const budgetSelector = document.getElementById('budget-selector');
    if (budgetSelector) {
        budgetSelector.addEventListener('change', () => {
            if (isSimulating) return; // Prevent accidental resets during runs
            saveHistory(); 
            initEnvironment(); // Re-calc relative to level
        });
    }

    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);

    const gridToggleBtn = document.getElementById('btn-grid-toggle');
    if (gridToggleBtn) {
        gridToggleBtn.addEventListener('click', () => {
            isGridEnabled = !isGridEnabled;
            const span = gridToggleBtn.querySelector('span');
            if (span) span.innerText = 'Grid'; // Keep 'Grid' as standard
            gridToggleBtn.classList.toggle('active', isGridEnabled);
            draw();
        });
    }

    levelSelector?.addEventListener('change', initEnvironment);

    // --- Buttons & UI Logic ---
    const modeToggleBtn = document.getElementById('btn-mode-toggle');
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', () => {
            const span = modeToggleBtn.querySelector('span');
            if (operationMode === 'build') {
                operationMode = 'delete';
                if (span) span.innerText = 'Delete';
                modeToggleBtn.classList.add('danger-btn');
            } else {
                operationMode = 'build';
                if (span) span.innerText = 'Build';
                modeToggleBtn.classList.remove('danger-btn');
            }
        });
    }

    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const container = document.querySelector('.game-container');
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                let req = container.requestFullscreen ? container.requestFullscreen() : (container.webkitRequestFullscreen ? container.webkitRequestFullscreen() : null);
                if (req && req.then) {
                    req.then(() => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock("landscape").catch(e => console.warn(e));
                        }
                    }).catch(e => console.warn(e));
                }
            } else {
                let req = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);
                if (req && req.then) {
                    req.then(() => {
                        if (screen.orientation && screen.orientation.unlock) {
                            screen.orientation.unlock();
                        }
                    }).catch(e => console.warn(e));
                } else if (document.exitFullscreen) {
                    if (screen.orientation && screen.orientation.unlock) {
                        screen.orientation.unlock();
                    }
                }
            }
        });
    }

    const toggleFsText = () => {
        setTimeout(resizeCanvas, 100);
        const span = fullscreenBtn.querySelector('span');
        if(span) {
            span.innerText = (document.fullscreenElement || document.webkitFullscreenElement) ? 'Exit' : 'Full';
        }
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
            if (hoveredNode) draggingStartNode = hoveredNode;
            else {
                saveHistory();
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
                beams = beams.filter(b => b.nodeA !== hoveredNode && b.nodeB !== hoveredNode);
                nodes = nodes.filter(n => n !== hoveredNode);
                hoveredNode = null;
            } else if (hoveredBeam) {
                saveHistory();
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
                        saveHistory();
                        const beamSize = document.getElementById('beam-size-selector') ? document.getElementById('beam-size-selector').value : 'standard';
                        beams.push(new Beam(draggingStartNode, targetNode, beamSize));
                        updateBudgetUI();
                    }
                }
            }
            draggingStartNode = null;
            draw();
        }
    });

    canvas.addEventListener('pointerleave', () => {
        draggingStartNode = null;
        if(!isSimulating) draw();
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
                        brokeAtX = (b.nodeA.x + b.nodeB.x) / 2;
                        brokeAtY = (b.nodeA.y + b.nodeB.y) / 2;
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
            
            // Find track: The highest solid beam segment physically spanning car's X coordinate
            let trackY = null;
            let currentBeam = null;
            
            beams.forEach(b => {
                if (b.broken) return;
                let minX = Math.min(b.nodeA.x, b.nodeB.x);
                let maxX = Math.max(b.nodeA.x, b.nodeB.x);
                
                // Add tiny buffer so car doesn't fall through connecting joints
                if (car.x >= minX - 1 && car.x <= maxX + 1) {
                    // interpolate Y at car.x
                    let t = (car.x - b.nodeA.x) / (b.nodeB.x - b.nodeA.x);
                    if (Number.isFinite(t)) {
                        let yAtX = b.nodeA.y + t * (b.nodeB.y - b.nodeA.y);
                        // We want the highest track (minimum Y in canvas coords)
                        if (trackY === null || yAtX < trackY) {
                            trackY = yAtX;
                            currentBeam = b;
                        }
                    } else if (car.x === b.nodeA.x) {
                         let maxY = Math.min(b.nodeA.y, b.nodeB.y);
                         if (trackY === null || maxY < trackY) {
                            trackY = maxY;
                         }
                    }
                }
            });

            // Is the car on the ground banks? (Outside the gap area)
            if(car.x <= levelState.bLeftX || car.x >= levelState.bRightX) {
                if (currentLevel === 'mountain') {
                    trackY = (car.x <= levelState.bLeftX) ? levelState.bankY : levelState.bankYRight;
                } else {
                    trackY = levelState.bankY;
                }
            }

            if (trackY !== null) {
                // Stick to track
                car.y = trackY - 10;
                
                // Track Slope Calculation
                if(currentBeam && car.x > 0 && car.x < levelState.bRightX) {
                    // Apply Heavy Weight Load
                    if(car.speed > 0) {
                        let totalDx = currentBeam.nodeB.x - currentBeam.nodeA.x;
                        let tPrc = (car.x - currentBeam.nodeA.x) / totalDx; 
                        let load = GRAVITY * 16.0; 
                        
                        if (!currentBeam.nodeA.fixed) currentBeam.nodeA.y += load * (1 - tPrc);
                        if (!currentBeam.nodeB.fixed) currentBeam.nodeB.y += load * tPrc;
                    }
                }
            } else {
                // Freefall (bridge broke or gap!)
                car.y += car.speed * 4;
            }

            // Win / Loss Conditions
            if (car.y > canvas.height) {
                car.state = 'failed';
                isSimulating = false; // Stop the simulation loop
                let failReason = firstBrokenBeam ? `Beam snapped at ${Math.round(brokeStrain * 100)}% strain!` : 'Catastrophic Structural Failure! The vehicle fell.';
                showGameStatus(false, failReason);
            } else if (car.x > levelState.bRightX + 20) {
                car.state = 'passed';
                isSimulating = false; // Stop the simulation loop
                showGameStatus(true, 'Structural Integrity Confirmed! You Win!');
            }
        }

        draw();
        
        if (isSimulating) {
             animFrame = requestAnimationFrame(simulate);
        }
    }

    function showGameStatus(isSuccess, message) {
        statusBanner.className = 'game-status';
        statusBanner.classList.add(isSuccess ? 'success' : 'failure');
        statusText.innerText = message;
    }

    statusClose.addEventListener('click', () => {
        statusBanner.classList.add('hidden');
    });

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';

        // 1. SKY & DISTANT BACKGROUND (Atmospheric Layer)
        const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (currentLevel === 'river') {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#2d064e'); 
                skyGrad.addColorStop(0.6, '#160436');
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.river.forEach(n => {
                    ctx.fillStyle = '#d8b4fe';
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            } else {
                skyGrad.addColorStop(0, theme === 'light' ? '#bae6fd' : '#0c4a6e'); 
                skyGrad.addColorStop(0.6, theme === 'light' ? '#f0f9ff' : '#075985');
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.river.forEach(n => {
                    ctx.fillStyle = theme === 'light' ? '#7dd3fc' : '#38bdf8'; // Sky blue tint
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            }
        } else if (currentLevel === 'city') {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#160436'); 
                skyGrad.addColorStop(0.6, '#090014'); 
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.city.forEach(n => {
                    ctx.fillStyle = '#b249f8';
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            } else {
                skyGrad.addColorStop(0, theme === 'light' ? '#cbd5e1' : '#0f172a'); 
                skyGrad.addColorStop(0.6, theme === 'light' ? '#f8fafc' : '#141e33'); 
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.city.forEach(n => {
                    ctx.fillStyle = theme === 'light' ? '#64748b' : '#cbd5e1'; // Brighter in dark mode
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            }
        } else if (currentLevel === 'mountain') {
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#2d064e'); 
                skyGrad.addColorStop(0.6, '#090014'); 
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.mountain.forEach(n => {
                    ctx.fillStyle = '#ff007f';
                    ctx.globalAlpha = 0.2;
                    ctx.beginPath(); ctx.moveTo(n.x, canvas.height);
                    ctx.lineTo(n.x + n.w / 2, canvas.height - n.h);
                    ctx.lineTo(n.x + n.w, canvas.height); ctx.fill();
                });
            } else {
                skyGrad.addColorStop(0, theme === 'light' ? '#e2e8f0' : '#1e1b4b'); 
                skyGrad.addColorStop(0.6, theme === 'light' ? '#f1f5f9' : '#312e81'); 
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                levelBackgroundData.mountain.forEach(n => {
                    ctx.fillStyle = theme === 'light' ? '#94a3b8' : '#818cf8'; // Brighter in dark mode
                    ctx.globalAlpha = 0.2;
                    ctx.beginPath(); ctx.moveTo(n.x, canvas.height);
                    ctx.lineTo(n.x + n.w / 2, canvas.height - n.h);
                    ctx.lineTo(n.x + n.w, canvas.height); ctx.fill();
                });
            }
        } else {
            // Highway / Pylons
            if (theme === 'vibrant') {
                skyGrad.addColorStop(0, '#160436');
                skyGrad.addColorStop(0.6, '#090014');
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                const depthBG = (currentLevel === 'highway') ? levelBackgroundData.highway : levelBackgroundData.pylons;
                depthBG.forEach(n => {
                    ctx.fillStyle = '#b249f8'; // Purple haze silhouette
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            } else {
                skyGrad.addColorStop(0, theme === 'light' ? '#cbd5e1' : '#0f172a'); 
                skyGrad.addColorStop(0.6, theme === 'light' ? '#f8fafc' : '#1e293b');
                ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
                const depthBG = (currentLevel === 'highway') ? levelBackgroundData.highway : levelBackgroundData.pylons;
                depthBG.forEach(n => {
                    ctx.fillStyle = theme === 'light' ? '#94a3b8' : '#cbd5e1'; // Brighter in dark mode for visibility
                    ctx.globalAlpha = n.alpha; ctx.fillRect(n.x, canvas.height - n.h, n.w, n.h);
                });
            }
        }
        ctx.globalAlpha = 1.0;

        // 2. GRID (Utility Layer)
        if (isGridEnabled && !isSimulating) {
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
            const drawPeak = (x, y, w, h, color) => {
                ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, canvas.height); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, canvas.height); ctx.fill();
            };
            ctx.fillStyle = p.riverBank;
            ctx.fillRect(0, levelState.bankY, levelState.bLeftX, canvas.height); 
            ctx.fillRect(levelState.bRightX, levelState.bankYRight, canvas.width, canvas.height);
            drawPeak(-50, levelState.bankY, levelState.bLeftX + 100, 250, p.mtnColor);
            drawPeak(levelState.bRightX - 50, levelState.bankYRight, canvas.width - levelState.bRightX + 100, 400, p.mtnColor);
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
            const material = MATERIAL_CONFIG[b.size] || MATERIAL_CONFIG.standard;
            let targetYield = material.yield;
            let stressPrc = Math.min(b.strain / targetYield, 1);
            if(isSimulating) ctx.strokeStyle = `rgb(${stressPrc * 255}, ${(1-stressPrc)*255}, 0)`;
            else ctx.strokeStyle = hoveredBeam === b ? '#ef4444' : p.beam;
            ctx.lineWidth = b.size === 'light' ? 2 : (b.size === 'heavy' ? 7 : 4); ctx.stroke();
            if (isSimulating) {
                let centerX = (b.nodeA.x + b.nodeB.x) / 2; let centerY = (b.nodeA.y + b.nodeB.y) / 2;
                ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = stressPrc > 0.85 ? '#ff0000' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.fillText(`${(stressPrc * 100).toFixed(0)}%`, centerX, centerY - Math.max(10, ctx.lineWidth)); ctx.shadowBlur = 0;
            }
        });

        nodes.forEach(n => {
            ctx.beginPath(); ctx.arc(n.x, n.y, n.fixed ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = n.fixed ? p.nodeFixed : (hoveredNode === n ? '#ef4444' : p.nodeFree); ctx.fill();
            ctx.strokeStyle = p.nodeBorder; ctx.lineWidth = n.fixed ? 2 : 1; ctx.stroke();
        });

        if (car.active || (!isSimulating && car.x > 0)) {
            let wheelRot = car.x * 0.1; 
            let bounceY = car.y + (car.active && car.speed > 0 ? Math.abs(Math.sin(car.x * 0.15)) * 1.5 : 0);
            if (car.active && car.speed > 0) {
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
        }

        if (mousePos.x > 0 && mousePos.y > 0 && !isSimulating && operationMode !== 'delete') {
            ctx.fillStyle = p.nodeFixed; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
            ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
            ctx.fillText(`(X: ${Math.round(mousePos.x)}, Y: ${Math.round(mousePos.y)})`, mousePos.x + 15, mousePos.y + 15); ctx.shadowBlur = 0;
        }

        if (firstBrokenBeam && car.state === 'failed') {
            ctx.beginPath(); ctx.arc(brokeAtX, brokeAtY, 20, 0, Math.PI * 2); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(brokeAtX - 10, brokeAtY - 10); ctx.lineTo(brokeAtX + 10, brokeAtY + 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(brokeAtX + 10, brokeAtY - 10); ctx.lineTo(brokeAtX - 10, brokeAtY + 10); ctx.stroke();
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
    document.getElementById('btn-save-checkpoint')?.addEventListener('click', () => {
        if(isSimulating) return;
        checkpointData.nodes = nodes.map(n => {
            let relX = (n.x - levelState.bLeftX) / levelState.gapWidth;
            let expectedBankY = levelState.isAsymmetric 
                ? levelState.bankY + relX * (levelState.bankYRight - levelState.bankY)
                : levelState.bankY;
            return {
                relX: relX,
                relY: (n.y - expectedBankY) / levelState.gapWidth,
                fixed: n.fixed
            };
        });
        checkpointData.beams = beams.map(b => ({
            idxA: nodes.indexOf(b.nodeA),
            idxB: nodes.indexOf(b.nodeB),
            size: b.size
        }));
        showGameStatus(true, 'Checkpoint Saved!');
        setTimeout(() => statusBanner.classList.add('hidden'), 2000);
    });

    document.getElementById('btn-restore-checkpoint')?.addEventListener('click', () => {
        if (checkpointData.nodes.length === 0) {
            showGameStatus(false, 'No checkpoint found!');
            setTimeout(() => statusBanner.classList.add('hidden'), 2000);
            return;
        }
        isSimulating = false;
        if(animFrame) cancelAnimationFrame(animFrame);
        car.active = false;
        car.state = 'idle';
        firstBrokenBeam = null;
        statusBanner.classList.add('hidden');
        
        nodes = checkpointData.nodes.map(n => {
            let absoluteX = levelState.bLeftX + (n.relX * levelState.gapWidth);
            let expectedBankY = levelState.isAsymmetric 
                ? levelState.bankY + n.relX * (levelState.bankYRight - levelState.bankY)
                : levelState.bankY;
            let absoluteY = expectedBankY + (n.relY * levelState.gapWidth);
            return new Node(absoluteX, absoluteY, n.fixed);
        });
        beams = checkpointData.beams.map(b => new Beam(nodes[b.idxA], nodes[b.idxB], b.size));
        
        car.x = nodes[0].x - 50; 
        car.y = nodes[0].y - 15;
        car.speed = 1.5;
        
        updateBudgetUI();
        draw();
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        saveHistory();
        initEnvironment();
    });

    document.getElementById('btn-simulate').addEventListener('click', () => {
        if(!isSimulating) {
            updateBudgetUI(); // One last check
            if (budget - currentSpend < 0 && budget < 1000000) {
                showGameStatus(false, 'Cannot test: You are over budget! Delete beams.');
                return;
            }
            if (nodes.length > 0) {
                car.x = nodes[0].x - 50;
                car.y = nodes[0].y - 15;
                car.speed = 1.5;
            }

            isSimulating = true;
            statusBanner.classList.add('hidden');
            car.active = true;
            car.state = 'driving';
            nodes.forEach(n => { n.oldX = n.x; n.oldY = n.y; });
            simulate();
        }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
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

    // Boot
    setTimeout(() => {
        resizeCanvas();
        updateUndoButtons();
    }, 100);
});
