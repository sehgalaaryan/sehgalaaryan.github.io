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
    const COST_PER_BEAM = 500; // Flat cost per beam for simplicity, or cost per pixel
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
    const YIELD_STRESS = 0.03; // Hyper brittle to enforce proper load bearing trusses
    const MAX_BEAM_LENGTH = 140; // Max allowed distance to draw a beam

    // Vehicle Data
    let car = { active: false, x: 0, y: 0, speed: 1.5, state: 'idle' };

    // Checkpoints & Tracking
    let checkpointData = { nodes: [], beams: [] };
    let firstBrokenBeam = null;
    let brokeAtX = 0; let brokeAtY = 0; let brokeStrain = 0;

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
            let len = b.length;
            if (b.size === 'light') return acc + (len * 3);
            if (b.size === 'heavy') return acc + (len * 8);
            return acc + (len * 5);
        }, 0);
        let remaining = budget - currentSpend;
        budgetDisplay.innerText = `$${Math.round(remaining).toLocaleString()}`;
        if (remaining < 0) {
            budgetDisplay.classList.add('over-budget');
        } else {
            budgetDisplay.classList.remove('over-budget');
        }
    }

    function initEnvironment() {
        nodes = [];
        beams = [];
        isSimulating = false;
        car.active = false;
        car.state = 'idle';
        firstBrokenBeam = null;
        statusBanner.classList.add('hidden');

        if(animFrame) cancelAnimationFrame(animFrame);
        currentLevel = levelSelector ? levelSelector.value : 'river';
        
        let bankLeftX;
        let bankRightX;
        let bankY;

        if (currentLevel === 'river') {
            budget = 15000;
            const riverWidth = Math.min(canvas.width * 0.5, 500);
            bankLeftX = (canvas.width - riverWidth) / 2;
            bankRightX = bankLeftX + riverWidth;
            bankY = canvas.height * 0.6;

            nodes.push(new Node(bankLeftX, bankY, true));
            nodes.push(new Node(bankLeftX, bankY + 50, true));
            nodes.push(new Node(bankRightX, bankY, true));
            nodes.push(new Node(bankRightX, bankY + 50, true));
        } else if (currentLevel === 'city') {
            budget = 25000;
            const gapWidth = Math.min(canvas.width * 0.8, 800);
            bankLeftX = (canvas.width - gapWidth) / 2;
            bankRightX = bankLeftX + gapWidth;
            bankY = canvas.height * 0.4;
            
            nodes.push(new Node(bankLeftX, bankY, true));
            nodes.push(new Node(bankLeftX, bankY + 80, true));
            nodes.push(new Node(bankRightX, bankY, true));
            nodes.push(new Node(bankRightX, bankY + 80, true));
        } else if (currentLevel === 'highway') {
            budget = 20000;
            const gapWidth = Math.min(canvas.width * 0.7, 700);
            bankLeftX = (canvas.width - gapWidth) / 2;
            bankRightX = bankLeftX + gapWidth;
            bankY = canvas.height * 0.5;
            
            // Banks
            nodes.push(new Node(bankLeftX, bankY, true));
            nodes.push(new Node(bankLeftX, bankY + 80, true));
            nodes.push(new Node(bankRightX, bankY, true));
            nodes.push(new Node(bankRightX, bankY + 80, true));

            // Central Massive Pier
            const pX = canvas.width / 2;
            nodes.push(new Node(pX - 30, canvas.height * 0.45, true));
            nodes.push(new Node(pX + 30, canvas.height * 0.45, true));
            nodes.push(new Node(pX - 30, canvas.height * 0.6, true));
            nodes.push(new Node(pX + 30, canvas.height * 0.6, true));
        }

        car.x = bankLeftX - 50;
        car.y = bankY - 15;
        
        updateBudgetUI();
        draw();
    }

    levelSelector.addEventListener('change', initEnvironment);

    // --- Buttons & UI Logic ---
    const modeToggleBtn = document.getElementById('btn-mode-toggle');
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', () => {
            if (operationMode === 'build') {
                operationMode = 'delete';
                modeToggleBtn.innerHTML = '🗑️ Delete';
                modeToggleBtn.classList.add('danger-btn');
            } else {
                operationMode = 'build';
                modeToggleBtn.innerHTML = '🔨 Build';
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
        if(fullscreenBtn) fullscreenBtn.innerText = (document.fullscreenElement || document.webkitFullscreenElement) ? '🔲 Exit Full Screen' : '🔲 Full Screen';
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
                beams = beams.filter(b => b.nodeA !== hoveredNode && b.nodeB !== hoveredNode);
                nodes = nodes.filter(n => n !== hoveredNode);
                hoveredNode = null;
            } else if (hoveredBeam) {
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
                
                let targetYield = b.size === 'light' ? 0.015 : (b.size === 'heavy' ? 0.05 : 0.03);
                
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
            let bankYCheck;
            let targetRightX;
            if(currentLevel === 'river') {
                const w = Math.min(canvas.width * 0.5, 500);
                let bLeftX = (canvas.width - w) / 2;
                targetRightX = bLeftX + w;
                bankYCheck = canvas.height * 0.6;
                if(car.x <= bLeftX || car.x >= targetRightX) trackY = bankYCheck;
            } else if (currentLevel === 'city') {
                const w = Math.min(canvas.width * 0.8, 800);
                let bLeftX = (canvas.width - w) / 2;
                targetRightX = bLeftX + w;
                bankYCheck = canvas.height * 0.4;
                if(car.x <= bLeftX || car.x >= targetRightX) trackY = bankYCheck;
            } else {
                const w = Math.min(canvas.width * 0.7, 700);
                let bLeftX = (canvas.width - w) / 2;
                targetRightX = bLeftX + w;
                bankYCheck = canvas.height * 0.5;
                if(car.x <= bLeftX || car.x >= targetRightX) trackY = bankYCheck;
            }

            if (trackY !== null) {
                // Stick to track
                car.y = trackY - 10;
                
                // Track Slope Calculation
                if(currentBeam && car.x > 0 && car.x < targetRightX) {
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
                let failReason = firstBrokenBeam ? `Beam snapped at ${Math.round(brokeStrain * 100)}% strain!` : 'Catastrophic Structural Failure! The vehicle fell.';
                showGameStatus(false, failReason);
            } else if (car.x > targetRightX + 20) {
                car.state = 'passed';
                showGameStatus(true, 'Structural Integrity Confirmed! You Win!');
            }
        }

        draw();
        
        let bridgeActive = nodes.some(n => !n.fixed && n.y < canvas.height + 200);
        if (bridgeActive || (car.state === 'driving')) {
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

    // --- Rendering ---
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Theme Colors
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        let p = {};
        if (theme === 'vibrant') {
            p = {
                riverBank: '#7e22ce',
                cityBank: '#4c1d95',
                hwBank: '#6d28d9',
                pier1: '#7e22ce',
                pier2: '#581c87',
                beam: '#ff007f', 
                beamDraft: '#fbcfe8',
                nodeFixed: '#d8b4fe',
                nodeFree: '#00e6ff',
                nodeBorder: '#ffffff',
                carBase: '#d8b4fe',
                carBox: '#c084fc',
                wheel: '#581c87'
            };
        } else if (theme === 'dark') {
            p = {
                riverBank: '#64748b',
                cityBank: '#334155',
                hwBank: '#94a3b8',
                pier1: '#64748b',
                pier2: '#475569',
                beam: '#f8fafc',
                beamDraft: '#cbd5e1',
                nodeFixed: '#94a3b8',
                nodeFree: '#3b82f6',
                nodeBorder: '#cbd5e1',
                carBase: '#cbd5e1',
                carBox: '#94a3b8',
                wheel: '#94a3b8'
            };
        } else {
            p = {
                riverBank: '#4b5563',
                cityBank: '#1e293b',
                hwBank: '#64748b',
                pier1: '#475569',
                pier2: '#334155',
                beam: '#1f2937',
                beamDraft: '#9ca3af',
                nodeFixed: '#111827',
                nodeFree: '#2563eb',
                nodeBorder: '#111827',
                carBase: '#1e293b',
                carBox: '#374151',
                wheel: '#111827'
            };
        }

        // Env
        if (currentLevel === 'river') {
            ctx.fillStyle = p.riverBank;
            const rw = Math.min(canvas.width * 0.5, 500);
            const lX = (canvas.width - rw) / 2;
            ctx.fillRect(0, canvas.height * 0.6, lX, canvas.height * 0.4);
            ctx.fillRect(lX + rw, canvas.height * 0.6, canvas.width, canvas.height * 0.4);
            ctx.fillStyle = '#3b82f6'; ctx.globalAlpha = 0.6;
            ctx.fillRect(lX, canvas.height * 0.8, rw, canvas.height * 0.2); ctx.globalAlpha = 1.0;
        } else if (currentLevel === 'city') {
            ctx.fillStyle = p.cityBank;
            const gw = Math.min(canvas.width * 0.8, 800);
            const bX = (canvas.width - gw) / 2;
            ctx.fillRect(0, canvas.height * 0.4, bX, canvas.height * 0.6);
            ctx.fillRect(bX + gw, canvas.height * 0.4, canvas.width, canvas.height * 0.6);
            ctx.fillStyle = '#fef08a'; ctx.globalAlpha = 0.4;
            for(let y = canvas.height * 0.45; y < canvas.height; y += 40) {
                ctx.fillRect(20, y, 30, 20);
                if (bX > 100) ctx.fillRect(bX - 50, y, 30, 20);
                ctx.fillRect(bX + gw + 20, y, 30, 20);
            }
            ctx.globalAlpha = 1.0;
        } else if (currentLevel === 'highway') {
            ctx.fillStyle = p.hwBank; // slate road banks
            const gw = Math.min(canvas.width * 0.7, 700);
            const bX = (canvas.width - gw) / 2;
            ctx.fillRect(0, canvas.height * 0.5, bX, canvas.height * 0.5);
            ctx.fillRect(bX + gw, canvas.height * 0.5, canvas.width, canvas.height * 0.5);
            
            // Draw Pier
            ctx.fillStyle = p.pier1;
            ctx.fillRect(canvas.width / 2 - 30, canvas.height * 0.45, 60, canvas.height * 0.55);
            ctx.fillStyle = p.pier2;
            ctx.fillRect(canvas.width / 2 - 20, canvas.height * 0.45, 40, canvas.height * 0.55);
        }

        if (draggingStartNode && !isSimulating) {
            ctx.beginPath();
            ctx.moveTo(draggingStartNode.x, draggingStartNode.y);
            let currentDist = Math.hypot(mousePos.x - draggingStartNode.x, mousePos.y - draggingStartNode.y);
            let drawX = mousePos.x;
            let drawY = mousePos.y;

            if (currentDist > MAX_BEAM_LENGTH) {
                let angle = Math.atan2(mousePos.y - draggingStartNode.y, mousePos.x - draggingStartNode.x);
                drawX = draggingStartNode.x + Math.cos(angle) * MAX_BEAM_LENGTH;
                drawY = draggingStartNode.y + Math.sin(angle) * MAX_BEAM_LENGTH;
            }
            ctx.lineTo(drawX, drawY);

            ctx.strokeStyle = p.beamDraft; 
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2; 
            ctx.stroke(); ctx.setLineDash([]);
        }

        // Draw Beams
        beams.forEach(b => {
            if(b.broken) return;
            ctx.beginPath();
            ctx.moveTo(b.nodeA.x, b.nodeA.y);
            ctx.lineTo(b.nodeB.x, b.nodeB.y);
            
            let targetYield = b.size === 'light' ? 0.015 : (b.size === 'heavy' ? 0.05 : 0.03);
            let stressPrc = Math.min(b.strain / targetYield, 1);
            
            if(isSimulating) {
                ctx.strokeStyle = `rgb(${stressPrc * 255}, ${(1-stressPrc)*255}, 0)`;
            } else {
                ctx.strokeStyle = hoveredBeam === b ? '#ef4444' : p.beam;
            }
            
            ctx.lineWidth = b.size === 'light' ? 2 : (b.size === 'heavy' ? 7 : 4);
            ctx.stroke();

            // Draw Stress Numerical Value
            if (isSimulating) {
                let centerX = (b.nodeA.x + b.nodeB.x) / 2;
                let centerY = (b.nodeA.y + b.nodeB.y) / 2;
                ctx.font = 'bold 11px sans-serif';
                ctx.fillStyle = stressPrc > 0.85 ? '#ff0000' : '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = "black";
                ctx.shadowBlur = 4;
                ctx.fillText(`${(stressPrc * 100).toFixed(0)}%`, centerX, centerY - Math.max(10, ctx.lineWidth));
                ctx.shadowBlur = 0; // Reset
            }
        });

        // Draw Nodes
        nodes.forEach(n => {
            ctx.beginPath(); ctx.arc(n.x, n.y, n.fixed ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = n.fixed ? p.nodeFixed : (hoveredNode === n ? '#ef4444' : p.nodeFree); ctx.fill();
            ctx.strokeStyle = p.nodeBorder; ctx.lineWidth = n.fixed ? 2 : 1; ctx.stroke();
        });

        // Draw Custom Cargo Vehicle
        if (car.active || (!isSimulating && car.x > 0)) {
            let wheelRot = car.x * 0.1; 
            let bounceY = car.y + (car.active && car.speed > 0 ? Math.abs(Math.sin(car.x * 0.15)) * 1.5 : 0);
            
            // Draw Smoke
            if (car.active && car.speed > 0) {
                ctx.fillStyle = `rgba(150, 150, 150, 0.4)`;
                ctx.beginPath();
                ctx.arc(car.x - 15, car.y - 5 + Math.sin(car.x*0.5)*3, 6, 0, Math.PI*2);
                ctx.fill();
                ctx.arc(car.x - 22, car.y - 10 + Math.cos(car.x*0.4)*5, 10, 0, Math.PI*2);
                ctx.fill();
            }

            // Chassis Base
            ctx.fillStyle = p.carBase;
            ctx.fillRect(car.x - 2, bounceY - 8, 42, 6);
            
            // Red Cab
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.roundRect(car.x + 22, bounceY - 24, 18, 18, 4);
            ctx.fill();
            
            // Window
            ctx.fillStyle = p.beamDraft;
            ctx.fillRect(car.x + 28, bounceY - 20, 10, 8);
            
            // Headlight
            ctx.fillStyle = '#eab308';
            ctx.fillRect(car.x + 38, bounceY - 10, 3, 4);

            // Cargo Box
            ctx.fillStyle = p.carBox;
            ctx.fillRect(car.x, bounceY - 32, 24, 26);
            
            // Draw rotating wheels
            const drawWheel = (wx, wy, rot) => {
                ctx.save();
                ctx.translate(wx, wy);
                ctx.rotate(rot);
                ctx.fillStyle = p.wheel;
                ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = p.beamDraft;
                ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = p.nodeFixed; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke();
                ctx.restore();
            };
            
            drawWheel(car.x + 6, car.y - 2, wheelRot);
            drawWheel(car.x + 32, car.y - 2, wheelRot);
        }

        // Draw Coordinates if hovering
        if (mousePos.x > 0 && mousePos.y > 0 && !isSimulating && operationMode !== 'delete') {
            ctx.fillStyle = p.nodeFixed;
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 4;
            ctx.fillText(`(X: ${Math.round(mousePos.x)}, Y: ${Math.round(mousePos.y)})`, mousePos.x + 15, mousePos.y + 15);
            ctx.shadowBlur = 0;
        }

        // Highlight failure point
        if (firstBrokenBeam && car.state === 'failed') {
            ctx.beginPath();
            ctx.arc(brokeAtX, brokeAtY, 20, 0, Math.PI * 2);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.stroke();
            
            ctx.beginPath(); ctx.moveTo(brokeAtX - 10, brokeAtY - 10); ctx.lineTo(brokeAtX + 10, brokeAtY + 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(brokeAtX + 10, brokeAtY - 10); ctx.lineTo(brokeAtX - 10, brokeAtY + 10); ctx.stroke();
        }
    }

    // React to theme changes to redraw instantly
    const themeObserver = new MutationObserver(() => {
        if (!isSimulating && nodes.length > 0) draw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
        checkpointData.nodes = nodes.map(n => new Node(n.x, n.y, n.fixed));
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
        
        nodes = checkpointData.nodes.map(n => new Node(n.x, n.y, n.fixed));
        beams = checkpointData.beams.map(b => new Beam(nodes[b.idxA], nodes[b.idxB], b.size));
        
        car.x = nodes[0].x - 50; 
        car.y = nodes[0].y - 15;
        
        updateBudgetUI();
        draw();
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        initEnvironment();
    });

    document.getElementById('btn-simulate').addEventListener('click', () => {
        if(!isSimulating) {
            if (budget - currentSpend < 0) {
                showGameStatus(false, 'Cannot test: You are over budget! Delete beams.');
                return;
            }

            isSimulating = true;
            statusBanner.classList.add('hidden');
            car.active = true;
            car.state = 'driving';
            
            nodes.forEach(n => { n.oldX = n.x; n.oldY = n.y; });
            simulate();
        }
    });

    // Boot
    setTimeout(resizeCanvas, 100);
});
