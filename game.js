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
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 500;
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

    // Physics constants
    const GRAVITY = 0.6;
    const RELAXATION_ITERATIONS = 50;
    const YIELD_STRESS = 0.03; // Hyper brittle to enforce proper load bearing trusses
    const MAX_BEAM_LENGTH = 140; // Max allowed distance to draw a beam

    // Vehicle Data
    let car = { active: false, x: 0, y: 0, speed: 1.5, state: 'idle' };

    class Node {
        constructor(x, y, fixed = false) {
            this.x = x; this.y = y;
            this.oldX = x; this.oldY = y;
            this.fixed = fixed;
        }
    }

    class Beam {
        constructor(nodeA, nodeB) {
            this.nodeA = nodeA; this.nodeB = nodeB;
            this.length = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
            this.strain = 0; this.broken = false;
        }
    }

    function updateBudgetUI() {
        currentSpend = beams.length * COST_PER_BEAM;
        let remaining = budget - currentSpend;
        budgetDisplay.innerText = `$${remaining.toLocaleString()}`;
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

    // --- Interaction ---
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mousePos.x = e.clientX - rect.left;
        mousePos.y = e.clientY - rect.top;

        if(!isSimulating) {
            hoveredNode = nodes.find(n => Math.hypot(n.x - mousePos.x, n.y - mousePos.y) < snapRadius);
            hoveredBeam = null;
            if(!hoveredNode) {
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

    canvas.addEventListener('mousedown', (e) => {
        if(isSimulating) return;
        if (e.button === 0) { 
            if (hoveredNode) draggingStartNode = hoveredNode;
            else {
                const newNode = new Node(mousePos.x, mousePos.y, false);
                nodes.push(newNode);
                draggingStartNode = newNode;
                hoveredNode = newNode;
            }
        } 
        else if (e.button === 2) { 
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

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0 && draggingStartNode && !isSimulating) {
            let targetNode = hoveredNode;
            
            let dist = Math.hypot(mousePos.x - draggingStartNode.x, mousePos.y - draggingStartNode.y);
            
            // Check illegal lengths
            if (dist > MAX_BEAM_LENGTH) {
                draggingStartNode = null;
                draw();
                return;
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
                        beams.push(new Beam(draggingStartNode, targetNode));
                        updateBudgetUI();
                    }
                }
            }
            draggingStartNode = null;
            draw();
        }
    });

    canvas.addEventListener('mouseleave', () => {
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
                
                if(b.strain > YIELD_STRESS && isSimulating) {
                    b.broken = true;  // Snap!
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
                    let dX = Math.abs(currentBeam.nodeB.x - currentBeam.nodeA.x);
                    let leftNodeY = currentBeam.nodeA.x < currentBeam.nodeB.x ? currentBeam.nodeA.y : currentBeam.nodeB.y;
                    let rightNodeY = currentBeam.nodeA.x < currentBeam.nodeB.x ? currentBeam.nodeB.y : currentBeam.nodeA.y;
                    
                    // + slope is uphill (right node is HIGHER visually on screen, meaning lower Y value)
                    let slope = (leftNodeY - rightNodeY) / dX;

                    if (slope > 0.45) { // Too steep uphill
                        car.speed = 0; // Stall!
                        car.state = 'failed';
                        showGameStatus(false, 'Vehicle Stalled! The bridge shifted/sagged into a steep ditch (+24 deg). Build stronger trusses!');
                    } else if (slope < -0.8) {
                        car.speed = 0; // Nosedive crash
                        car.state = 'failed';
                        showGameStatus(false, 'Vehicle Crashed! The decline was too steep!');
                    }

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
                showGameStatus(false, 'Catastrophic Structural Failure! The vehicle fell.');
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

        // Env
        if (currentLevel === 'river') {
            ctx.fillStyle = '#4b5563';
            const rw = Math.min(canvas.width * 0.5, 500);
            const lX = (canvas.width - rw) / 2;
            ctx.fillRect(0, canvas.height * 0.6, lX, canvas.height * 0.4);
            ctx.fillRect(lX + rw, canvas.height * 0.6, canvas.width, canvas.height * 0.4);
            ctx.fillStyle = '#3b82f6'; ctx.globalAlpha = 0.6;
            ctx.fillRect(lX, canvas.height * 0.8, rw, canvas.height * 0.2); ctx.globalAlpha = 1.0;
        } else if (currentLevel === 'city') {
            ctx.fillStyle = '#1e293b';
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
            ctx.fillStyle = '#64748b'; // slate road banks
            const gw = Math.min(canvas.width * 0.7, 700);
            const bX = (canvas.width - gw) / 2;
            ctx.fillRect(0, canvas.height * 0.5, bX, canvas.height * 0.5);
            ctx.fillRect(bX + gw, canvas.height * 0.5, canvas.width, canvas.height * 0.5);
            
            // Draw Pier
            ctx.fillStyle = '#475569';
            ctx.fillRect(canvas.width / 2 - 30, canvas.height * 0.45, 60, canvas.height * 0.55);
            ctx.fillStyle = '#334155';
            ctx.fillRect(canvas.width / 2 - 20, canvas.height * 0.45, 40, canvas.height * 0.55);
        }

        if (draggingStartNode && !isSimulating) {
            ctx.beginPath();
            ctx.moveTo(draggingStartNode.x, draggingStartNode.y);
            ctx.lineTo(mousePos.x, mousePos.y);
            
            let currentDist = Math.hypot(mousePos.x - draggingStartNode.x, mousePos.y - draggingStartNode.y);
            if (currentDist > MAX_BEAM_LENGTH) {
                ctx.strokeStyle = '#ef4444'; // Red if too long
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = '#9ca3af'; 
                ctx.setLineDash([5, 5]);
            }
            
            ctx.lineWidth = 2; 
            ctx.stroke(); ctx.setLineDash([]);
        }

        // Draw Beams
        beams.forEach(b => {
            if(b.broken) return;
            ctx.beginPath();
            ctx.moveTo(b.nodeA.x, b.nodeA.y);
            ctx.lineTo(b.nodeB.x, b.nodeB.y);
            if(isSimulating) {
                const stressPrc = Math.min(b.strain / YIELD_STRESS, 1);
                ctx.strokeStyle = `rgb(${stressPrc * 255}, ${(1-stressPrc)*255}, 0)`;
            } else {
                ctx.strokeStyle = hoveredBeam === b ? '#ef4444' : '#1f2937';
            }
            ctx.lineWidth = 4;
            ctx.stroke();
        });

        // Draw Nodes
        nodes.forEach(n => {
            ctx.beginPath(); ctx.arc(n.x, n.y, n.fixed ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = n.fixed ? '#111827' : (hoveredNode === n ? '#ef4444' : '#f3f4f6'); ctx.fill();
            ctx.strokeStyle = '#111827'; ctx.lineWidth = n.fixed ? 2 : 1; ctx.stroke();
        });

        // Draw Custom Cargo Vehicle
        if (car.active || (!isSimulating && car.x > 0)) {
            // Wheels
            const wR = 5;
            ctx.fillStyle = '#111827';
            ctx.beginPath(); ctx.arc(car.x + 8, car.y - wR, wR, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(car.x + 32, car.y - wR, wR, 0, Math.PI*2); ctx.fill();
            
            // Cargo Body
            ctx.fillStyle = '#ef4444'; // Red cab
            ctx.fillRect(car.x + 25, car.y - 20, 15, 15);
            ctx.fillStyle = '#374151'; // Dark container
            ctx.fillRect(car.x, car.y - 25, 24, 20);
        }
    }

    function distToSegment(p, v, w) {
        let l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    }

    // --- Buttons ---
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
