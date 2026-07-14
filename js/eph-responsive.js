// ============================================================
// PENINGKATAN TAMPILAN PONSEL (Mobile Enhancements) - REVISI DINAMIS & HEADER VISIBLE
// ============================================================

(function() {

  var MOBILE_QUERY   = '(max-width: 800px)';
  var DRAG_THRESHOLD = 5;    

  var panel, handle, handleLabel;
  var currentY       = 0;       
  var dragging       = false;
  var moved          = false;
  var startClientY   = 0;
  var startTranslate = 0;
  var isHandleTap    = false; 
  var activeScrollNode = null; 
  var preventNextClick = false; 

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  // KUNCI 1: Hitung dinamis tinggi Handle + Header Branding
  function getVisibleTopHeight() {
    var handleHeight = handle ? handle.offsetHeight : 30; // Tinggi aman bawaan jika belum terender
    var headerElement = document.getElementById('branding');
    var headerHeight = headerElement ? headerElement.offsetHeight : 0;
    
    // Total tinggi yang disisakan saat ditarik ke bawah
    return handleHeight + headerHeight; 
  }

function collapsedTranslate() {
    // 1. Tangkap elemen navigasi utama dan hitung tingginya secara dinamis
    var navElement = document.getElementById('navigasi-utama');
    
    // Jika navigasi ditemukan, ambil tinggi aslinya. Jika belum, beri jarak aman 60px.
    var navHeight = navElement ? navElement.offsetHeight : 60; 

    // 2. Kurangi tinggi panel dengan (Header + Handle) dan KURANGI LAGI dengan tinggi navigasi
    return Math.max(panel.offsetHeight - getVisibleTopHeight() - navHeight, 0);
  }

  function clampY(y) {
    return Math.min(Math.max(y, 0), collapsedTranslate());
  }

  function applyTransform(y) {
    currentY = y;
    panel.style.transform = 'translateY(' + y + 'px)';
  }

  // KUNCI 2: Deteksi Hash URL untuk mengubah teks label secara dinamis
function updateLabel(expanded) {
    if (!handleLabel) return;
    
    var hash = window.location.hash.replace('#', '');
    var teksTarikNaik = 'Tarik naik untuk memilih hasil'; // Teks bawaan (default)
    
    if (hash === '' || hash === 'landing') {
      teksTarikNaik = 'Tarik naik untuk Mulai Menjelajah';
    } else if (hash === 'about') {
      teksTarikNaik = 'Tarik naik untuk membaca';
    } else if (hash !== 'hasil') {
      // Jika hash bukan kosong, bukan landing, bukan about, dan BUKAN hasil,
      // maka dipastikan pengguna sedang membuka spesifik butir (Q-ID).
      teksTarikNaik = 'Tarik naik untuk membaca';
    }
    
    handleLabel.textContent = expanded
      ? 'Tarik turun untuk lihat peta'
      : teksTarikNaik;
  }

 window.setMobilePanelExpanded = function(expand, animate) {
    if (!panel || !isMobile()) return;

   if (!expand) {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
   }
    
    // 1. BEKUKAN atau CAIRKAN animasi sesuai perintah
    if (animate === false) {
      panel.classList.add('eph-dragging'); 
    } else {
      panel.classList.remove('eph-dragging'); 
    }
    
    // 2. Terapkan perubahan posisi dan perbarui label dinamis
    applyTransform(expand ? 0 : collapsedTranslate());
    updateLabel(expand);
    
    // 3. JIKA SEDANG DIBEKUKAN, paksa browser snap instan lalu cairkan lagi
    if (animate === false) {
      void panel.offsetWidth; // Memicu reflow paksa pada browser
      panel.classList.remove('eph-dragging'); // Kembalikan ke state siap interaksi
    }
  };

  function getScrollableParent(node, root) {
    while (node && node !== root && node !== document.body) {
      if (node.scrollHeight > node.clientHeight) {
        var overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          return node;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  function onTouchStart(e) {
    if (!isMobile()) return;
    
    var touch = e.touches ? e.touches[0] : e;
    var target = e.target.nodeType === 3 ? e.target.parentNode : e.target;

    if (target.closest('select, input, textarea')) {
      e.stopPropagation(); 
      return; 
    }

    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
    }

    dragging = true;
    moved = false;
    startClientY = touch.clientY;
    startTranslate = currentY;
    
    isHandleTap = !!target.closest('#panel-handle');
    activeScrollNode = getScrollableParent(target, panel);

    panel.classList.add('eph-dragging');
  }

  function onTouchMove(e) {
    if (!dragging) return;
    
    var touch = e.touches ? e.touches[0] : e;
    var delta = touch.clientY - startClientY;

    if (activeScrollNode && startTranslate === 0) {
      if (delta < 0 || (delta > 0 && activeScrollNode.scrollTop > 1)) {
        dragging = false;
        panel.classList.remove('eph-dragging');
        return; 
      }
    }

    if (Math.abs(delta) > DRAG_THRESHOLD) {
      moved = true;
      if (e.cancelable) e.preventDefault(); 
    }

    applyTransform(clampY(startTranslate + delta));
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;

    var panelMovedOrToggled = false; 

    if (!moved) {
      if (isHandleTap) {
        var isCurrentlyExpanded = currentY < 50;
        window.setMobilePanelExpanded(!isCurrentlyExpanded);
        panelMovedOrToggled = true; 
      }
    } else {
      var dragDistance = currentY - startTranslate; 
      var SWIPE_THRESHOLD = 50; 

      if (dragDistance > SWIPE_THRESHOLD) {
        window.setMobilePanelExpanded(false); // Ditarik turun -> Tutup
      } 
      else if (dragDistance < -SWIPE_THRESHOLD) {
        window.setMobilePanelExpanded(true); // Ditarik naik -> Buka
      } 
      else {
        // Batal ditarik (kembalikan ke posisi semula)
        var wasExpanded = startTranslate < 50;
        window.setMobilePanelExpanded(wasExpanded);
      }
      panelMovedOrToggled = true; 
    }

    if (panelMovedOrToggled) {
      preventNextClick = true;
      setTimeout(function() { preventNextClick = false; }, 400); 
    }

    panel.classList.remove('eph-dragging');
  }
  
  function buildHandle() {
    handle = document.createElement('div');
    handle.id = 'panel-handle';

    var grip = document.createElement('div');
    grip.className = 'eph-grip';

    handleLabel = document.createElement('div');
    handleLabel.className = 'eph-handle-label';

    handle.appendChild(grip);
    handle.appendChild(handleLabel);
    panel.insertBefore(handle, panel.firstChild);
  }

  function handleViewportChange() {
    if (!panel) return;

    if (isMobile()) {
      if (!document.getElementById('panel-handle')) {
        buildHandle();
        window.setMobilePanelExpanded(true, false);
      } else {
        var isCurrentlyExpanded = currentY < 50;
        window.setMobilePanelExpanded(isCurrentlyExpanded, false);
      }
    } else {
      panel.style.transform = '';
      panel.classList.remove('eph-dragging');
      currentY = 0;
    }
  }

  window.addEventListener('load', function() {
    panel = document.getElementById('panel');
    if (!panel) return;

    handleViewportChange();

    panel.addEventListener('touchstart', onTouchStart, { passive: false });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd);
    panel.addEventListener('touchcancel', onTouchEnd);

    window.addEventListener('click', function(e) {
      if (preventNextClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true); 

    panel.addEventListener('dragstart', function(e) {
      if (e.target.tagName === 'IMG') {
        e.preventDefault();
      }
    });
  });

  window.addEventListener('resize', handleViewportChange);
  
  // Tangkap perubahan Hash (URL) dari Navigasi agar teks panel ikut terbarui meski sedang ditutup
  window.addEventListener('hashchange', function() {
     if (isMobile() && panel) {
       var isCurrentlyExpanded = currentY < 50;
       updateLabel(isCurrentlyExpanded);
     }
  });

})();
