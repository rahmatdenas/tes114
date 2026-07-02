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

// === PENANDA STATUS BARU ===
var isAppInitialLoad      = true; // Tambahkan ini!
var isFetching            = false; // Menandai apakah satpam sedang mencari data
var activeXhrs            = [];

window.addEventListener('load', init);

function init() {
  initMap();
  setupLandingForm();
  window.addEventListener('hashchange', processHashChange);
  Map.on('popupopen', function(e) { displayRecordDetails(e.popup._qid) });
  
  // Langsung eksekusi ke landing tanpa delay 50ms
  if (window.location.hash === '' || window.location.hash === '#') {
    window.location.hash = 'landing';
  } else {
    // Jalankan jika pengunjung masuk lewat link spesifik (contoh: domain.com/#Q123)
    processHashChange();
  }
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
    window.location.hash = '';
    
    // Langsung buka Daftar, jangan buka layar Loading lama!
    loadPrimaryData();
  });
}

function resetApp() {
  // 1. Bunuh Koneksi yang Sedang Berjalan
if (activeXhrs.length > 0) {
    activeXhrs.forEach(xhr => {
      xhr.isAbortedManually = true; // TANDAI: Ini pembatalan sengaja!
      xhr.abort();
    });
    activeXhrs = []; 
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
    selectKombinasi.value = 'default'; // Cukup reset nilainya saja di sini
  }
  
  // C. Bersihkan Kotak Pencarian dan Angka Hasil
  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = 'Belum ada hasil...'; // Teks netral
  }

  // D. Matikan semua tombol filter (Gambar/Artikel), dan nyalakan tombol "Semua Hasil"
  let btnAll = document.getElementById('btn-all');
  if (btnAll) {
    btnAll.classList.add('active');
    btnAll.textContent = 'Semua Hasil';
  }
  document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => {
    b.classList.remove('active');
  });

  // E. Kembalikan teks asli pada tombol (jika sebelumnya ada angka jumlahnya)
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  if (btnImg) btnImg.textContent = 'Memiliki Gambar';
  if (btnArt) btnArt.textContent = 'Memiliki Artikel';

  // F. Reset memori variabel filter di JS 3 agar tidak menyisakan status
  if (typeof activeFeatures !== 'undefined' && activeFeatures.clear) activeFeatures.clear();
  if (typeof currentRegionFilter !== 'undefined') currentRegionFilter = 'all';
  if (typeof currentUsiaFilter !== 'undefined') currentUsiaFilter = 'all';
  if (typeof currentSearchQuery !== 'undefined') currentSearchQuery = '';
}

function initMap() {
  // 1. Matikan atribusi bawaan agar bisa kita pindahkan
  Map = new L.map('map', { zoomControl: false, attributionControl: false });
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
    maxClusterRadius: function(z) {
      if (z <=  15) return 50;
      if (z === 16) return 40;
      if (z === 17) return 30;
      if (z === 18) return 20;
      if (z >=  19) return 10;
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
    xhr.overrideMimeType('text/plain');
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Api-User-Agent', 'WikiSurau/1.0 (mailto:rahmatdenas@gmail.com)');
    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });

  promise = promise.then(data => {
    data.results.bindings.forEach(processEachResult);
  });
  if (postprocessCallback) promise = promise.then(postprocessCallback);
  return promise;
}

function enableApp() {
  PrimaryDataIsLoaded = true;
  isFetching = false; // Tarikan selesai!
  processHashChange();
}

function processHashChange() {
  let fragment = window.location.hash.replace('#', '');

  if (typeof window.setMobilePanelExpanded === 'function') {
    // Pakai animasi (true) KECUALI saat muatan awal aplikasi (false)
    window.setMobilePanelExpanded(true, !isAppInitialLoad);
    isAppInitialLoad = false; // Matikan penanda setelah lewat satu kali
  }

  if (fragment === 'landing') {
    resetApp(); 
    document.title = 'Mulai Eksplorasi – ' + BASE_TITLE;
    displayPanelContent('landing');
  }
  else if (fragment === 'about') {
    document.title = 'About – ' + BASE_TITLE;
    displayPanelContent('about');
  }
  else if (fragment === 'kontrib') {
    document.title = 'Jadi Kontributor – ' + BASE_TITLE;
    displayPanelContent('kontrib'); 
  }
  else {
    // === KUNCI PERBAIKAN TUNTAS ===
    // Tangkap baik hash kosong ('') maupun 'index' sebagai Halaman Daftar
    let isIndexPage = (fragment === '' || fragment === 'index');

    if (!PrimaryDataIsLoaded) {
      if (isIndexPage) {
        document.title = 'Daftar – ' + BASE_TITLE;
        displayPanelContent('index');

        let indexList = document.getElementById('index-list');          
        if (indexList && !isFetching) {
          indexList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
              <h3 style="margin-bottom: 10px; margin-top:0; color: #333;">Data Belum Ditarik</h3>
              <p style="color: #666; font-size:14px; margin-bottom: 25px;">
              Anda belum melakukan pencarian. Silakan kembali ke halaman Beranda untuk memilih entitas yang ingin dieksplorasi.</p>
              <a href="#landing" style="background-color: #882222; color: #fff; 
              padding: 10px 20px; text-decoration: none; border-radius: 5px; 
              font-weight: 800; display: inline-block;">Pilih Data</a>
            </div>
          `;
        }
      } else {
        // Lempar ke Landing HANYA jika yang diketik benar-benar link spesifik (contoh: #Q123)
        window.location.hash = 'landing';
      }
    } 
    else {
      // Normal: Data sudah ditarik
      if (isIndexPage || !(fragment in Records)) {
        window.location.hash = '';  
        document.title = BASE_TITLE;
        displayPanelContent('index');
      }
      else {
        activateMapMarker(fragment);
        displayRecordDetails(fragment);
      }
    }
  }
}

function activateMapMarker(qid) {
  let record = Records[qid];
  if (!record.mapMarker) return; 

  // Hitung berapa banyak entitas yang berbagi koordinat persis dengan item ini
  let countSameLocation = 0;
currentFilteredRecords.forEach(r => {
    if (r.lat === record.lat && r.lon === record.lon) {
      countSameLocation++;
    }
  });

  // Skenario 2: Buka dari daftar, koordinat bertumpuk > 60
  if (countSameLocation > 60) {
    // 1. Arahkan kamera peta ke lokasi tersebut
    Map.setView([record.lat, record.lon], TILE_LAYER_MAX_ZOOM);

    // 2. Beri jeda sedikit agar peta selesai merender geseran kamera
    setTimeout(() => {
      // Cari elemen gelembung klaster yang menampung titik marker ini
      let visibleParent = Cluster.getVisibleParent(record.mapMarker);
      
      // Pastikan klasternya ditemukan di layar dan memiliki elemen HTML (ikon)
      if (visibleParent && visibleParent._icon) {
        
        // Suntikkan kelas CSS animasi denyut
        visibleParent._icon.classList.add('cluster-efek-denyut');
        
        // Bersihkan (hapus) kelas CSS tersebut setelah 4.5 detik (3x detak denyut)
        setTimeout(() => {
          if (visibleParent._icon) {
            visibleParent._icon.classList.remove('cluster-efek-denyut');
          }
        }, 4500);
      }
    }, 350); // Jeda 350 milidetik sebelum animasi dimulai

  } else {
    // Skenario Normal: Jumlah aman, biarkan sistem mengurai klaster dan membuka popup
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      }
    );
  }
}

function displayPanelContent(id) {
  document.querySelectorAll('.panel-content').forEach(content => {
    content.style.display = (content.id === id) ? content.dataset.display : 'none';
  });
  document.querySelectorAll('nav li').forEach(li => {
    if (li.childNodes[0].getAttribute('href') === '#' + id) {
      li.classList.add('selected');
    }
    else {
      li.classList.remove('selected');
    }
  });
}

function displayRecordDetails(qid) {
  let record = Records[qid];
  window.location.hash = `#${qid}`;
  document.title = `${record.indexTitle} – ${BASE_TITLE}`;
  
  if (PrimaryDataIsLoaded) {
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

    // Eksekusi Fetch API
    fetch(url)
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
