document.addEventListener("DOMContentLoaded", () => {
    // =========================================
    // Security & Constraints
    // =========================================
    document.addEventListener('contextmenu', event => {
        event.preventDefault(); // Global right-click block
    });

    // =========================================
    // Theme Switcher Logic
    // =========================================
    const htmlEl = document.documentElement;
    const themeBtns = document.querySelectorAll('.theme-btn');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);

    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => { setTheme(btn.getAttribute('data-theme-btn')); });
    });

    function setTheme(theme) {
        htmlEl.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        themeBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-theme-btn') === theme));
    }

    // =========================================
    // Mobile Hamburger Menu
    // =========================================
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');
    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('open');
        navToggle.classList.toggle('active');
    });

    // Close menu when a link is clicked
    document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('open');
            navToggle.classList.remove('active');
        });
    });

    // =========================================
    // Custom Interactive Cursor
    // =========================================
    const cursorDot = document.querySelector('.cursor-dot');
    const cursorOutline = document.querySelector('.cursor-outline');
    if (cursorDot && cursorOutline && window.innerWidth > 900) {
        window.addEventListener('mousemove', (e) => {
            cursorDot.style.left = `${e.clientX}px`;
            cursorDot.style.top = `${e.clientY}px`;
            cursorOutline.animate({ left: `${e.clientX}px`, top: `${e.clientY}px` }, { duration: 500, fill: "forwards" });
        });

        document.querySelectorAll('a, button, .hover-3d, .hamburger').forEach(el => {
            el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
            el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
        });
    }

    // =========================================
    // Typwriter Effect
    // =========================================
    const typeTarget = document.querySelector('.typewriter');
    if(typeTarget) {
        const fullText = typeTarget.getAttribute('data-text');
        typeTarget.innerHTML = '';
        let i = 0;
        function typeWriter() {
            if (i < fullText.length) {
                typeTarget.innerHTML += fullText.charAt(i);
                i++;
                setTimeout(typeWriter, 50);
            } else {
                setTimeout(() => typeTarget.style.borderRight = 'transparent', 2000);
            }
        }
        setTimeout(typeWriter, 600);
    }

    // =========================================
    // Apple-Style Scroll Scrubbing Animations
    // =========================================
    const scrubTargets = document.querySelectorAll('.scrub-target');
    const navbar = document.querySelector('.navbar');

    function updateScrollScrub() {
        // Navbar Scrolled State
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');

        const windowHeight = window.innerHeight;

        scrubTargets.forEach(el => {
            const rect = el.getBoundingClientRect();
            // Calculate how far the element is through the viewport
            // 0 = just entering bottom, 1 = leaving top, 0.5 = dead center
            let progress = 1 - (rect.top / windowHeight);
            
            // Map progress to CSS properties
            const type = el.getAttribute('data-scrub-type');

            if (type === 'fade-up') {
                // Fade in and slide up as it enters bottom half of screen
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 2)); // 0 to 1 scaling rapidly
                el.style.opacity = p;
                el.style.transform = `translateY(${50 - (p * 50)}px)`;
            } 
            else if (type === 'scale-up') {
                // Pop scale and fade
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 2.5));
                el.style.opacity = p;
                let scale = 0.8 + (p * 0.2);
                el.style.transform = `scale(${scale})`;
            }
            else if (type === 'slide-left') {
                // Slide in from left
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 3));
                el.style.opacity = p;
                el.style.transform = `translateX(${-100 + (p * 100)}px)`;
            }
            else if (type === 'slide-in') {
                // Slide in slightly
                let p = Math.max(0, Math.min(1, (progress - 0.1) * 2));
                el.style.opacity = p;
                el.style.transform = `translateY(${100 - (p * 100)}px) scale(${0.9 + (p*0.1)})`;
            }
            else if (type === 'hero') {
                // Hero disappears as user scrolls down
                let p = Math.max(0, Math.min(1, window.scrollY / windowHeight));
                el.style.opacity = 1 - p;
                el.style.transform = `translateY(${p * 200}px) scale(${1 - (p * 0.1)})`;
            }
        });
    }

    // High performance scroll listener using requestAnimationFrame
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                updateScrollScrub();
                ticking = false;
            });
            ticking = true;
        }
    });
    
    // Initial trigger
    updateScrollScrub();

    // =========================================
    // Separate single-trigger Observer for Skill Bars
    // =========================================
    const skillBars = document.querySelectorAll('.skill-bar');
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const bar = entry.target;
                bar.style.width = bar.getAttribute('data-width');
                obs.unobserve(bar);
            }
        });
    }, { threshold: 0.5 });
    skillBars.forEach(bar => observer.observe(bar));

    // =========================================
    // 3D Card Tilt Effect on Mousemove
    // =========================================
    if (window.innerWidth > 900) {
        document.querySelectorAll('.hover-3d').forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left; 
                const y = e.clientY - rect.top;  
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                const rotateX = ((y - centerY) / centerY) * -10; 
                const rotateY = ((x - centerX) / centerX) * 10;
                
                // Keep the scale/translateX scrub positioning but add 3D rotation
                let currentTransform = card.style.transform || '';
                // Clean old perspective/rotate/scale if any
                currentTransform = currentTransform.replace(/perspective\([^)]*\)\s*/g, '');
                currentTransform = currentTransform.replace(/rotateX\([^)]*\)\s*/g, '');
                currentTransform = currentTransform.replace(/rotateY\([^)]*\)\s*/g, '');
                currentTransform = currentTransform.replace(/scale3d\([^)]*\)\s*/g, '');

                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02) ${currentTransform}`;
                card.style.transition = 'none';
            });
            card.addEventListener('mouseleave', () => {
                // Re-trigger global scrub to restore clean transform state
                card.style.transition = 'transform 0.5s ease';
                updateScrollScrub(); 
            });
        });
    }
});
