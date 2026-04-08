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

    // Resize Handling
    window.addEventListener('resize', debounce(() => {
        AnimationEngine.cacheSectionOffsets();
        AnimationEngine.updateScrollScrub();
        AnimationEngine.updateHorizontalScroll();
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
        });

        document.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                this.menu.classList.remove('open');
                this.toggle.classList.remove('active');
                this.toggle.setAttribute('aria-expanded', 'false');
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

    init() {
        this.lastScrollY = window.scrollY;
        this.scrubTargets = document.querySelectorAll('.scrub-target');
        this.cacheSectionOffsets();
        this.initTypewriter();
        this.init3DTilt();
        this.initDescriptionScroll();

        window.addEventListener('scroll', () => {
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.updateScrollScrub();
                    this.updateHorizontalScroll();
                    this.updateNavbar();
                    this.ticking = false;
                });
                this.ticking = true;
            }
        });

        this.updateScrollScrub();
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
            const maxScrollDist = track.scrollWidth - window.innerWidth;
            
            // Multiply by positive 1 for reverse-tracks, pulling the UI horizontally left-to-right.
            const isReverse = track.classList.contains('reverse-track');
            const direction = isReverse ? 1 : -1;
            
            track.style.transform = `translateX(${direction * progress * maxScrollDist}px)`;
            
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
        if (window.innerWidth <= 900) return;
        document.querySelectorAll('.hover-3d').forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const rx = ((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * -10;
                const ry = ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 10;
                card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02, 1.02, 1.02)`;
                card.style.transition = 'none';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transition = 'transform 0.5s ease';
                this.updateScrollScrub();
            });
        });
    }
};

// =========================================
// 5. Project Showcase (Zoom Animation)
// =========================================
const ProjectShowcase = {
    modal: null,
    closeBtn: null,
    
    init() {
        this.modal = document.getElementById('project-modal');
        this.closeBtn = document.querySelector('.modal-close');
        this.content = this.modal ? this.modal.querySelector('.modal-content') : null;
        this.lastCard = null;

        if (!this.modal) return;

        document.querySelectorAll('.project-card').forEach(card => {
            card.addEventListener('click', (e) => {
                this.lastCard = card;
                const title = card.querySelector('h3').innerText;
                const desc = card.querySelector('p').innerText;
                const img = card.getAttribute('data-project-img') || 'project-placeholder.jpg';
                
                this.openModal(title, desc, img);
            });
        });

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
        document.getElementById('modal-image').src = imgSrc;

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
// 6. Contact Form
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
