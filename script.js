/**
 * Aaryan Sehgal Portfolio - Core Script
 * Refactored for modularity, maintenance, and enhanced features.
 */

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    // Security: Global right-click block
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Initialize Modules
    ThemeManager.init();
    NavigationManager.init();
    CursorManager.init();
    AnimationEngine.init();
    ProjectShowcase.init();
    ContactForm.init();
    ToastManager.init();
    MagneticEffect.init();

    // Resize Handling
    window.addEventListener('resize', debounce(() => {
        AnimationEngine.cacheSectionOffsets();
        AnimationEngine.updateScrollScrub();
        AnimationEngine.updateHorizontalScroll();
        AnimationEngine.updateCardGlowAtPointer();
        ThemeManager.updateSlider();
    }, 150));
}

// =========================================
// 1. Theme Manager
// =========================================
const ThemeManager = {
    htmlEl: document.documentElement,
    btns: null,
    slider: null,

    init() {
        this.btns = document.querySelectorAll('.theme-btn');
        this.slider = document.getElementById('theme-slider');
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.setTheme(savedTheme);

        this.btns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTheme(btn.getAttribute('data-theme-btn'));
            });
        });
        
        // Initial slider position after bounds settle
        setTimeout(() => this.updateSlider(), 100);
    },

    setTheme(theme) {
        this.htmlEl.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        this.updateSlider();
    },
    
    updateSlider() {
        const theme = localStorage.getItem('theme') || 'dark';
        this.btns.forEach(btn => {
            const isActive = btn.getAttribute('data-theme-btn') === theme;
            btn.classList.toggle('active', isActive);
            
            if (isActive && this.slider) {
                requestAnimationFrame(() => {
                    this.slider.style.width = `${btn.offsetWidth}px`;
                    this.slider.style.transform = `translateX(${btn.offsetLeft}px)`;
                });
            }
        });
    }
};

// =========================================
// 2. Navigation Manager
// =========================================
const NavigationManager = {
    toggle: null,
    menu: null,

    init() {
        this.toggle = document.getElementById('nav-toggle');
        this.menu = document.getElementById('nav-menu');

        if (!this.toggle) return;
        this.toggle.addEventListener('click', () => {
            const isOpen = this.menu.classList.toggle('open');
            this.toggle.classList.toggle('active');
            this.toggle.setAttribute('aria-expanded', isOpen);
            AnimationEngine.updateNavbar();
        });

        document.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                this.menu.classList.remove('open');
                this.toggle.classList.remove('active');
                this.toggle.setAttribute('aria-expanded', 'false');
                AnimationEngine.updateNavbar();
            });
        });
    }
};

// =========================================
// 3. Cursor Manager
// =========================================
const CursorManager = {
    dot: null,
    outline: null,

    init() {
        this.dot = document.querySelector('.cursor-dot');
        this.outline = document.querySelector('.cursor-outline');

        if (!this.dot || window.innerWidth <= 900) return;

        window.addEventListener('mousemove', (e) => {
            this.dot.style.left = `${e.clientX}px`;
            this.dot.style.top = `${e.clientY}px`;
            this.outline.animate({
                left: `${e.clientX}px`,
                top: `${e.clientY}px`
            }, { duration: 500, fill: "forwards" });
        });

        // Hide custom cursor in fullscreen
        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = document.fullscreenElement !== null;
            if (this.dot && this.outline) {
                this.dot.style.display = isFullscreen ? 'none' : 'block';
                this.outline.style.display = isFullscreen ? 'none' : 'block';
            }
            // Restore OS cursor visibility if in body
            document.body.style.cursor = isFullscreen ? 'auto' : 'none';
        });

        document.querySelectorAll('a, button, .hover-3d, .hamburger, .project-card').forEach(el => {
            el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
            el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
        });

        // Touch Interaction
        document.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            const ripple = document.createElement('div');
            ripple.className = 'touch-ripple';
            ripple.style.left = `${touch.clientX}px`;
            ripple.style.top = `${touch.clientY}px`;
            ripple.style.transform = `translate(-50%, -50%) scale(0)`;
            document.body.appendChild(ripple);

            ripple.animate([
                { transform: 'translate(-50%, -50%) scale(0)', opacity: 1 },
                { transform: 'translate(-50%, -50%) scale(2)', opacity: 0 }
            ], { duration: 600, easing: 'ease-out' }).onfinish = () => ripple.remove();
        }, { passive: true });
    }
};

// =========================================
// 4. Animation Engine
// =========================================
const AnimationEngine = {
    scrubTargets: null,
    ticking: false,
    lastScrollY: 0,
    sectionOffsets: [],
    reducedMotionQuery: window.matchMedia('(prefers-reduced-motion: reduce)'),
    pointerState: { active: false, x: 0, y: 0 },
    activeGlowCard: null,

    isCompactLayout() {
        return window.innerWidth <= 1024;
    },

    usesSimplifiedHorizontalLayout() {
        return window.innerWidth <= 1024 || window.innerHeight <= 820;
    },

    prefersReducedMotion() {
        return this.reducedMotionQuery.matches;
    },

    resetPanoramaCards(scope = document) {
        scope.querySelectorAll('.project-card, .skill-card').forEach(card => {
            card.style.setProperty('--panorama-rotate', '0deg');
            card.style.setProperty('--panorama-shift-y', '0px');
            card.style.setProperty('--panorama-z', '0px');
            card.style.setProperty('--panorama-scale', '1');
            card.dataset.panoramaLayer = '1';
            card.style.setProperty('--card-layer', '1');
            card.style.setProperty('--card-opacity', '1');
            card.style.setProperty('--card-saturate', '1');
        });
    },

    updatePanoramaCards(track) {
        const viewportCenter = window.innerWidth / 2;
        const spread = Math.max(window.innerWidth * 0.42, 320);

        track.querySelectorAll('.project-card, .skill-card').forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardCenter = rect.left + (rect.width / 2);
            const normalized = Math.max(-1, Math.min(1, (cardCenter - viewportCenter) / spread));
            const proximity = 1 - Math.abs(normalized);
            const layer = Math.round(10 + (proximity * 30));

            card.style.setProperty('--panorama-rotate', `${normalized * -14}deg`);
            card.style.setProperty('--panorama-shift-y', `${(1 - proximity) * 18}px`);
            card.style.setProperty('--panorama-z', `${Math.round((proximity * 34) - 10)}px`);
            card.style.setProperty('--panorama-scale', `${(0.9 + (proximity * 0.12)).toFixed(3)}`);
            card.dataset.panoramaLayer = String(layer);
            if (!card.classList.contains('glow-active')) {
                card.style.setProperty('--card-layer', String(layer));
            }
            card.style.setProperty('--card-opacity', `${(0.68 + (proximity * 0.32)).toFixed(3)}`);
            card.style.setProperty('--card-saturate', `${(0.84 + (proximity * 0.26)).toFixed(3)}`);
        });
    },

    resetGlowCard(card) {
        if (!card) return;
        card.classList.remove('glow-active');
        card.style.setProperty('--card-layer', card.dataset.panoramaLayer || '1');
        card.style.setProperty('--hover-x', '50%');
        card.style.setProperty('--hover-y', '50%');
        card.style.setProperty('--shine-offset', '0px');
    },

    pickCardAtPoint(x, y) {
        const candidates = Array.from(document.querySelectorAll('.project-card, .skill-card')).filter(card => {
            const rect = card.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            const distA = Math.hypot((rectA.left + rectA.width / 2) - x, (rectA.top + rectA.height / 2) - y);
            const distB = Math.hypot((rectB.left + rectB.width / 2) - x, (rectB.top + rectB.height / 2) - y);
            if (Math.abs(distA - distB) > 0.5) return distA - distB;

            return Number(b.dataset.panoramaLayer || 0) - Number(a.dataset.panoramaLayer || 0);
        });

        return candidates[0];
    },

    updateCardGlowAtPointer() {
        if (this.isCompactLayout() || this.prefersReducedMotion() || !this.pointerState.active) {
            this.resetGlowCard(this.activeGlowCard);
            this.activeGlowCard = null;
            return;
        }

        const card = this.pickCardAtPoint(this.pointerState.x, this.pointerState.y);

        if (this.activeGlowCard && this.activeGlowCard !== card) {
            this.resetGlowCard(this.activeGlowCard);
        }

        if (!card) {
            this.activeGlowCard = null;
            return;
        }

        const rect = card.getBoundingClientRect();
        const relX = Math.max(0, Math.min(rect.width, this.pointerState.x - rect.left));
        const relY = Math.max(0, Math.min(rect.height, this.pointerState.y - rect.top));
        const xPercent = (relX / rect.width) * 100;
        const yPercent = (relY / rect.height) * 100;
        const shineOffset = ((relX / rect.width) - 0.5) * 24;

        card.classList.add('glow-active');
        card.style.setProperty('--card-layer', '80');
        card.style.setProperty('--hover-x', `${xPercent.toFixed(2)}%`);
        card.style.setProperty('--hover-y', `${yPercent.toFixed(2)}%`);
        card.style.setProperty('--shine-offset', `${shineOffset.toFixed(2)}px`);
        this.activeGlowCard = card;
    },

    init() {
        this.lastScrollY = window.scrollY;
        this.scrubTargets = document.querySelectorAll('.scrub-target');
        this.cacheSectionOffsets();
        this.initTypewriter();
        this.init3DTilt();
        this.initCardGlowTracking();
        this.initDescriptionScroll();

        window.addEventListener('scroll', () => {
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.updateScrollScrub();
                    this.updateHorizontalScroll();
                    this.updateCardGlowAtPointer();
                    this.updateNavbar();
                    this.ticking = false;
                });
                this.ticking = true;
            }
        });

        this.updateScrollScrub();
        this.updateHorizontalScroll();
        this.updateCardGlowAtPointer();
        this.updateNavbar();
    },

    initDescriptionScroll() {
        const container = document.querySelector('.description-container');
        if (!container) return;

        const updateMasks = () => {
            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;

            // Top mask: appear when scrolled down
            const topMask = Math.min(40, scrollTop);
            container.style.setProperty('--top-mask', `${topMask}px`);

            // Bottom mask: disappear when at bottom
            const scrollBottom = scrollHeight - clientHeight - scrollTop;
            const bottomMask = Math.max(0, Math.min(40, scrollBottom));
            container.style.setProperty('--bottom-mask', `${bottomMask}px`);
        };

        container.addEventListener('scroll', updateMasks);
        window.addEventListener('resize', updateMasks);
        
        // Initial call after a brief timeout to ensure layout is settled
        setTimeout(updateMasks, 100);
    },

    cacheSectionOffsets() {
        const sections = ['about', 'background', 'portfolio', 'expertise', 'puzzle', 'contact'];
        this.sectionOffsets = sections.map(id => {
            const el = document.getElementById(id);
            return el ? { id, top: el.offsetTop } : null;
        }).filter(s => s !== null);
    },

    updateNavbar() {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        // Scroll Direction tracking
        const currentScroll = window.scrollY;
        const scrollDirection = currentScroll > this.lastScrollY ? 'down' : 'up';
        if (currentScroll !== this.lastScrollY) {
            navbar.dataset.scrollDirection = scrollDirection;
        }
        this.lastScrollY = currentScroll;

        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');

        // Optimized Scroll Spy
        let currentSection = "";
        const threshold = window.innerHeight * 0.4;
        const scrollPos = window.scrollY + threshold;

        for (const section of this.sectionOffsets) {
            if (scrollPos >= section.top) {
                currentSection = section.id;
            }
        }

        const navLinks = document.querySelectorAll('.nav-item');
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${currentSection}`);
        });

        const navMenu = NavigationManager.menu || document.getElementById('nav-menu');
        const shouldHideForPuzzle = currentSection === 'puzzle' && !navMenu?.classList.contains('open');
        navbar.classList.toggle('puzzle-hidden', shouldHideForPuzzle);
    },

    initTypewriter() {
        const typeTarget = document.querySelector('.typewriter');
        if (!typeTarget) return;

        const wordsStr = typeTarget.getAttribute('data-words');
        if (!wordsStr) return;

        const words = JSON.parse(wordsStr);
        let wordIndex = 0, charIndex = 0, isDeleting = false;

        const type = () => {
            const currentWord = words[wordIndex];
            if (isDeleting) {
                typeTarget.textContent = currentWord.substring(0, charIndex - 1);
                charIndex--;
            } else {
                typeTarget.textContent = currentWord.substring(0, charIndex + 1);
                charIndex++;
            }

            let speed = isDeleting ? 30 : 60;
            if (!isDeleting && charIndex === currentWord.length) {
                speed = 2000;
                isDeleting = true;
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                wordIndex = (wordIndex + 1) % words.length;
                speed = 400;
            }
            setTimeout(type, speed);
        };
        setTimeout(type, 600);
    },

    updateScrollScrub() {
        if (this.isCompactLayout() || this.prefersReducedMotion()) {
            this.scrubTargets.forEach(el => {
                el.style.opacity = '1';
                el.style.transform = 'none';
            });
            return;
        }

        const wh = window.innerHeight;
        this.scrubTargets.forEach(el => {
            const rect = el.getBoundingClientRect();
            // Calculate progress based on element's position relative to viewport
            let progress = 1 - (rect.top / wh);
            const type = el.getAttribute('data-scrub-type');

            if (type === 'fade-up') {
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 2));
                el.style.opacity = p;
                el.style.transform = `translateY(${50 - (p * 50)}px)`;
            } else if (type === 'scale-up') {
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 2.5));
                el.style.opacity = p;
                el.style.transform = `scale(${0.8 + (p * 0.2)})`;
            } else if (type === 'slide-left') {
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 3));
                el.style.opacity = p;
                el.style.transform = `translateX(${-100 + (p * 100)}px)`;
            } else if (type === 'hero') {
                let p = Math.max(0, Math.min(1, window.scrollY / wh));
                el.style.opacity = 1 - p;
                el.style.transform = `translateY(${p * 200}px) scale(${1 - (p * 0.1)})`;
            }
        });
    },

    updateHorizontalScroll() {
        const sections = document.querySelectorAll('.horizontal-section');

        if (this.usesSimplifiedHorizontalLayout() || this.prefersReducedMotion()) {
            sections.forEach(section => {
                const track = section.querySelector('.horizontal-track') || section.querySelector('.reverse-track');
                const progressBar = section.querySelector('.scroll-progress-bar');
                const stickyContainer = section.querySelector('.sticky-container');

                if (track) track.style.transform = 'none';
                if (progressBar) progressBar.style.width = '0%';
                if (stickyContainer) stickyContainer.classList.remove('bg-focus');
                this.resetPanoramaCards(section);
            });
            this.resetGlowCard(this.activeGlowCard);
            this.activeGlowCard = null;
            return;
        }

        sections.forEach(section => {
            const track = section.querySelector('.horizontal-track') || section.querySelector('.reverse-track');
            const progressBar = section.querySelector('.scroll-progress-bar');
            
            if (!track) return;
            
            const rect = section.getBoundingClientRect();
            const startVisible = rect.top;
            const totalScrollable = rect.height - window.innerHeight;
            
            let progress = -startVisible / totalScrollable;
            progress = Math.max(0, Math.min(1, progress));
            
            // Calculate max scroll distance dynamically bounding to the new CSS padded edges.
            const maxScrollDist = Math.max(track.scrollWidth - window.innerWidth, 0);
            
            // Multiply by positive 1 for reverse-tracks, pulling the UI horizontally left-to-right.
            const isReverse = track.classList.contains('reverse-track');
            const direction = isReverse ? 1 : -1;
            
            track.style.transform = `translateX(${direction * progress * maxScrollDist}px)`;
            this.updatePanoramaCards(track);
            
            // Background Dimming Animation
            const stickyContainer = section.querySelector('.sticky-container');
            if (stickyContainer) {
                if (progress > 0.05 && progress < 0.95) {
                    stickyContainer.classList.add('bg-focus');
                } else {
                    stickyContainer.classList.remove('bg-focus');
                }
            }
            
            if (progressBar) {
                progressBar.style.width = `${progress * 100}%`;
                if (isReverse) {
                    progressBar.style.float = 'right';
                }
            }
        });
    },

    init3DTilt() {
        if (window.innerWidth <= 1024 || this.prefersReducedMotion()) return;
        document.querySelectorAll('.hover-3d:not(.project-card):not(.skill-card)').forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const rx = ((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * -3;
                const ry = ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 3;
                card.style.setProperty('--hover-rotate-x', `${rx}deg`);
                card.style.setProperty('--hover-rotate-y', `${ry}deg`);
                card.style.setProperty('--hover-scale', '1.003');
                card.style.transition = 'transform 0.18s ease-out, border-color 0.22s ease, opacity 0.35s ease, filter 0.35s ease';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transition = '';
                card.style.setProperty('--hover-rotate-x', '0deg');
                card.style.setProperty('--hover-rotate-y', '0deg');
                card.style.setProperty('--hover-scale', '1');
            });
        });
    },

    initCardGlowTracking() {
        if (window.innerWidth <= 1024 || this.prefersReducedMotion()) return;

        document.querySelectorAll('.project-card, .skill-card').forEach(card => this.resetGlowCard(card));

        window.addEventListener('pointermove', (e) => {
            this.pointerState.active = true;
            this.pointerState.x = e.clientX;
            this.pointerState.y = e.clientY;
            this.updateCardGlowAtPointer();
        }, { passive: true });

        document.addEventListener('pointerleave', () => {
            this.pointerState.active = false;
            this.resetGlowCard(this.activeGlowCard);
            this.activeGlowCard = null;
        });
    }
};

// =========================================
// 5. Project Showcase (Zoom Animation)
// =========================================
const ProjectShowcase = {
    modal: null,
    closeBtn: null,

    usesSimpleModalFlow() {
        return window.innerWidth <= 1024
            || window.innerHeight <= 820
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    pickProjectCardAtPoint(x, y) {
        const candidates = Array.from(document.querySelectorAll('.project-card')).filter(card => {
            const rect = card.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            const distA = Math.hypot((rectA.left + rectA.width / 2) - x, (rectA.top + rectA.height / 2) - y);
            const distB = Math.hypot((rectB.left + rectB.width / 2) - x, (rectB.top + rectB.height / 2) - y);

            if (Math.abs(distA - distB) > 0.5) return distA - distB;

            return Number(b.dataset.panoramaLayer || 0) - Number(a.dataset.panoramaLayer || 0);
        });

        return candidates[0];
    },
    
    init() {
        this.modal = document.getElementById('project-modal');
        this.closeBtn = document.querySelector('.modal-close');
        this.content = this.modal ? this.modal.querySelector('.modal-content') : null;
        this.lastCard = null;

        if (!this.modal) return;

        const portfolioSection = document.getElementById('portfolio');
        if (portfolioSection) {
            portfolioSection.addEventListener('click', (e) => {
                const card = this.pickProjectCardAtPoint(e.clientX, e.clientY);
                if (!card || !portfolioSection.contains(card)) return;

                this.lastCard = card;
                const title = card.querySelector('h3').innerText;
                const desc = card.querySelector('p').innerText;
                const img = card.getAttribute('data-project-img') || 'project-placeholder.jpg';

                this.openModal(title, desc, img);
            });
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });
    },

    openModal(title, desc, imgSrc) {
        if (!this.lastCard) return;

        // 1. Prep Modal Content
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-description').textContent = desc;
        const modalImage = document.getElementById('modal-image');
        if (modalImage) {
            modalImage.src = imgSrc;
            modalImage.alt = `${title} preview`;
        }

        if (this.usesSimpleModalFlow()) {
            this.modal.style.display = 'flex';
            this.modal.style.visibility = 'visible';
            this.modal.classList.add('open');
            this.content.style.transition = '';
            this.content.style.transform = 'none';
            this.content.style.opacity = '1';
            document.body.style.overflow = 'hidden';
            return;
        }

        // 2. FIRST: Record Card Position
        const cardRect = this.lastCard.getBoundingClientRect();

        // 3. Prepare for LAST (Show invisibly to measure)
        this.modal.style.visibility = 'hidden';
        this.modal.style.display = 'flex';
        this.modal.classList.add('open');
        
        // 4. LAST: Record Modal Position
        const modalRect = this.content.getBoundingClientRect();

        // 5. INVERT: Calculate Scale & Translation deltas
        const scaleX = cardRect.width / modalRect.width;
        const scaleY = cardRect.height / modalRect.height;
        const translateX = (cardRect.left + cardRect.width / 2) - (modalRect.left + modalRect.width / 2);
        const translateY = (cardRect.top + cardRect.height / 2) - (modalRect.top + modalRect.height / 2);

        // 6. Apply Inverse Transform (Invert state)
        this.content.style.transition = 'none';
        this.content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        this.content.style.opacity = '0';
        
        // Force reflow
        this.content.offsetHeight;

        // 7. PLAY: Animate to Last state
        this.modal.style.visibility = 'visible';
        this.content.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease';
        this.content.style.transform = 'none';
        this.content.style.opacity = '1';

        document.body.style.overflow = 'hidden'; 
    },

    closeModal() {
        if (!this.lastCard) {
            this.modal.classList.remove('open');
            return;
        }

        if (this.usesSimpleModalFlow()) {
            this.modal.classList.remove('open');
            this.modal.style.display = 'none';
            this.modal.style.visibility = '';
            this.content.style.transform = '';
            this.content.style.opacity = '';
            document.body.style.overflow = '';
            return;
        }

        // Calculate current position of the card (it might have moved if scrolled)
        const cardRect = this.lastCard.getBoundingClientRect();
        const modalRect = this.content.getBoundingClientRect();

        const scaleX = cardRect.width / modalRect.width;
        const scaleY = cardRect.height / modalRect.height;
        const translateX = (cardRect.left + cardRect.width / 2) - (modalRect.left + modalRect.width / 2);
        const translateY = (cardRect.top + cardRect.height / 2) - (modalRect.top + modalRect.height / 2);

        // Animate back to card position
        this.content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        this.content.style.opacity = '0';
        this.modal.classList.remove('open');

        setTimeout(() => {
            this.modal.style.display = 'none';
            this.modal.style.visibility = '';
            this.content.style.transform = '';
            document.body.style.overflow = ''; 
        }, 600); // Match transition duration
    }
};

// =========================================
// 6. Toast Manager
// =========================================
const ToastManager = {
    container: null,

    init() {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        document.body.appendChild(this.container);
        window.showToast = (msg, type) => this.show(msg, type);
    },

    show(msg, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${type === 'success' ? '&#10003;' : '&#9432;'}</div>
            <div class="toast-msg">${msg}</div>
        `;
        this.container.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => toast.classList.add('visible'));

        // Auto remove
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }
};

// =========================================
// 7. Magnetic Effect
// =========================================
const MagneticEffect = {
    init() {
        if (window.innerWidth <= 1024 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        
        document.querySelectorAll('.btn-magnetic').forEach(btn => {
            btn.addEventListener('mousemove', e => {
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                
                // Pull content (text/icon) more than the button itself
                const content = btn.querySelector('span, i') || btn;
                
                btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
                if (content !== btn) {
                    content.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px)`;
                }
            });
            
            btn.addEventListener('mouseleave', () => {
                const content = btn.querySelector('span, i') || btn;
                btn.style.transform = '';
                if (content !== btn) content.style.transform = '';
            });
        });
    }
};

// =========================================
// 8. Contact Form
// =========================================
const ContactForm = {
    init() {
        const btn = document.getElementById('send-email-btn');
        const msg = document.getElementById('contact-message');

        if (btn && msg) {
            btn.addEventListener('click', () => {
                const body = encodeURIComponent(msg.value || 'Hello Aaryan,');
                const mail = 'aaryan.sehgal.3070@gmail.com';
                const subject = encodeURIComponent('Inquiry from Portfolio');
                window.location.href = `mailto:${mail}?subject=${subject}&body=${body}`;
                
                // Enhanced user feedback
                if (window.showToast) {
                    window.showToast('Opening default email client...', 'success');
                }
            });
        }
    }
};

// Utils
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};
