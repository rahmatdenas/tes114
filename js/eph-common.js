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
var activeXhrs            = [];
var currentActiveShapeLayer = null;
var currentDisplayedQid = null;
var lastValidHash   = 'landing';
var isRevertingHash = false;
var loadingTimeoutToken = null;
var searchDebounceToken = null;


window.addEventListener('load', init);

function init() {
  initMap();
  setupLandingForm();
  window.addEventListener('hashchange', processHashChange);
  
Map.on('popupopen', function(e) { 
  e.popup._sudahDiupdate = false;
    let qid = e.popup._qid;
    let record = Records[qid];
    displayRecordDetails(qid);
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
  
  // Langsung proses status hash saat web dibuka tanpa memaksa tambah #landing
  processHashChange();
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
        loadingDesc.innerHTML = `Data yang ditarik mencapai ribuan.<br/>Estimasi proses penarikan data 3-5 menit...`;
      }
    }, 5000); // Set 5000 (5 detik)
    // =========================================================

    loadPrimaryData();
  });
}

function resetApp() {
  currentSearchToken = 0;

  if (loadingTimeoutToken) {
    clearTimeout(loadingTimeoutToken);
    loadingTimeoutToken = null;
  }
  
  // 1. Bunuh Koneksi yang Sedang Berjalan
  if (activeXhrs.length > 0) {
    let xhrToAbort = [...activeXhrs]; 
    activeXhrs = []; 
    xhrToAbort.forEach(xhr => {
      xhr.isAbortedManually = true; 
      xhr.abort();
    });
  }

  // =========================================================
  // +++ TAMBAHKAN DI SINI: BUNUH FETCH API (GAMBAR & ARTIKEL)
  // =========================================================
  if (typeof globalFetchController !== 'undefined') {
    globalFetchController.abort(); // Tarik pelatuk untuk mematikan fetch background
    globalFetchController = new AbortController(); // Beri nyawa baru untuk pencarian berikutnya
  }
  // =========================================================

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
L.control.locate({ 
    position: 'bottomright', 
    showCompass: false, 
    strings: { title: "Tunjukkan lokasi saya" },
    icon: 'ikon-gps-custom' // Kita perintahkan untuk memanggil kelas CSS ini
  }).addTo(Map);

  let powered = L.control({ position: 'bottomleft' });
  powered.onAdd = function(Map) {
    var divElem = L.DomUtil.create('div', 'powered');
    divElem.innerHTML = '<a><img src="img/powered_by_wikidata.png"></a>';
    return divElem;
  };
  powered.addTo(Map);

Cluster = new L.markerClusterGroup({
  maxClusterRadius: function(zoom) {
    let z = Math.round(zoom);        
    if (z <= 15) return 50;
    if (z === 16) return 35;
    if (z === 17) return 20;
    // Biarkan zoom 18 dan seterusnya punya radius minimal (jangan 0)
    return 10; 
  },
  // MATIKAN KENDALI OTOMATIS BAWAAN
  zoomToBoundsOnClick: false, 
  spiderfyOnMaxZoom: false
}).addTo(Map);

  // KENDALIKAN MANUAL KLIK PADA KLASTER
  Cluster.on('clusterclick', function (a) {
    let cluster = a.layer;
    let count = cluster.getChildCount();
    
    // Cek apakah batas ujung titik sama persis (menandakan koordinat bertumpuk sempurna)
    let bounds = cluster.getBounds();
    let isSamePoint = bounds.getSouthWest().equals(bounds.getNorthEast());
    
    let currentZoom = Map.getZoom();
    let maxZoom = TILE_LAYER_MAX_ZOOM; 
    
    // Skenario 1: Jika sudah di zoom maksimal ATAU titiknya benar-benar bertumpuk
    if (currentZoom >= maxZoom || isSamePoint) {
      if (count > 60) {
setTimeout(() => {
          alert(`Terlalu banyak data di titik ini (${count} item). Untuk melihat, buka daftar dan pilih wilayah terkait.`);
        }, 50); 
      } else {
        // Jika masih di bawah 60, izinkan mekar (spiderfy)
        cluster.spiderfy();
      }
    } else {
      // Normal: Peta belum mentok, izinkan zoom mendekat
      Map.fitBounds(cluster.getBounds());
    }
  });
}

function queryWdqsThenProcess(query, processEachResult, postprocessCallback) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    
    activeXhrs.push(xhr);

    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;

      let index = activeXhrs.indexOf(xhr);
      if (index > -1) activeXhrs.splice(index, 1);

      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else if (xhr.status === 0) {
        // Cek apakah ini sengaja dibatalkan
        if (xhr.isAbortedManually) {
          reject('ABORTED');
        } else {
          // Jika tidak ada tanda sengaja, berarti ini murni masalah jaringan!
          reject('NETWORK_ERROR'); 
        }
      } else {
        reject(xhr.status);
      }
    };
    
    xhr.open('POST', WDQS_API_URL, true);
    
    // --- KUNCI PERBAIKAN CORS ---
    // 1. Matikan overrideMimeType karena memicu Preflight CORS
    // 2. Matikan Api-User-Agent khusus (WDQS Blazegraph sering menolak ini dari browser)
    // 3. Cukup gunakan header standar agar menjadi "CORS Simple Request"
    
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

function fetchWdqsRaw(query) {
  return new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    activeXhrs.push(xhr);

    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;

      let idx = activeXhrs.indexOf(xhr);
      if (idx > -1) activeXhrs.splice(idx, 1);

      if (xhr.status === 200) {
        try {
          let data = JSON.parse(xhr.responseText);
          resolve(data.results.bindings);
        } catch (e) {
          reject('PARSE_ERROR');
        }
      } else if (xhr.status === 0) {
        reject(xhr.isAbortedManually ? 'ABORTED' : 'NETWORK_ERROR');
      } else {
        reject(xhr.status); // termasuk 502
      }
    };

    xhr.open('POST', WDQS_API_URL, true);
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Accept', 'application/sparql-results+json');

    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });
}

async function fetchWdqsRawWithRetry(query, maxRetry = 3) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      // =========================================================
      // +++ PERBAIKAN UX: LAPORKAN SEBELUM MENCOBA ULANG +++
      // =========================================================
      if (attempt > 1) {
        let progressText = document.querySelector('#index-list p');
        if (progressText) {
          // Kembalikan ke teks aslinya khusus untuk percobaan ulang
          progressText.innerHTML = `Sedang melakukan percobaan ulang (${attempt}/${maxRetry})...`;
        }
      }

      return await fetchWdqsRaw(query);

    } catch (error) {
      if (error === 'ABORTED') throw error; 
      
      console.warn(`Percobaan ${attempt}/${maxRetry} gagal (${error}), mencoba lagi...`);
      
      // Mengubah teks loading menjadi pesan error sementara
      let progressText = document.querySelector('#index-list p');
      if (progressText) {
        progressText.innerHTML = `<span style="color:#cc0000; font-weight:bold;">Percobaan ${attempt}/${maxRetry} gagal. Melakukan penarikan ulang.</span>`;
      }

      if (attempt === maxRetry) throw error;
      
      // Jeda sebelum percobaan berikutnya
      await new Promise(r => setTimeout(r, 1500 * attempt)); 
    }
  }
}

// FUNGSI BARU #3: Loop LIMIT/OFFSET, PAKAI JUMLAH ENTITAS UNIK (?SQ) sebagai penanda halaman terakhir
// (bukan jumlah baris mentah — karena satu entitas bisa punya >1 baris akibat OPTIONAL tanggal ganda)
async function queryWdqsPaginated(queryTemplate, processEachResult, postprocessCallback, chunkSize = 5000) {
  let offset = 0;
  let halaman = 1;
  let totalDataTerkumpul = 0; 

  while (true) {
    let pagedQuery = queryTemplate.replace(
      '<PLACEHOLDER_LIMIT_OFFSET>',
      `LIMIT ${chunkSize} OFFSET ${offset}`
    );

    let progressText = document.querySelector('#index-list p');
    if (progressText && progressText.innerHTML.includes('gagal')) {
      progressText.innerHTML = `Melanjutkan penarikan data...`;
    }

    let bindings = await fetchWdqsRawWithRetry(pagedQuery);
    
    // =========================================================
    // +++ JINAKKAN BOM WAKTU (Karena data sudah mulai masuk) +++
    // =========================================================
    if (halaman === 1 && loadingTimeoutToken) {
      clearTimeout(loadingTimeoutToken);
      loadingTimeoutToken = null;
    }
    
    bindings.forEach(processEachResult);

    let kombinasiUnik = new Set(
      bindings.map(b => `${b.SQ.value}|${b.PQ ? b.PQ.value : ''}|${b.LQ ? b.LQ.value : ''}`)
    ).size;

    // Tambahkan data halaman ini ke total keseluruhan
    totalDataTerkumpul += kombinasiUnik;
    
    console.log(`[Halaman ${halaman}] Kombinasi (s,p,l) unik:`, kombinasiUnik);

    // Cek apakah ini halaman terakhir atau bukan untuk menentukan teks yang pas
    if (kombinasiUnik < chunkSize) {
       // Loop akan berhenti, ubah pesan ke status final
       if (progressText) {
         progressText.textContent = `Total ${totalDataTerkumpul} data ditarik. Data segera ditampilkan...`;
       }
       break; 
    } else {
       // Masih ada halaman berikutnya
       if (progressText) {
         progressText.textContent = `Selesai menarik ${totalDataTerkumpul} data. Penarikan data masih berlangsung...`;
       }
    }

    offset += chunkSize;
    halaman++;
  }

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
    
    // Jeda 50ms memberikan waktu bagi browser (terutama Safari) untuk menyelesaikan 
    // antrean animasi UI sebelum dibekukan oleh kotak dialog confirm()
    setTimeout(() => {
      let yakin = confirm("Kembali ke beranda dapat membersihkan data yang sedang/sudah dimuat dan Anda harus menarik data lagi. Anda yakin?");
      
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
    }, 50);
    
    return; // Hentikan eksekusi fungsi di sini! Jangan teruskan ke bawah.
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
              <a href="#" style="background-color: #882222; color: #fff; 
              padding: 10px 20px; text-decoration: none; border-radius: 5px; 
              font-weight: 800; display: inline-block;">Pilih Data</a>
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

  // +++ ANTI-KEDIP +++
  // Kalau popup marker ini sudah terbuka (misalnya baru saja dibuka lewat
  // klik marker itu sendiri, lalu memicu hashchange balik ke sini),
  // tidak perlu tutup lalu buka lagi.
  if (record.popup && record.popup.isOpen()) {
    return;
  }

  try {
    Map.closePopup();
    Map.stop();

    let countSameLocation = 0;
    currentFilteredRecords.forEach(r => {
      if (r.lat === record.lat && r.lon === record.lon) {
        countSameLocation++;
      }
    });

    if (countSameLocation > 60) {
      Map.setView([record.lat, record.lon], TILE_LAYER_MAX_ZOOM);
      setTimeout(() => {
        let visibleParent = Cluster.getVisibleParent(record.mapMarker);
        if (visibleParent && visibleParent._icon) {
          visibleParent._icon.classList.add('cluster-efek-denyut');
          setTimeout(() => {
            if (visibleParent._icon) visibleParent._icon.classList.remove('cluster-efek-denyut');
          }, 4500);
        }
      }, 350);
    } else {
      // Pastikan marker ada di dalam klaster sebelum disuruh mekar
      if (Cluster.hasLayer(record.mapMarker)) {
        Cluster.zoomToShowLayer(
          record.mapMarker,
          function() {
            if (!record.popup.isOpen()) record.mapMarker.openPopup();
          }
        );
      } else {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      }
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
    detailsElem.replaceChild(record.panelElem, detailsElem.childNodes[0]);

    let stuckImages = record.panelElem.querySelectorAll('img.loading');
    stuckImages.forEach(img => {
      // Jika gambar belum tuntas dimuat ATAU gagal dimuat (lebar aslinya 0)
      if (!img.complete || img.naturalWidth === 0) {
        let currentSrc = img.src;
        img.src = ''; // Kosongkan src sejenak
        img.src = currentSrc; // Isi kembali untuk memaksa browser mengulang request HTTP
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
    
    // Siapkan Parameter URL (Tambahkan origin=*)
    let url = new URL(COMMONS_API_URL);
    let params = {
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      titles: 'File:' + filename,
      origin: '*' // Kunci penting untuk Fetch API ke Wikipedia
    };
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    // =========================================================
    // 1. TAMBAHKAN SIGNAL KE DALAM FETCH
    // =========================================================
    fetch(url, { signal: globalFetchController.signal })
      .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
      })
      .then(data => {
        let pages = data.query.pages;
        let page = Object.values(pages)[0];
        
        // Mencegah error jika gambar di Commons sudah dihapus/hilang
        if (page.imageinfo && page.imageinfo[0].extmetadata) {
          let metadata = page.imageinfo[0].extmetadata;
          
          let artistHtml = '';
          if (metadata.Artist) {
              artistHtml = metadata.Artist.value.trim();
              artistHtml = artistHtml.replace(/<(?!\/?a ?)[^>]+>/g, '');
              artistHtml = artistHtml.replace(/Unknown authorUnknown author/gi, 'Tak diketahui');
              artistHtml = artistHtml.replace(/UnknownUnknown/gi, 'Tak diketahui');
              artistHtml = artistHtml.replace(/AnonymousUnknown author/gi, 'Anonim');
              if (artistHtml.search('href="//') >= 0) {
                artistHtml = artistHtml.replace(/href="(?:https?:)?\/\//g, 'href="https://');
              }
              artistHtml = artistHtml.replace(/<a /gi, '<a target="_blank" ');
          }
          
          let licenseHtml = '';
          if (metadata.AttributionRequired && metadata.AttributionRequired.value === 'true') {
            licenseHtml = metadata.LicenseShortName.value.replace(/ /g, ' ');
            licenseHtml = licenseHtml.replace(/-/g, '‑');
            licenseHtml = `[${licenseHtml}]`;
            if (metadata.LicenseUrl) {
              licenseHtml = `<a href="${metadata.LicenseUrl.value}" target="_blank">${licenseHtml}</a>`;
            }
            licenseHtml = ' ' + licenseHtml;
          }
          
          let targetCaption = document.getElementById(uniqueId);
          if (targetCaption) {
              targetCaption.innerHTML = artistHtml + licenseHtml;
          }
        } else {
          // Jika metadata kosong
          let targetCaption = document.getElementById(uniqueId);
          if (targetCaption) targetCaption.innerHTML = 'Data lisensi tidak tersedia.';
        }
      })
      .catch(error => {
        // =========================================================
        // 2. CEGAT ERROR JIKA DIBATALKAN OLEH RESET APP
        // =========================================================
        if (error.name === 'AbortError') {
          // Jika sengaja dibunuh, diamkan saja. Jangan ubah HTML atau cetak error.
          return;
        }

        // Jika error murni (jaringan putus dsb), jalankan kode asli Anda
        console.error('Gagal memuat metadata gambar:', error);
        let targetCaption = document.getElementById(uniqueId);
        if (targetCaption) targetCaption.innerHTML = 'Data gagal dimuat.';
      });

    // Output HTML tetap sama seperti sebelumnya
    let encodedFilename = encodeURIComponent(filename);
    return (
      `<figure class="${classNames.join(' ')}">` +
        `<a href="${COMMONS_WIKI_URL_PREF}File:${encodedFilename}" target="_blank">` +
          `<img class="loading" src="${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodedFilename}?width=500" alt="" onload="this.className=''">` +
        '</a>' +
        `<figcaption id="${uniqueId}">(Memuat…)</figcaption>` +
      '</figure>'
    );
  } else {
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

function updateNavigationUI(fragment) {
  let navStandar = document.getElementById('nav-standar');
  let navDetail = document.getElementById('nav-detail');
  
  if (!navStandar || !navDetail) return;

  // Deteksi apakah yang sedang dibuka adalah Detail Butir yang valid
  let isDetailView = (fragment !== '' && fragment !== 'hasil' && fragment !== 'about' && PrimaryDataIsLoaded && (fragment in Records));

  if (isDetailView) {
    navStandar.style.display = 'none';
    navDetail.style.display = 'flex';
    
    let btnPrev = document.getElementById('btn-prev');
    let btnNext = document.getElementById('btn-next');
    
    let currentIndex = currentFilteredRecords.findIndex(r => r === Records[fragment]);
    
    // KUNCI PERBAIKAN: Jika dipanggil dari URL tapi tersembunyi oleh filter, reset filternya!
if (currentIndex === -1) {
       let btnAll = document.getElementById('btn-all');
       if (btnAll) btnAll.click();
       currentIndex = currentFilteredRecords.findIndex(r => r === Records[fragment]);
    }
    
    // ========================================================
    // LOGIKA BARU: TOMBOL LOOPING (KORSEL)
    // ========================================================
    let totalItems = currentFilteredRecords.length;

    // Tombol hanya hidup jika jumlah data lebih dari 1
    if (totalItems > 1 && currentIndex !== -1) {
      // 1. Tentukan indeks berputar
      let prevIndex = (currentIndex === 0) ? (totalItems - 1) : (currentIndex - 1);
      let nextIndex = (currentIndex === totalItems - 1) ? 0 : (currentIndex + 1);

      // 2. Ambil Q-ID masing-masing
      let prevQid = currentFilteredRecords[prevIndex].id;
      let nextQid = currentFilteredRecords[nextIndex].id;

      // 3. Nyalakan dan pasang tautan tombol '<<'
      btnPrev.href = '#' + prevQid;
      btnPrev.style.opacity = '1';
      btnPrev.style.pointerEvents = 'auto';

      // 4. Nyalakan dan pasang tautan tombol '>>'
      btnNext.href = '#' + nextQid;
      btnNext.style.opacity = '1';
      btnNext.style.pointerEvents = 'auto';
      
    } else {
      // Matikan kedua tombol HANYA JIKA hasil filter cuma ada 1 data (tidak bisa ke mana-mana)
      btnPrev.removeAttribute('href');
      btnPrev.style.opacity = '0.3';
      btnPrev.style.pointerEvents = 'none';

      btnNext.removeAttribute('href');
      btnNext.style.opacity = '0.3';
      btnNext.style.pointerEvents = 'none';
    }

  } else {
    // KEMBALI KE MODE STANDAR (Beranda | Hasil | Tentang)
    navStandar.style.display = 'flex';
    navDetail.style.display = 'none';
    
    // Manajemen indikator 'aktif' (opsional jika ada kelas CSS .selected)
    navStandar.querySelectorAll('li').forEach(li => {
      let link = li.querySelector('a');
      if (!link) return;
      let hrefVal = link.getAttribute('href');
      
      // Cocokkan href dengan URL saat ini
      if ((fragment === '' && hrefVal === '#') ||
          (fragment === 'hasil' && hrefVal === '#hasil') ||
          (fragment === 'about' && hrefVal === '#about')) {
        li.classList.add('selected');
      } else {
        li.classList.remove('selected');
      }
    });
  }
}

// ============================================================
// PINTASAN KEYBOARD (Navigasi Kiri & Kanan)
// ============================================================
window.addEventListener('keydown', function(e) {
  // 1. Abaikan ketikan jika pengguna sedang mengetik di dalam kotak pencarian atau form
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    return;
  }

  // 2. Jika tombol Panah Kiri ditekan
  if (e.key === 'ArrowLeft') {
    let btnPrev = document.getElementById('btn-prev');
    // Pastikan tombol "Sebelumnya" ada, aktif (punya href), dan tidak sedang dimatikan
    if (btnPrev && btnPrev.hasAttribute('href') && btnPrev.style.pointerEvents !== 'none') {
      window.location.hash = btnPrev.getAttribute('href');
    }
  } 
  
  // 3. Jika tombol Panah Kanan ditekan
  else if (e.key === 'ArrowRight') {
    let btnNext = document.getElementById('btn-next');
    // Pastikan tombol "Selanjutnya" ada dan aktif
    if (btnNext && btnNext.hasAttribute('href') && btnNext.style.pointerEvents !== 'none') {
      window.location.hash = btnNext.getAttribute('href');
    }
  }
});
