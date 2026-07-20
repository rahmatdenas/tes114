'use strict';

const WDQS_API_URL            = 'https://query.wikidata.org/sparql';
const COMMONS_WIKI_URL_PREF   = 'https://commons.wikimedia.org/wiki/';
const COMMONS_API_URL         = 'https://commons.wikimedia.org/w/api.php';
const YEAR_PRECISION          = '9';
const OSM_LAYER_URL           = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_LAYER_ATTRIBUTION   = 'Base map © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>';
const CARTO_LAYER_URL         = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
const CARTO_LAYER_ATTRIBUTION = 'Base map © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> (data), <a href="https://carto.com/" target="_blank">CARTO</a> (style)';
const TILE_LAYER_MAX_ZOOM     = 18;

const MIN_PH_LAT              =   6.0;   
const MAX_PH_LAT              = -11.0;   
const MIN_PH_LON              =  95.0;   
const MAX_PH_LON              = 141.0;   

var currentKategoriUtama = 'general';
var Records = {};        
var ProvinceIndex = {};  
var SparqlValuesClause;  
var Map;                 
var Cluster;             
var BootstrapDataIsLoaded = false;  
var PrimaryDataIsLoaded   = false;  

var isAppInitialLoad      = true; // Tambahkan ini!
var isFetching            = false; // Menandai apakah satpam sedang mencari data
var currentSearchToken    = 0;     // <--- Letakkan di sini (berdekatan dengan isFetching)
var globalFetchController = new AbortController(); // <--- (Jika Anda jadi memasang AbortController)
var currentActiveShapeLayer = null;
var currentDisplayedQid = null;
var lastValidHash   = 'landing';
var isRevertingHash = false;
var loadingTimeoutToken = null;
var searchDebounceToken = null;
var renderTimeoutToken = null;

// =========================================================
// FUNGSI DIALOG KUSTOM (Pengganti alert & confirm)
// =========================================================
function tampilkanDialog(pesan, tipe = 'alert', judul = 'Perhatian') {
  return new Promise((resolve) => {
    let overlay = document.getElementById('eph-dialog-overlay');
    let titleElem = document.getElementById('eph-dialog-title');
    let msgElem = document.getElementById('eph-dialog-msg');
    let btnYes = document.getElementById('eph-dialog-btn-yes');
    let btnNo = document.getElementById('eph-dialog-btn-no');

    titleElem.textContent = judul;
    msgElem.innerHTML = pesan; 

    if (tipe === 'confirm') {
      btnNo.style.display = 'inline-block';
      btnYes.textContent = 'Ya';
    } else {
      btnNo.style.display = 'none'; 
      btnYes.textContent = 'Tutup'; // <--- Teks diubah menjadi "Tutup"
    }

    overlay.classList.add('aktif');

    // Fungsi pembantu agar bersih dari bentrok memori
    const tutupDanBersihkan = (nilai) => {
      overlay.classList.remove('aktif');
      btnYes.onclick = null;
      btnNo.onclick = null;
      overlay.onclick = null;
      resolve(nilai);
    };

    // Tutup saat tombol ditekan
    btnYes.onclick = () => tutupDanBersihkan(true);
    btnNo.onclick = () => tutupDanBersihkan(false);

    // +++ TAMBAHAN UX SELULER +++
    // Jika area hitam (overlay) di luar kotak diklik, otomatis tutup!
    // (Hanya berlaku untuk mode "alert". Untuk "confirm", user harus pilih Ya/Batal).
    overlay.onclick = function(e) {
      if (e.target === overlay && tipe === 'alert') {
        tutupDanBersihkan(true);
      }
    };
  });
}

window.konfirmasiBerhenti = function() {
  tampilkanDialog("Anda yakin ingin mencukupkan penarikan? Data yang tertangkap sejauh ini akan segera disusun dan dirender ke peta.", "confirm", "Cukupkan Pencarian")
    .then(yakin => {
      if (yakin) {
        window.hentikanPencarian = true; 
        
        let progressText = document.querySelector('#index-list p');
        if (progressText) {
           progressText.innerHTML = `<span style="color:#7b0d0c; font-weight:bold;">Memutus koneksi... Menyiapkan data yang terselamatkan.</span><br><br>Mohon tunggu sebentar, sistem sedang membangun koordinat peta...`;
        }
        // +++ TAMBAHAN: Sembunyikan tombol setelah dipencet agar layar bersih +++
        let wadahTombol = document.getElementById('wadah-tombol-berhenti');
        if (wadahTombol) wadahTombol.style.display = 'none';

        // +++ KUNCI PERBAIKAN: Bunuh yang lama, lahirkan yang baru +++
        if (typeof globalFetchController !== 'undefined') {
          let oldController = globalFetchController;
          globalFetchController = new AbortController(); // Beri nyawa baru untuk sisa proses peta
          oldController.abort(); // Tembak mati pencarian yang sedang nyangkut
        }
      }
    });
};

const ikonTetesanAir = L.divIcon({
  className: 'ikon-marker-ringan',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -13 412 538" width="30" height="40" style="overflow: visible;">
           <ellipse cx="192" cy="510" rx="60" ry="15" fill="rgba(0,0,0,0.4)" />
           
           <path fill="#cc4444" fill-rule="evenodd" 
                 d="M172.3 501.7C27 291 0 269.4 0 192 0 86 86 0 192 0s192 86 192 192c0 77.4-27 99-172.3 309.7-9.5 13.8-29.9 13.8-39.5 0z 
                    M 192, 132 a 60,60 0 1,0 0,120 a 60,60 0 1,0 0,-120 z"/>
         </svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 39],   
  popupAnchor: [0, -37]   
});

window.addEventListener('load', init);

function init() {
  initMap();
  setupLandingForm();
  window.addEventListener('hashchange', processHashChange);

  // =========================================================
  // LANGKAH B: LOGIKA BUKA-TUTUP MENU DROP-UP
  // =========================================================
document.addEventListener('click', function(e) {
    let btnMenu = document.getElementById('btn-menu-induk');
    let subMenu = document.getElementById('submenu-atas');
    
    if (!btnMenu || !subMenu) return;

    // Jika tombol "Menu" ditekan, buka/tutup anak menu + atur warna aktifnya
    if (e.target === btnMenu) {
      if (subMenu.style.display === 'none') {
        subMenu.style.display = 'flex';
        btnMenu.parentElement.classList.add('selected'); // Menyala saat diklik buka
      } else {
        subMenu.style.display = 'none';
        btnMenu.parentElement.classList.remove('selected'); // Padam saat ditutup
      }
    } 
    // Jika pengguna mengklik di area luar menu, sembunyikan dan padamkan
    else if (!subMenu.contains(e.target)) {
      subMenu.style.display = 'none';
      btnMenu.parentElement.classList.remove('selected');
    } 
    // Jika pengguna mengklik salah satu link di dalam anak menu, sembunyikan dan padamkan
    else if (e.target.tagName === 'A') {
      subMenu.style.display = 'none';
      btnMenu.parentElement.classList.remove('selected');
    }
  });
  // =========================================================
  
  Map.on('popupopen', function(e) { 
    e.popup._sudahDiupdate = false;
    let qid = e.popup._qid;
    if (window.location.hash !== '#' + qid) {
      window.location.hash = qid; 
    }
    let record = Records[qid];
    
    // 2. INJEKSI GAMBAR POPUP
    if (record.imageFilename && !e.popup._hasImage) {
      let encodedFilename = encodeURIComponent(record.imageFilename);
      let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodedFilename}?width=250`;
      let imgHtml = `
            <div style="text-align:center; margin-top:17px;margin-bottom: 5px;">
              <img src="${imgUrl}" 
                   draggable="false" 
                   style="width:100%; min-width:90px; height:130px; object-fit:cover; border-radius:4px;" 
                   alt="Thumbnail"
                   onload="let p = Records['${qid}'].popup; if (p && !p._sudahDiupdate) { p._sudahDiupdate = true; p.update(); }">
            </div>
          `;
      e.popup.setContent(imgHtml + `${record.title}`);      
      e.popup._hasImage = true; 
    }
  });
  processHashChange();
  setTimeout(() => {
    let preloader = document.getElementById('eph-preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
      // Hapus elemen sepenuhnya dari DOM setelah animasinya selesai (400ms) agar tidak membebani memori
      setTimeout(() => preloader.remove(), 400); 
    }
  }, 150);
}


function setupLandingForm() {
  let dropdown = document.getElementById('jenis-dropdown');
  let inputTxt = document.getElementById('jenis-input');
  let btnMulai = document.getElementById('btn-mulai');

  if (!dropdown || !inputTxt || !btnMulai) return;

  dropdown.addEventListener('change', function() {
    if (this.value === 'custom') {
      inputTxt.value = 'wd:'; 
      inputTxt.readOnly = false;
      inputTxt.style.backgroundColor = '#ffffff';
      inputTxt.focus();
    } else {
      inputTxt.value = this.value;
      inputTxt.readOnly = true;
      inputTxt.style.backgroundColor = '#f5f5f5';
    }
  });

btnMulai.addEventListener('click', function() {
    let finalValue = inputTxt.value.trim();
    if (finalValue === '' || finalValue === 'wd:') {
      alert('Anda belum memasukkan parameter Q-ID');
      return;
    }
    
    resetApp();
    
    // === MULAI LOADING ===
    isFetching = true; 
    currentSearchToken = Date.now();
    
    window.location.hash = 'hasil';
    
    // =========================================================
    // +++ PASANG BOM WAKTU DI SINI SAYANGKU +++
    // =========================================================
loadingTimeoutToken = setTimeout(() => {
      // KUNCI PERBAIKAN: Kita bidik langsung elemen <p>-nya saja, 
      // jangan bidik #index-list agar judul & animasi tidak terhapus.
      let loadingDesc = document.querySelector('#index-list p'); 
      
      // Pastikan statusnya memang masih mencari data (isFetching = true)
      if (loadingDesc && isFetching) {
        loadingDesc.innerHTML = `Jika data mencapai ribuan, proses penarikan data membutuhkan waktu 3-7 menit...`;
      }
    }, 10000); // (10 detik)
    // =========================================================

    loadPrimaryData();
  });
}

function resetApp() {
  currentSearchToken = 0;
  window.hentikanPencarian = false;

  if (loadingTimeoutToken) {
    clearTimeout(loadingTimeoutToken);
    loadingTimeoutToken = null;
  }
  
  // =========================================================
  // +++ BUNUH SEMUA KONEKSI YANG SEDANG BERJALAN +++
  // =========================================================
  if (typeof globalFetchController !== 'undefined') {
    globalFetchController.abort(); // Membunuh semua XHR & Fetch serentak!
    globalFetchController = new AbortController(); // Beri nyawa baru
  }

  let brandingDesc = document.getElementById('branding-desc');
  if (brandingDesc) {
    brandingDesc.textContent = 'Ensiklopedia Interaktif Indonesia';
  }

  // 2. Bersihkan Memori Inti
  Records = {};
  ProvinceIndex = {};
  BootstrapDataIsLoaded = false;
  PrimaryDataIsLoaded = false;
  isFetching = false; 
  currentDisplayedQid = null;
  currentFilteredRecords = [];
  currentRenderIndex = 0;

  // 3. Bersihkan Titik di Peta
  if (Cluster) {
    Cluster.clearLayers();
  }

  // 4. Bersihkan Daftar Bangunan
  let indexList = document.getElementById('index-list');
  if (indexList) indexList.innerHTML = '';

  // =========================================================
  // KUNCI PERBAIKAN: BERSIHKAN "HANTU KOSMETIK" DI TAMPILAN
  // =========================================================

 // A. Kembalikan Menu Wilayah ke status kosong
  let selectRegion = document.getElementById('filter-region');
  if (selectRegion) {
    selectRegion.innerHTML = '<option value="all">Semua Wilayah</option>';
    selectRegion.value = 'all';
  }

  // B. Kembalikan Menu Usia ke default
  let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    selectKombinasi.value = 'default';
  }
  
  // C. Bersihkan Kotak Pencarian dan Angka Hasil
  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = 'Belum ada hasil...';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // D. Tangkap tombol bos (btnAll) cukup SEKALI saja di sini
  let btnAll = document.getElementById('btn-all');
  
  document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => {
    b.classList.remove('active');
  });

  // E. Kembalikan teks asli pada tombol dan KUNCI SEMUANYA untuk Landing
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  
  if (btnImg) { 
    btnImg.textContent = 'Memiliki Gambar';
    btnImg.classList.add('disabled'); 
  }
  if (btnArt) { 
    btnArt.textContent = 'Memiliki Artikel';
    btnArt.classList.add('disabled'); 
  }
  if (btnAll) {
    btnAll.textContent = 'Semua Hasil';
    btnAll.classList.add('disabled');   // Kunci di awal
    btnAll.classList.remove('active');  // Matikan lampu active-nya
  }

  // F. Reset memori variabel filter di JS 3 agar tidak menyisakan status
  if (typeof activeFeatures !== 'undefined' && activeFeatures.clear) activeFeatures.clear();
  if (typeof currentRegionFilter !== 'undefined') currentRegionFilter = 'all';
  if (typeof currentUsiaFilter !== 'undefined') currentUsiaFilter = 'all';
  if (typeof currentSearchQuery !== 'undefined') currentSearchQuery = '';

  // Taruh baris ini di bagian paling bawah fungsi resetApp()
  let subMenuAtas = document.getElementById('submenu-atas');
  if (subMenuAtas) subMenuAtas.style.display = 'none';
}

function initMap() {
  // 1. Matikan atribusi bawaan agar bisa kita pindahkan
Map = new L.map('map', { 
  zoomControl: false, 
  attributionControl: false,
  zoomDelta: 2, // Lompatan tombol +/- (Ubah ke 2 atau 3 untuk lompatan lebih jauh)
  zoomSnap: 2   // Kunci presisi scroll mouse (Selalu samakan angkanya dengan zoomDelta)
});
  Map.fitBounds([[MAX_PH_LAT, MAX_PH_LON], [MIN_PH_LAT, MIN_PH_LON]]);

  // 2. Tambahkan Atribusi di Kiri Atas (Dieksekusi paling pertama agar ada di posisi paling atas)
  L.control.attribution({ position: 'topleft' }).addTo(Map);

  let cartoLayer = new L.tileLayer(CARTO_LAYER_URL, {
    attribution : CARTO_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  }).addTo(Map);
  
  let osmLayer = new L.tileLayer(OSM_LAYER_URL, {
    attribution : OSM_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  });
  
  let baseMaps = {
    'CARTO Voyager'       : cartoLayer,
    'OpenStreetMap Carto' : osmLayer,
  };
  
  // 3. Tombol Layer otomatis akan ditambahkan di bawah teks atribusi
  L.control.layers(baseMaps, null, {position: 'topleft'}).addTo(Map);
  L.control.zoom({ position: 'bottomright' }).addTo(Map);

  // SIMPAN KE VARIABEL GLOBAL
  window.TombolGPSMap = L.control.locate({ 
    position: 'bottomright', 
    showCompass: false, 
    showPopup: false,
    strings: { title: "Tunjukkan lokasi saya" },
    icon: 'ikon-gps-custom' 
  }).addTo(Map);  

  let powered = L.control({ position: 'bottomleft' });
  powered.onAdd = function(Map) {
    var divElem = L.DomUtil.create('div', 'powered');
    divElem.innerHTML = '<a><img src="img/powered_by_wikidata.png"></a>';
    return divElem;
  };
  powered.addTo(Map);
	
  // KENDALIKAN MANUAL KLIK PADA KLASTER
Cluster = new L.markerClusterGroup({
  maxClusterRadius: function(zoom) {
    let z = Math.round(zoom);        
    if (z <= 15) return 50;
    if (z === 16) return 35;
    if (z === 17) return 20;
    return 10; 
  },
  zoomToBoundsOnClick: true, // KEMBALIKAN KE TRUE
  spiderfyOnMaxZoom: true    // KEMBALIKAN KE TRUE
}).addTo(Map);

// GANTI event clusterclick Anda menjadi seperti ini:
Cluster.on('clusterclick', function (a) {
  let cluster = a.layer;
  let count = cluster.getChildCount();
  let currentZoom = Map.getZoom();
  let maxZoom = TILE_LAYER_MAX_ZOOM;
  
  // Deteksi jika kluster akan melakukan spiderfy (mekar)
  // Ini terjadi jika sudah mentok maxZoom, ATAU koordinatnya sama persis
  let bounds = cluster.getBounds();
  let isSamePoint = bounds.getSouthWest().equals(bounds.getNorthEast());

  if (currentZoom >= maxZoom || isSamePoint) {
    if (count > 60) {
      // Cegah Leaflet memekarkan kluster secara internal
      cluster.unspiderfy(); 
      
      tampilkanDialog(
        `Terlalu banyak data di titik ini (<b>${count} item</b>).<br><br>Untuk melihatnya, silakan buka daftar indeks dan persempit pencarian wilayah.`, 
        "alert", 
        "Titik Terlalu Padat"
      );
    }
  }
});
}

// Tambahkan parameter 'signal' di bagian akhir
function queryWdqsThenProcess(query, processEachResult, postprocessCallback, signal = null) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    
    // +++ KUNCI ABORT CONTROLLER +++
    if (signal) {
      // 1. Jika request keburu dibatalkan sebelum sempat dikirim
      if (signal.aborted) return reject('ABORTED');
      
      // 2. Pasang telinga: jika sinyal ditarik, bunuh XHR ini!
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject('ABORTED');
      });
    }

    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;

      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else if (xhr.status === 0) {
        // Jika status 0 dan signal tertangkap 'aborted', berarti ini dibatalkan
        reject((signal && signal.aborted) ? 'ABORTED' : 'NETWORK_ERROR');
      } else {
        reject(xhr.status);
      }
    };
    
    xhr.open('POST', WDQS_API_URL, true);
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Accept', 'application/sparql-results+json');
    
    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });

  promise = promise.then(data => {
    data.results.bindings.forEach(processEachResult);
  });
  if (postprocessCallback) promise = promise.then(postprocessCallback);
  return promise;
}

function fetchWdqsRaw(query, signal = null) {
  return new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();

    // +++ KUNCI ABORT CONTROLLER +++
    if (signal) {
      if (signal.aborted) return reject('ABORTED');
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject('ABORTED');
      });
    }

    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;

      if (xhr.status === 200) {
        try {
          let data = JSON.parse(xhr.responseText);
          resolve(data.results.bindings);
        } catch (e) {
          reject('PARSE_ERROR');
        }
      } else if (xhr.status === 0) {
        reject((signal && signal.aborted) ? 'ABORTED' : 'NETWORK_ERROR');
      } else {
        reject(xhr.status); 
      }
    };

    xhr.open('POST', WDQS_API_URL, true);
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Accept', 'application/sparql-results+json');

    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });
}

async function fetchWdqsRawWithRetry(query, maxRetry = 3, offsetLabel = '', signal = null) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
      if (signal && signal.aborted) throw 'ABORTED'; // TAMBAHKAN pengecekan di awal 
    try {
      if (attempt > 1) {
        let progressText = document.querySelector('#index-list p');
        if (progressText) {
progressText.innerHTML = `Sedang melakukan percobaan ulang ke-${attempt}${offsetLabel}...`;
        }
      }
      
      // Sekarang variabel signal dikenali dengan aman
      let result = await fetchWdqsRaw(query, signal);
      
      if (attempt > 1) {
        console.log(`[${offsetLabel}] Berhasil setelah percobaan ke-${attempt}`);
      }
      return result;

    } catch (error) {
      if (error === 'ABORTED') throw error; 
      
	
      console.warn(`[${offsetLabel}] Percobaan ke-${attempt} gagal (${error}), mencoba lagi...`);
      
      let progressText = document.querySelector('#index-list p');
      if (progressText) {
progressText.innerHTML = `<span style="color:#cc0000; font-weight:bold;">Percobaan ke-${attempt} gagal${offsetLabel}. Melakukan penarikan ulang.</span>`;
         }

      // KUNCI PERBAIKAN: Gunakan status AbortSignal murni
      if (attempt === maxRetry) {
        if (signal && signal.aborted) throw 'ABORTED';
        throw error;
      }
      
      await new Promise(r => setTimeout(r, 1500 * attempt));
      
      // Jaring pengaman ekstra setelah jeda
      if (signal && signal.aborted) throw 'ABORTED';
    }
  }
}

// FUNGSI BARU #3: Loop LIMIT/OFFSET, PAKAI JUMLAH ENTITAS UNIK (?SQ) sebagai penanda halaman terakhir
// (bukan jumlah baris mentah — karena satu entitas bisa punya >1 baris akibat OPTIONAL tanggal ganda)

async function queryWdqsPaginated(queryTemplate, processEachResult, postprocessCallback, chunkSize = 5000) {
  let offset = 0;
  let halaman = 1;
  let totalDataTerkumpul = 0; 
  let signal = typeof globalFetchController !== 'undefined' ? globalFetchController.signal : null; // TAMBAHKAN INI
  try {
    while (true) {
      if (window.hentikanPencarian) break;

      let pagedQuery = queryTemplate.replace('<PLACEHOLDER_LIMIT_OFFSET>', `LIMIT ${chunkSize} OFFSET ${offset}`);
let offsetLabel = ` (data ${offset.toLocaleString('id-ID')}–${(offset + chunkSize).toLocaleString('id-ID')})`
let bindings = await fetchWdqsRawWithRetry(pagedQuery, 3, offsetLabel, signal); // ganti di sini
      
      if (window.hentikanPencarian) break;
      
      if (halaman === 1 && loadingTimeoutToken) {
        clearTimeout(loadingTimeoutToken);
        loadingTimeoutToken = null;
      }
      
      bindings.forEach(processEachResult);
      let kombinasiUnik = new Set(
        bindings.map(b => `${b.SQ.value}|${b.PQ ? b.PQ.value : ''}|${b.LQ ? b.LQ.value : ''}`)
      ).size;
      
      totalDataTerkumpul += kombinasiUnik;
      console.log(`[Halaman ${halaman}] Kombinasi (s,p,l) unik:`, kombinasiUnik);
      
if (kombinasiUnik < chunkSize) {
         break; 
      } else {
         let progressText = document.querySelector('#index-list p');
         
         if (progressText && !window.hentikanPencarian) {
           // 1. Teks informasi cukup angka saja (tanpa link)
           progressText.innerHTML = `Selesai menarik <b>${totalDataTerkumpul.toLocaleString('id-ID')}</b> data. Penarikan data masih berlanjut...`;
           
           // 2. +++ PERBAIKAN TOMBOL "Cukupkan Pencarian?" +++
if (totalDataTerkumpul >= 20000) {
  let wadahTombol = document.getElementById('wadah-tombol-berhenti');
  if (wadahTombol && wadahTombol.innerHTML === '') {
    // Tombol sekarang berada di wadah sendiri, tidak menumpang di <p>
    wadahTombol.innerHTML = `<a href="#" onclick="window.konfirmasiBerhenti(); return false;" style="background-color: #7b0d0c; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: 600;">Cukupkan Pencarian?</a>`;
  }
}
         }
      }
      offset += chunkSize;
      halaman++;
    }
} catch (error) {
    if (error === 'ABORTED') {
      if (window.hentikanPencarian) {
         console.log('Penarikan dipotong paksa oleh pengguna. Melanjutkan ke render peta...');
      } else {
         console.log('Penarikan dibatalkan sepenuhnya karena reset/URL berubah.');
         return; 
      }
    } else {
      console.error('Proses paginasi gagal total:', error);
      
      // +++ KUNCI PERBAIKAN: PENYELAMATAN DATA +++
      // Jika kegagalan terjadi ketika kita SUDAH memiliki data (Halaman 2 ke atas)
      if (totalDataTerkumpul > 0) {
        console.warn(`Koneksi terputus. Menyelamatkan ${totalDataTerkumpul} data yang ada...`);
        
        // Beri tahu pengguna bahwa tidak semua data berhasil ditarik
        tampilkanDialog(
          `Koneksi internet tidak stabil saat menarik sisa data.<br><br>Sistem berhasil menyelamatkan <b>${totalDataTerkumpul.toLocaleString('id-ID')}</b> data. Peta akan dibangun berdasarkan data yang berhasil ditangkap.`, 
          "alert", 
          "Koneksi Terputus Sebagian"
        );
        
        // KUNCI: KITA TIDAK ME-THROW ERROR DI SINI!
        // Membiarkan kode berlanjut ke postprocessCallback() di bawah, 
        // sehingga proses akan otomatis lanjut merakit koordinat dan peta.
        
      } else {
        // Jika dari awal (Halaman 1) sudah gagal, lempar error untuk memunculkan layar merah
        throw error;
      }
      // ++++++++++++++++++++++++++++++++++++++++++
    }
  }
  
  // Baris ini akan merakit sisa data yang selamat karena tidak ada 'throw' yang menghalanginya
  if (postprocessCallback) postprocessCallback();
}

function enableApp() {
  PrimaryDataIsLoaded = true;
  isFetching = false; // Tarikan selesai!
  processHashChange();
}

function processHashChange() {
  // 1. CEGATAN MUNDUR: Jika kita sedang dalam proses mengembalikan URL karena pengguna 
  // menekan "Batal", abaikan siklus ini agar tidak terjadi infinite loop.
  if (isRevertingHash) {
    isRevertingHash = false;
    return; 
  }

  let logoBranding = document.getElementById('branding-icon');
if (logoBranding) {
  logoBranding.classList.add('nyala-sementara');
  // Matikan lampu logo setelah 600 milidetik (0.6 detik)
  setTimeout(() => {
    logoBranding.classList.remove('nyala-sementara');
  }, 300);
}

  let fragment = window.location.hash.replace('#', '');

  // Jangan paksa panel terbuka di mobile saat baru dimuat
  if (typeof window.setMobilePanelExpanded === 'function') {
    isAppInitialLoad = false; 
  }

  // =================================================================
  // 2. KOTAK KONFIRMASI (Bekerja mulus di Safari & Chrome)
  // =================================================================
  
 // Jika pengguna mencoba ke Beranda (fragment kosong) TAPI ada data yang sudah/sedang ditarik
  if (fragment === '' && (PrimaryDataIsLoaded || isFetching)) {
    
    // Panggil dialog kustom kita
    tampilkanDialog("Kembali ke beranda akan menghapus data yang sedang/sudah dimuat. Anda yakin ingin mereset pencarian?", "confirm", "Kembali ke Beranda")
      .then(yakin => {
        if (yakin) {
          // JIKA YA: Bersihkan semua dan kembali ke Beranda murni
          lastValidHash = 'landing';
          history.replaceState(null, null, window.location.pathname);
          resetApp();
          document.title = 'Mulai – ' + BASE_TITLE;
          displayPanelContent('landing');
          updateNavigationUI(''); 
        } else {
          // JIKA BATAL: Kembalikan URL ke posisi sebelumnya secara diam-diam
          isRevertingHash = true;
          window.location.hash = lastValidHash === 'landing' ? '' : lastValidHash;
        }
      });
    
    return; // Tetap hentikan eksekusi sinkron di sini
  }
  // =================================================================
  // Jika tidak ada halangan atau bukan menuju Beranda, jalankan normal
  // =================================================================

  updateNavigationUI(fragment);

  if (fragment === '') {
    // BERANDA NORMAL (Tidak ada data ditarik, murni baru buka web)
    lastValidHash = 'landing';
    history.replaceState(null, null, window.location.pathname); 
    resetApp(); 
    document.title = 'Mulai – ' + BASE_TITLE;
    displayPanelContent('landing');
  }
  else if (fragment === 'about') {
    // TENTANG
    lastValidHash = 'about'; // Catat sebagai hash terakhir yang valid
    document.title = 'Tentang – ' + BASE_TITLE;
    displayPanelContent('about');
    currentDisplayedQid = null;
  }
  else {
    // HASIL atau DETAIL BUTIR
    lastValidHash = fragment; // Catat QID atau 'hasil' sebagai hash terakhir yang valid
    
    let isIndexPage = (fragment === 'hasil');

    // KONDISI 1: DATA BELUM DITARIK (ATAU SEDANG DITARIK)
    if (!PrimaryDataIsLoaded) {
      if (fragment !== '') {
        // Jika sembarang ketik URL atau menekan tab Hasil sebelum data ditarik
        if (!isIndexPage) window.location.hash = 'hasil'; // Paksa arahkan ke #hasil
        
        // --- KUNCI PERBAIKAN 1 ---
        // Jika sedang loading, beri tahu di tab browser. Jika murni kosong, tulis "Data Belum Ditarik"
        if (isFetching) {
          document.title = `Memuat ${currentNamaKlaster}... – ${BASE_TITLE}`;
        } else {
          document.title = 'Data Belum Ditarik – ' + BASE_TITLE;
        }

        displayPanelContent('index');

        let indexList = document.getElementById('index-list');          
        if (indexList && !isFetching) {
          indexList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
              <h3 style="margin-bottom: 10px; margin-top:0; color: #333;">Data Belum Ditarik</h3>
              <p style="color: #666; font-size:14px; margin-bottom: 25px;">
              Anda belum melakukan pencarian. Silakan kembali ke halaman Beranda untuk memilih entitas yang ingin dieksplorasi.</p>
              <a href="#" style="background-color: #7b0d0c; color: #fff; 
              padding: 10px 20px; text-decoration: none; border-radius: 5px; 
              font-weight: 600; display: inline-block;">Pilih Data</a>
            </div>
          `; // href="#" agar memicu kembali ke Beranda murni
        }
      }
    } 
    // KONDISI 2: DATA SUDAH DITARIK NORMAL
    else {
      if (isIndexPage || !(fragment in Records)) {
        if (!isIndexPage) window.location.hash = 'hasil';  
        
        // --- KUNCI PERBAIKAN 2 ---
        // Tampilkan Nama Klaster dan Wilayah saat pengguna membuka tab Hasil
        document.title = `${currentNamaKlaster} di ${currentNamaWilayah} – ${BASE_TITLE}`;
        
        displayPanelContent('index');
        currentDisplayedQid = null;
      }
      else {
        // Buka Detail Butir (Judul otomatis mengikuti nama bangunan/situs karena fungsi displayRecordDetails)
        activateMapMarker(fragment);
        displayRecordDetails(fragment);
      }
    }
  }
}

function activateMapMarker(qid) {
  let record = Records[qid];
  if (!record.mapMarker) return; 

  if (record.popup && record.popup.isOpen()) {
    return;
  }

  try {
    Map.closePopup();

    // +++ PATCH: paksa marker masuk cluster kalau belum sempat ditambahkan +++
    // (mengatasi race condition dengan debounce 150ms di applyIntersectionFilter)
    if (!Cluster.hasLayer(record.mapMarker)) {
      Cluster.addLayer(record.mapMarker);
    }
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    let countSameLocation = 0;
    currentFilteredRecords.forEach(r => {
      if (r.lat === record.lat && r.lon === record.lon) {
        countSameLocation++;
      }
    });

    if (countSameLocation > 60) {
      Map.setView([record.lat, record.lon], TILE_LAYER_MAX_ZOOM);
      setTimeout(() => {
        if (window.location.hash !== '#' + qid) return;
        let visibleParent = Cluster.getVisibleParent(record.mapMarker);
        if (visibleParent && visibleParent._icon) {
          visibleParent._icon.classList.add('cluster-efek-denyut');
          setTimeout(() => {
            if (visibleParent._icon) visibleParent._icon.classList.remove('cluster-efek-denyut');
          }, 4500);
        }
      }, 350);
    } else {
      // Sekarang cabang else "marker belum di cluster" tidak diperlukan lagi,
      // karena sudah dijamin ada lewat guard di atas.
      Cluster.zoomToShowLayer(
        record.mapMarker,
        function() {
          if (window.location.hash !== '#' + qid) return;
          if (!record.popup.isOpen()) record.mapMarker.openPopup();
        }
      );
    }
  } catch (error) {
    console.warn("Interupsi animasi peta dicegat:", error);
  }
}

function displayPanelContent(id) {
  // Hanya mengatur panel konten yang tampil
  document.querySelectorAll('.panel-content').forEach(content => {
    content.style.display = (content.id === id) ? content.dataset.display : 'none';
  });
}

function displayRecordDetails(qid) {
    if (currentDisplayedQid === qid) return;  // <-- CALL #2 berhenti di sini, tidak ada kedip shapeLayer
  currentDisplayedQid = qid;
  let record = Records[qid];
  document.title = `${record.indexTitle} – ${BASE_TITLE}`;

  // =========================================================
  // +++ KUNCI AUTO-RETRY YANG AMAN +++
  // =========================================================
  // Jika pengguna mengklik marker ini lagi dan sebelumnya cacat karena offline,
  // buang memori panel lamanya agar sistem dipaksa memuat ulang dari nol!
  if (record._gagalOffline) {
    record.panelElem = undefined;
    record._gagalOffline = false; // Reset statusnya
  }
  
  if (PrimaryDataIsLoaded) {
    // KUNCI PERBAIKAN: Bersihkan poligon lama, pasang yang baru
    if (currentActiveShapeLayer) Map.removeLayer(currentActiveShapeLayer);
    if (record.shapeLayer) {
      record.shapeLayer.addTo(Map);
      currentActiveShapeLayer = record.shapeLayer;
    }

    if (!record.panelElem) {
      generateRecordDetails(qid);
      
      if (typeof populateImportantEventsData === 'function') {
        populateImportantEventsData(qid);
      }
      if (typeof populateHistoricalImagesData === 'function') {
        populateHistoricalImagesData(qid);
      }
    }
    
    let detailsElem = document.getElementById('details');
detailsElem.innerHTML = ''; 
detailsElem.appendChild(record.panelElem);

    let stuckImages = record.panelElem.querySelectorAll('img.loading');
    stuckImages.forEach(img => {
      // Jika gambar belum tuntas dimuat ATAU gagal dimuat (lebar aslinya 0)
      if (!img.complete || img.naturalWidth === 0) {
        let currentSrc = img.src;
        img.src = ''; // Kosongkan src sejenak
        img.src = currentSrc; // Isi kembali untuk memaksa browser mengulang request HTTP
      }
    });
let stuckCaptions = record.panelElem.querySelectorAll('figcaption');
    stuckCaptions.forEach(caption => {
      // Jika teksnya masih nyangkut di memuat...
      if (caption.textContent.includes('(Memuat…)')) {
        let encodedFile = caption.getAttribute('data-filename');
        if (encodedFile) {
          // KUNCI: Cukup panggil fungsi pembantunya di sini!
          tarikMetadataCaption(encodedFile, null, caption);
        }
      }
    });
    displayPanelContent('details');
  }
  else {
    displayPanelContent('loading');
  }
}

function generateFigure(filename, title = "Situs", classNames = []) {
  if (filename) {
    let uniqueId = 'caption-' + Math.random().toString(36).substr(2, 9);
    let encodedFilename = encodeURIComponent(filename);
    
    // KUNCI: Cukup panggil fungsi pembantunya di sini!
    tarikMetadataCaption(encodedFilename, uniqueId, null);

    return (
      `<figure class="${classNames.join(' ')}">` +
        `<a href="${COMMONS_WIKI_URL_PREF}File:${encodedFilename}" target="_blank">` +
          `<img class="loading" src="${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodedFilename}?width=500" alt="" onload="this.className=''">` +
        '</a>' +
        `<figcaption id="${uniqueId}" data-filename="${encodedFilename}">(Memuat…)</figcaption>` +
      '</figure>'
    );
  } else {
    // KODE JIKA TIDAK ADA GAMBAR (Biarkan tetap sama)
    let namaAmanURL = encodeURIComponent(title);
    let gFormFotoUrl = `https://docs.google.com/forms/d/e/1FAIpQLSd7_u-7yCwDtXIkDO--bILry6mWGoRCnnfSumL_PEjfle0aLg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    return `<figure class="${classNames.join(' ')} nodata">Belum ada foto. <a href="${gFormFotoUrl}" target="_blank" rel="noopener noreferrer" style="border:none;" class="sunting-linktambah">Tambahkan!</a></figure>`;
  }
}

function extractImageFilename(image) {
  let regex = /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;
  return decodeURIComponent(image.value.replace(regex, ''));
}

function parseDate(result, keyName) {
  let dateVal = result[keyName].value;
  if (result[keyName + 'Precision'].value === YEAR_PRECISION) {
    return dateVal.substr(0, 4);
  } else {
    let date = new Date(dateVal);
    return date.toLocaleDateString('en-US', { month : 'long', day : 'numeric', year : 'numeric' });
  }
}

// ============================================================
// FITUR RADAR GPS: MENCARI SITUS DALAM RADIUS TERTENTU
// ============================================================
function jalankanFilterGPS(selectElem) {
  // 1. Beri tahu pengguna sistem sedang mencari
  selectElem.options[selectElem.selectedIndex].text = "⏳ Mencari satelit GPS...";

  // =========================================================
  // KUNCI KECERDASAN: SIMPAN & MATIKAN AUTO-ZOOM PLUGIN
  // =========================================================
  let konfigurasiZoomAsli = window.TombolGPSMap.options.setView;
  window.TombolGPSMap.options.setView = false; // Matikan tarikan kamera plugin!

  // 2. Perintahkan plugin bawaan menyala dan mulai melacak
  window.TombolGPSMap.start();

  // 3. Tangkap sinyal saat plugin selesai mendaratkan titik GPS-nya
  Map.once('locationfound', function(e) {
    // KEMBALIKAN konfigurasi zoom agar kalau tombolnya dipencet manual, dia tetap nge-zoom
    window.TombolGPSMap.options.setView = konfigurasiZoomAsli;

    // Simpan koordinat ke variabel global
    userLocation = {
      lat: e.latlng.lat,
      lon: e.latlng.lng
    };

    selectElem.options[selectElem.selectedIndex].text = "Sekitar Anda (Radius 10 km)";
    currentRegionFilter = 'terdekat';

    // Bersihkan lingkaran 10km lama jika ada
    if (userRadiusCircle) Map.removeLayer(userRadiusCircle);

    // Buat Lingkaran Merah Transparan
    userRadiusCircle = L.circle([userLocation.lat, userLocation.lon], {
      color: 'transparent',
      fillColor: '#882222',
      fillOpacity: 0.1,
      radius: 10000
    }).addTo(Map);

    // Kamera kitalah yang mengambil alih! Zoom out untuk mencakup seluruh 10km
    Map.fitBounds(userRadiusCircle.getBounds());

    // Jalankan filter
    applyIntersectionFilter();
  });

  // 4. Tangkap jika GPS ditolak atau gagal
  Map.once('locationerror', function(e) {
    window.TombolGPSMap.options.setView = konfigurasiZoomAsli;
    window.TombolGPSMap.stop(); // Matikan plugin
    alert("Akses lokasi gagal atau ditolak. Pastikan GPS HP Anda menyala.");
    batalkanFilterGPS(selectElem);
  });
}

function batalkanFilterGPS(selectElem) {
  // 1. Matikan langsung plugin GPS bawaannya (Titiknya akan hilang otomatis!)
  if (window.TombolGPSMap) window.TombolGPSMap.stop();

  // +++ KUNCI PERBAIKAN: Lepas listener 'once' yang mungkin masih menunggu +++
  // Supaya kalau user Start -> Cancel -> Start lagi, tidak ada listener lama
  // yang masih nyangkut dan bisa terpicu ganda (event locationfound bisa datang
  // terlambat setelah user sudah membatalkan).
  Map.off('locationfound');
  Map.off('locationerror');
  // +++ akhir tambahan +++

  // 2. Hapus lingkaran merah buatan kita
  if (userRadiusCircle) Map.removeLayer(userRadiusCircle);

  // 3. Reset ke status 'all'
  selectElem.value = 'all';
  currentRegionFilter = 'all';
  userLocation = null;

  let opsi = Array.from(selectElem.options).find(opt => opt.value === 'terdekat');
  if (opsi) opsi.text = "Sekitar Anda (Radius 10 km)";

  applyIntersectionFilter();
}

function updateNavigationUI(fragment) {
  let navStandar = document.getElementById('nav-standar');
  let navDetail = document.getElementById('nav-detail');
  
  if (!navStandar || !navDetail) return;

  // =======================================================
  // KUNCI PERBAIKAN A: SAPU JAGAT SUBMENU
  // =======================================================
  let subMenuAtas = document.getElementById('submenu-atas');
  let btnMenuInduk = document.getElementById('btn-menu-induk');
  
  // Catatan: Jika kamu pakai animasi CSS .tampil yang kita bahas sebelumnya, 
  // ganti baris di bawah ini menjadi subMenuAtas.classList.remove('tampil');
  if (subMenuAtas) subMenuAtas.style.display = 'none'; 
  
  if (btnMenuInduk && btnMenuInduk.parentElement) {
      btnMenuInduk.parentElement.classList.remove('selected', 'active');
  }

  let isDetailView = (fragment !== '' && fragment !== 'hasil' && fragment !== 'about' && fragment !== 'tutorial' && fragment !== 'medsos' && PrimaryDataIsLoaded && (fragment in Records));

  if (isDetailView) {
    navStandar.style.display = 'none';
    navDetail.style.display = 'flex';
    
    let btnPrev = document.getElementById('btn-prev');
    let btnNext = document.getElementById('btn-next');
    let currentIndex = currentFilteredRecords.findIndex(r => r === Records[fragment]);
    
    if (currentIndex === -1) {
       let btnAll = document.getElementById('btn-all');
       if (btnAll) btnAll.click();
       currentIndex = currentFilteredRecords.findIndex(r => r === Records[fragment]);
    }
    
    let totalItems = currentFilteredRecords.length;
    if (totalItems > 1 && currentIndex !== -1) {
      let prevIndex = (currentIndex === 0) ? (totalItems - 1) : (currentIndex - 1);
      let nextIndex = (currentIndex === totalItems - 1) ? 0 : (currentIndex + 1);

      btnPrev.href = '#' + currentFilteredRecords[prevIndex].id;
      btnPrev.style.opacity = '1';
      btnPrev.style.pointerEvents = 'auto';

      btnNext.href = '#' + currentFilteredRecords[nextIndex].id;
      btnNext.style.opacity = '1';
      btnNext.style.pointerEvents = 'auto';
    } else {
      btnPrev.removeAttribute('href');
      btnPrev.style.opacity = '0.1';
      btnPrev.style.pointerEvents = 'none';

      btnNext.removeAttribute('href');
      btnNext.style.opacity = '0.1';
      btnNext.style.pointerEvents = 'none';
    }

  } else {
    navStandar.style.display = 'flex';
    navDetail.style.display = 'none';
  }

  // =======================================================
  // KUNCI PERBAIKAN B: ATUR LAMPU NAVIGASI DINAMIS
  // =======================================================
  
  document.querySelectorAll('#nav-standar > li, #nav-detail > li').forEach(li => {
    li.classList.remove('selected', 'active');
  });

  document.querySelectorAll('#nav-standar > li, #nav-detail > li').forEach(li => {
    let link = li.querySelector('a'); 
    if (!link) return;
    let hrefVal = link.getAttribute('href');
    let linkId = link.getAttribute('id');
    
    // 1. Lampu Beranda menyala jika fragment kosong
    if ((fragment === '' || fragment === 'landing') && hrefVal === '#') {
      li.classList.add('selected');
    } 
    // 2. Lampu Hasil menyala
    else if (fragment === 'hasil' && hrefVal === '#hasil') {
      li.classList.add('selected');
    } 
    // 3. Lampu "Lainnya" menyala jika kita sedang membuka Tentang, Tutorial, atau Medsos
    else if ((fragment === 'about' || fragment === 'tutorial' || fragment === 'medsos') && linkId === 'btn-menu-induk') {
      li.classList.add('selected');
    }
  });
}

// =========================================================
// FUNGSI PEMBANTU: Menarik & Merapikan Metadata Gambar
// =========================================================
function tarikMetadataCaption(filename, targetId, targetNode = null) {
  let url = new URL(COMMONS_API_URL);
  let params = {
    action: 'query', format: 'json', prop: 'imageinfo',
    iiprop: 'extmetadata', titles: 'File:' + decodeURIComponent(filename), origin: '*'
  };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  // Gunakan sinyal Abort hanya untuk tarikan pertama (bukan saat memperbaiki yang nyangkut)
  let fetchOptions = {};
  if (!targetNode && typeof globalFetchController !== 'undefined') {
    fetchOptions.signal = globalFetchController.signal;
  }

  fetch(url, fetchOptions)
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
      let pages = data.query.pages;
      let page = Object.values(pages)[0];
      
      // Deteksi elemen target (Bisa lewat ID, bisa lewat Node langsung)
      let targetCaption = targetNode || document.getElementById(targetId);
      if (!targetCaption) return;

      if (page.imageinfo && page.imageinfo[0].extmetadata) {
        let metadata = page.imageinfo[0].extmetadata;
        
        let artistHtml = metadata.Artist ? metadata.Artist.value.trim().replace(/<(?!\/?a ?)[^>]+>/g, '').replace(/Unknown authorUnknown author|UnknownUnknown/gi, 'Tak diketahui').replace(/AnonymousUnknown author/gi, 'Anonim') : '';
        if (artistHtml.includes('href="//')) artistHtml = artistHtml.replace(/href="(?:https?:)?\/\//g, 'href="https://');
        artistHtml = artistHtml.replace(/<a /gi, '<a target="_blank" ');

        let licenseHtml = '';
        if (metadata.AttributionRequired && metadata.AttributionRequired.value === 'true') {
          licenseHtml = metadata.LicenseShortName.value.replace(/ /g, ' ').replace(/-/g, '‑');
          licenseHtml = metadata.LicenseUrl ? ` <a href="${metadata.LicenseUrl.value}" target="_blank">[${licenseHtml}]</a>` : ` [${licenseHtml}]`;
        }
        
        targetCaption.innerHTML = artistHtml + licenseHtml;
      } else {
        targetCaption.innerHTML = 'Data lisensi tidak tersedia.';
      }
    })
    .catch(error => {
      if (error.name === 'AbortError') return;
      let targetCaption = targetNode || document.getElementById(targetId);
      if (targetCaption) targetCaption.innerHTML = 'Data gagal dimuat.';
    });
}

// ============================================================
// PINTASAN KEYBOARD (Navigasi Kiri & Kanan) - ANTI DOM THRASHING
// ============================================================
// Variabel penjaga agar sistem tahu tombol sedang ditahan
let isArrowLeftHeld = false;
let isArrowRightHeld = false;

// 1. SAAT TOMBOL DITEKAN (Hanya untuk efek visual)
window.addEventListener('keydown', function(e) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  // +++ KUNCI PENCEGAHAN LIGHTBOX +++
  // Jika lightbox sedang terbuka, matikan fungsi panah keyboard!
  let lightbox = document.getElementById('eph-lightbox');
  if (lightbox && lightbox.classList.contains('aktif')) return;

  if (e.key === 'ArrowLeft') {
    if (isArrowLeftHeld) return; 
    isArrowLeftHeld = true;
    
    let btnPrev = document.getElementById('btn-prev');
    if (btnPrev && btnPrev.hasAttribute('href') && btnPrev.style.pointerEvents !== 'none') {
      btnPrev.classList.add('active'); 
    }
  } 
  else if (e.key === 'ArrowRight') {
    if (isArrowRightHeld) return; 
    isArrowRightHeld = true;
    
    let btnNext = document.getElementById('btn-next');
    if (btnNext && btnNext.hasAttribute('href') && btnNext.style.pointerEvents !== 'none') {
      btnNext.classList.add('active'); 
    }
  }
});

// 2. SAAT TOMBOL DILEPASKAN (Baru eksekusi perpindahan data)
window.addEventListener('keyup', function(e) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  // +++ KUNCI PENCEGAHAN LIGHTBOX +++
  let lightbox = document.getElementById('eph-lightbox');
  if (lightbox && lightbox.classList.contains('aktif')) return;

  if (e.key === 'ArrowLeft') {
    isArrowLeftHeld = false; 
    
    let btnPrev = document.getElementById('btn-prev');
    if (btnPrev && btnPrev.hasAttribute('href') && btnPrev.style.pointerEvents !== 'none') {
      btnPrev.classList.remove('active'); 
      window.location.hash = btnPrev.getAttribute('href'); 
    }
  } 
  else if (e.key === 'ArrowRight') {
    isArrowRightHeld = false; 
    
    let btnNext = document.getElementById('btn-next');
    if (btnNext && btnNext.hasAttribute('href') && btnNext.style.pointerEvents !== 'none') {
      btnNext.classList.remove('active'); 
      window.location.hash = btnNext.getAttribute('href'); 
    }
  }
});

// =======================================================
// SISTEM LIGHTBOX UNTUK GAMBAR (DENGAN DUKUNGAN TOMBOL BACK)
// =======================================================
window.addEventListener('load', function() {
  // 1. Suntikkan HTML Lightbox ke dalam Body secara otomatis
  let lightboxHtml = `
    <div id="eph-lightbox">
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-content">
        <a id="lightbox-link" href="#" target="_blank">
          <img id="lightbox-img" src="" alt="Gambar Diperbesar">
        </a>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', lightboxHtml);

  let lightbox = document.getElementById('eph-lightbox');
  let backdrop = lightbox.querySelector('.lightbox-backdrop');
  let imgElem = document.getElementById('lightbox-img');
  let linkElem = document.getElementById('lightbox-link');

  // 2. Tangkap klik pada SEMUA gambar di panel dan popup peta
  document.addEventListener('click', function(e) {
    let targetImg = e.target.closest('#details figure img, .leaflet-popup-content img');
    
    if (targetImg) {
      e.preventDefault(); 

      let srcGambar = targetImg.src;
      let linkKeCommons = '';
      let parentLink = targetImg.closest('a');
      
      if (parentLink) {
        linkKeCommons = parentLink.href;
      } else {
        let namaFileRaw = srcGambar.split('Special:FilePath/')[1];
        if (namaFileRaw) {
          let namaFileBersih = namaFileRaw.split('?')[0]; 
          linkKeCommons = 'https://commons.wikimedia.org/wiki/File:' + namaFileBersih;
        }
      }

      if (srcGambar.includes('?width=')) {
        srcGambar = srcGambar.replace(/\?width=\d+/, '?width=500');
      }

      imgElem.src = srcGambar;
      linkElem.href = linkKeCommons || '#'; 
      lightbox.classList.add('aktif');

      // +++ KUNCI PERBAIKAN TOMBOL BACK +++
      // Tinggalkan jejak riwayat palsu agar saat tombol Back ditekan, halaman tidak berpindah
      window.history.pushState({ dalamLightbox: true }, null, window.location.href);
    }
  });

  // 3. Tutup Lightbox saat area menghitam diklik manual
  backdrop.addEventListener('click', function() {
    lightbox.classList.remove('aktif');
    
    // Jika ditutup manual, kita harus hapus jejak palsu tadi agar tombol Back tidak ngadat
    if (window.history.state && window.history.state.dalamLightbox) {
      window.history.back();
    }

    setTimeout(() => { 
      if (!lightbox.classList.contains('aktif')) imgElem.src = ''; 
    }, 300);
  });

  // 4. TANGKAP TOMBOL "BACK" DARI HP ATAU BROWSER
  window.addEventListener('popstate', function(e) {
    if (lightbox.classList.contains('aktif')) {
      // Jika Lightbox sedang aktif dan tombol Back ditekan, tutup Lightbox-nya!
      lightbox.classList.remove('aktif');
      
      setTimeout(() => { 
        if (!lightbox.classList.contains('aktif')) imgElem.src = ''; 
      }, 300);
    }
  });
});
