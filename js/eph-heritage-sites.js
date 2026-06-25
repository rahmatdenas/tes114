'use strict';

const CHUNK_SIZE = 35;
var currentRenderIndex = 0;
var currentFilteredRecords = [];
var isFilterEventAttached = false; 

// Fungsi pembelah array menjadi potongan kecil (Batching)
function potongJadiKelompok(array, ukuran) {
  let hasilPotongan = [];
  for (let i = 0; i < array.length; i += ukuran) {
    hasilPotongan.push(array.slice(i, i + ukuran));
  }
  return hasilPotongan;
}

function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;  
  let cleanStr = dateString.replace(/^[+-]/, '');   
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  let prec = parseInt(precision) || 9; 
  if (prec === 11) {
    return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 10) {
    return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 9) {
    return yearStr;
  } 
  else if (prec === 8) {
    return `${yearStr}-an`;
  } 
  else if (prec === 7) {
    let century = Math.ceil(yearNum / 100);
    return `abad ke-${century}`;
  } 
  else {
    return yearStr;
  }
}

function loadPrimaryData() {
  doPreProcessing();

  populateProvinceTypesData() 
    .then(() => {
      return populateCoordinatesData().then(populateMapAndIndex);
    })
    .then(() => {
      enableApp(); 
      populateImageAndWikipediaData()
        .then(() => {
          // === PERBAIKAN 1: HAPUS 'true' DI SINI ===
          applyIntersectionFilter(); // Peta akan otomatis menyesuaikan posisi (zoom)
          Object.values(Records).forEach(r => r.panelElem = undefined);          
          processHashChange();
        })
        .catch(error => {
          if (error === 'ABORTED') return;
          
          console.warn("Gagal mengambil data Gambar/Wikipedia dari server.", error);
          // === PERBAIKAN 2: HAPUS 'true' DI SINI JUGA ===
          applyIntersectionFilter(); // Tetap lakukan zoom meskipun gambar gagal dimuat                
          Object.values(Records).forEach(r => r.panelElem = undefined);
          processHashChange();
        });
    })
    .catch(error => {
       if (error === 'ABORTED') {
         console.log("Pencarian dibatalkan secara paksa. Kembali ke Beranda.");
         return;
       }

       console.error("Data utama gagal dimuat. Cek koneksi atau server Wikidata.", error);
       alert("Maaf, server database sedang sibuk. Coba lagi nanti.");
       
       if (typeof resetApp === 'function') resetApp();
       
       window.location.hash = ''; 
       setTimeout(function() {
         window.location.hash = 'landing';
         if (typeof window.setMobilePanelExpanded === 'function') {
           window.setMobilePanelExpanded(true);
         }
       }, 50);
    });
}

function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

// === LETAKKAN DI BAGIAN ATAS JS BERSAMA VARIABEL LAIN ===
var currentKategoriUtama = 'general'; 

// === UBAH FUNGSI DETEKTIF MENJADI SEPERTI INI ===
function tentukanKategoriKueri(inputTxt) {
  if (inputTxt.includes('Q11032') || inputTxt.includes('Q41298')) return 'pers';
  if (inputTxt.includes('Q3199141') || inputTxt.includes('Q3191695')) return 'wilayah';
  
  // Daftar Q-ID Entitas Alam & Peristiwa
  const kelompokAlam = ['Q179049', 'Q8502', 'Q35509', 'Q23442', 'Q34038', 'Q23397', 'Q204324', 'Q159954', 'Q7944'];
  let isAlam = kelompokAlam.some(qid => inputTxt.includes(qid));
  if (isAlam) return 'alam';
  
  return 'general';
}

function populateProvinceTypesData() {
  let inputTxt = document.getElementById('jenis-input').value.trim();
  let provInput = document.getElementById('provinsi-input').value;
  
  // 1. Tentukan kategori dan simpan di ingatan global
  currentKategoriUtama = tentukanKategoriKueri(inputTxt);
  
  // 2. Ambil kueri dari Kamus. Jika 'alam', pinjam kueri 'general' (karena butuh P131+ juga)
  let namaKueri = (currentKategoriUtama === 'alam') ? 'general' : currentKategoriUtama;
  let baseQuery = KUMPULAN_KUERI_0[namaKueri];
  
  // 3. Suntikkan Dropdown Wilayah
  let wilayahClause = '';
  if (provInput === 'all') {
    wilayahClause = '{ SELECT ?provinsi WHERE { ?provinsi wdt:P31 wd:Q5098 . } }';
  } else {
wilayahClause = `{ SELECT ?provinsi WHERE { ?provinsi wdt:P131 ${provInput} . } }`;
  }
  
  // 4. Rakit kueri final
  let dynamicQuery = baseQuery
    .replace('<PLACEHOLDER_WILAYAH>', wilayahClause)
    .replace('<PLACEHOLDER_JENIS>', inputTxt);

  return queryWdqsThenProcess(
    dynamicQuery,
    function(result) {
      let qid = result.siteQid.value;
      if (!(qid in Records)) Records[qid] = new Record(false);
      let record = Records[qid];

      record.title = ('siteLabel' in result && result.siteLabel.value) ? result.siteLabel.value : '[ERROR: No title]';

      let provQid = result.provinsiQid ? result.provinsiQid.value : 'Q_UNKNOWN';
      let provLabel = result.provinsiLabel ? result.provinsiLabel.value : 'Wilayah Tidak Tercatat';

      if (!(provQid in ProvinceIndex)) {
        ProvinceIndex[provQid] = new ProvinceIndexEntry();
        ProvinceIndex[provQid].name = provLabel; 
      }
      if (!(provQid in record.designations)) record.designations[provQid] = provLabel; 
      
      record.areaTags.add(provQid);
      
      if ('p131LokasiLabel' in result && result.p131LokasiLabel.value) record.lokasiSpesifik = result.p131LokasiLabel.value;
      if ('p131Image' in result && result.p131Image.value) record.lokasiImage = extractImageFilename(result.p131Image);
      
      if (!record.tahunBerdiri && result.tahunBerdiriMentah && result.tahunBerdiriMentah.value) {
        let precision = result.tahunPresisi ? result.tahunPresisi.value : 9;
        record.tahunBerdiri = formatWikidataDate(result.tahunBerdiriMentah.value, precision);        
        record.rawTahunBerdiri = result.tahunBerdiriMentah.value.replace(/^[+-]/, '');
      }
    },
    function() {
      populateProvinceIndex(); 
      Object.values(Records).forEach(record => { record.indexTitle = record.title });
    },
  );
}

function populateCoordinatesData() {
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return Promise.resolve();

  let inputTxt = document.getElementById('jenis-input').value.trim();
  
  // 1. Tentukan kategori
  let kategori = tentukanKategoriKueri(inputTxt);
  
  // === OBAT PETA MATI: Pinjam kueri general jika ini entitas alam ===
  let namaKueri = (kategori === 'alam') ? 'general' : kategori;
  
  // 2. Ambil kueri koordinat dari Kamus
  let templateKueri = KUMPULAN_KUERI_1[namaKueri];

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);

  let daftarJanji = kelompokCicilan.map(cicilan => {
    let teksQids = cicilan.join(' ');
    let kueriFinal = templateKueri.replace('<PLACEHOLDER_QIDS>', teksQids);

    return queryWdqsThenProcess(
      kueriFinal,
      function(result) {
        let record = Records[result.siteQid.value];
        if (!record) return; 

        let wktBits = result.coord.value.split(/\(|\)| /);
        record.lat = parseFloat(wktBits[2]);
        record.lon = parseFloat(wktBits[1]);
      }
    );
  });

  return Promise.all(daftarJanji).then(function() {
    BootstrapDataIsLoaded = true;
  });
}

function populateImageAndWikipediaData() {
  // 1. Ambil semua kunci QID
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return Promise.resolve();

  // 2. Belah array QID menjadi kelompok berisi maksimal 1000 data
  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);

  // 3. Tembak kueri secara paralel
  let daftarJanji = kelompokCicilan.map(cicilan => {
    let teksQids = cicilan.join(' ');
    let kueriFinal = SPARQL_QUERY_3_TEMPLATE.replace('<PLACEHOLDER_QIDS>', teksQids);

    return queryWdqsThenProcess(
      kueriFinal,
      // === INI ADALAH CALLBACK LAMA ANDA YANG DIMASUKKAN KE SINI ===
      function(result) {
        let record = Records[result.siteQid.value];      
        if (!record) return; 

        if ('image' in result) {
          if (!record.imageFilename) {
            record.imageFilename = extractImageFilename(result.image);
          }
        }      
        if ('wikipediaUrlTitle' in result) {
          record.articleTitle = decodeURIComponent(result.wikipediaUrlTitle.value);
        }
      }
    );
  });

  // 4. Kembalikan janji agar JS tahu kapan semua gambar selesai ditarik
  return Promise.all(daftarJanji);
}

function populateImportantEventsData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery4(qid);

  record.events = []; 

  const ALLOWED_EVENTS = [
    'konstruksi', 
    'dibuka untuk umum', 
    'upacara pembukaan', 
    'renovasi', 
    'pembangunan kembali'
  ];

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('eventLabel' in result && result.eventLabel.value) {
        let labelKecil = result.eventLabel.value.toLowerCase();
        
        if (ALLOWED_EVENTS.includes(labelKecil)) {
          let rawDateStr = (result.pointInTime ? result.pointInTime.value : null) || 
                           (result.startTime ? result.startTime.value : null) || 
                           (result.endTime ? result.endTime.value : null);
          let extractYear = rawDateStr ? parseInt(rawDateStr.match(/([+-]?\d{4,})/)[0]) : 9999;

          let eventObj = { label: result.eventLabel.value, time: '', sortYear: extractYear };
          
          let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
          let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
          let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

          if (pt) {
            eventObj.time = pt;
          } else if (st && et) {
            eventObj.time = `${st}–${et}`;
          } else if (st) {
            eventObj.time = `${st} (dimulai)`; 
          } else if (et) {
            eventObj.time = `${et} (diselesaikan)`; 
          }

          let isDuplicate = record.events.some(e => e.label === eventObj.label && e.time === eventObj.time);
          if (!isDuplicate) record.events.push(eventObj);
        }
      }
    },
    function() {
      populateStatusAndCapacityData(qid); 
    }
  );
}

function populateStatusAndCapacityData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery6(qid); 

  record.kondisi = null;
  record.kapasitas = null;

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('kondisiLabel' in result && result.kondisiLabel.value) {
        record.kondisi = result.kondisiLabel.value;
      }
      if ('kapasitas' in result && result.kapasitas.value) {
        record.kapasitas = result.kapasitas.value;
      }
    },
    function() {
      renderDynamicDataInPanel(qid); 
    }
  );
}

function renderDynamicDataInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#events-container-${qid}`);
  if (!container) return; 

  let html = '';
  let wikiBaseUrl = `https://www.wikidata.org/wiki/${qid}`;

  if (record.events && record.events.length > 0) {
    const EVENT_ORDER = {
      'konstruksi': 1, 'dibuka untuk umum': 2,
      'upacara pembukaan': 3, 'renovasi': 4,
      'pembangunan kembali': 5
    };

    record.events.sort((a, b) => {
      if (a.sortYear !== b.sortYear) {
        return a.sortYear - b.sortYear;
      }
      let orderA = EVENT_ORDER[a.label.toLowerCase()] || 99;
      let orderB = EVENT_ORDER[b.label.toLowerCase()] || 99;
      return orderA - orderB;
    });

    record.events.forEach(ev => {
      let capLabel = ev.label.charAt(0).toUpperCase() + ev.label.slice(1);
      let timeText = ev.time ? ev.time : ''; 
      html += `<p>${capLabel}: ${timeText}</p>`;
    });
  }

  if (record.kondisi) {
    let kondisiKecil = record.kondisi.toLowerCase();
    html += `<p>Kondisi: ${kondisiKecil}</p>`;
  }

  if (record.kapasitas) {
    let formatAngka = parseInt(record.kapasitas).toLocaleString('id-ID');
    html += `<p>Kapasitas: ${formatAngka} jemaah</p>`;
  }

  let tautanTambah = `<p><a href="${wikiBaseUrl}" target="_blank" class="sunting-linktambah" title="Tambahkan data di Wikidata" style="font-style: italic;">Lengkapi data di Wikidata!</a></p>`;
  html += tautanTambah;

  container.insertAdjacentHTML('beforebegin', html);
  container.remove();
}

function populateProvinceIndex() {
  if (!ProvinceIndex['all']) ProvinceIndex['all'] = new ProvinceIndexEntry();

  Object.values(Records).forEach(record => {
    ProvinceIndex['all'].total++;
    Object.keys(record.designations).forEach(provQid => {
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].total++;
      }
    });
  });
}

function populateMapAndIndex() {
  let listIndex = document.getElementById('index-list');
  let mapMarkers = [];
  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];
    if (!record.isCompound && record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: L.ExtraMarkers.icon({ icon: '', markerColor : 'orange-dark' }) },
      );
      record.mapMarker = mapMarker;
      mapMarker.bindPopup(record.title, { closeButton: false });
      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
      mapMarkers.push(mapMarker);
    }
    let li = document.createElement('li');
    li.innerHTML = `<a href="#${qid}">${record.indexTitle}</a>`;
    record.indexLi = li;
  });
  populateProvinceIndexNodes(); 
  generateFilterSelect();
}

function populateProvinceIndexNodes() {
  Object.values(Records).forEach(record => {
    if (record.mapMarker) ProvinceIndex['all'].mapMarkers.push(record.mapMarker);
    ProvinceIndex['all'].indexLis.push(record.indexLi);
    
    Object.keys(record.designations).forEach(provQid => {
      if (record.mapMarker && ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].mapMarkers.push(record.mapMarker);
      }
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].indexLis.push(record.indexLi);
      }
    });
  });
  
  Object.values(ProvinceIndex).forEach(indexItem => {
    indexItem.indexLis = indexItem.indexLis
      .map(li => [li, li.textContent])
      .sort((a, b) => a[1] > b[1] ? 1 : -1)
      .map(item => item[0]);
  });
}

var currentRegionFilter = 'all';
var currentUsiaFilter = 'all';
var activeFeatures = new Set(); 
var currentSearchQuery = '';

function generateFilterSelect() {
  currentRegionFilter = 'all';
  currentUsiaFilter = 'all';
  activeFeatures.clear();
  currentSearchQuery = '';

  let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    selectKombinasi.value = 'default';
    
    // === PINDAHKAN LOGIKA SEMBUNYI/MUNCUL KE SINI ===
    // Di titik ini, aplikasi sudah 100% tahu ini entitas Alam atau Bangunan
    if (currentKategoriUtama === 'alam' || currentKategoriUtama === 'wilayah') {
      selectKombinasi.style.display = 'none';
    } else {
      selectKombinasi.style.display = ''; // Munculkan kembali
    }
  }

  let searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  let btnAll = document.getElementById('btn-all');
  if (btnAll) btnAll.classList.add('active');
  document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

  let selectRegion = document.getElementById('filter-region');

  selectRegion.innerHTML = `<option value="all">Semua Wilayah – ${ProvinceIndex['all'].total}</option>`;
  
  Object.keys(ProvinceIndex)
    .filter(qid => qid !== 'all')
    .map(qid => { return { qid: qid, name: ProvinceIndex[qid].name, total: ProvinceIndex[qid].total }; })
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(prov => {
      let option = document.createElement('option');
      option.value = prov.qid;
      option.textContent = `${prov.name} – ${prov.total}`;
      selectRegion.appendChild(option);
    });

  applyIntersectionFilter();
  
  if (!isFilterEventAttached) {
    
    selectRegion.addEventListener('change', function() {
      currentRegionFilter = this.value;
      applyIntersectionFilter();
    });

    if (selectKombinasi) {
      selectKombinasi.addEventListener('change', function() {
        let pilihan = this.value;
        currentUsiaFilter = 'all'; 

        if (pilihan === 'filter-usia-50') {
          currentUsiaFilter = 'usia_50'; 
        } else if (pilihan === 'filter-usia-100') {
          currentUsiaFilter = 'usia_100'; 
        } else if (pilihan === 'filter-usia-200') {
          currentUsiaFilter = 'usia_200'; 
        } else if (pilihan === 'filter-usia-300') {
          currentUsiaFilter = 'usia_300'; 
        }
        applyIntersectionFilter();
      });
    }

    if (btnAll) {
      btnAll.addEventListener('click', function() {
        activeFeatures.clear();
        btnAll.classList.add('active');
        document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

        currentRegionFilter = 'all';
        if (selectRegion) selectRegion.value = 'all';

        currentUsiaFilter = 'all';
        if (selectKombinasi) selectKombinasi.value = 'default';

        currentSearchQuery = '';
        if (searchInput) searchInput.value = '';

        applyIntersectionFilter();
      });
    }

    document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(btn => {
      btn.addEventListener('click', function() {
        let filterType = this.getAttribute('data-filter');

        if (activeFeatures.has(filterType)) {
          activeFeatures.delete(filterType);
          this.classList.remove('active');
        } else {
          activeFeatures.add(filterType);
          this.classList.add('active');
        }

        if (activeFeatures.size === 0) {
          if (btnAll) btnAll.classList.add('active');
        } else {
          if (btnAll) btnAll.classList.remove('active');
        }

        applyIntersectionFilter();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        currentSearchQuery = this.value.toLowerCase();
        applyIntersectionFilter(); 
      });
    }

    isFilterEventAttached = true; 
  }
}

function updateFeatureCounts(totalValidRecords) {
  let btnAll = document.getElementById('btn-all');
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  
  if (btnImg) btnImg.textContent = 'Memiliki Gambar';
  if (btnArt) btnArt.textContent = 'Memiliki Artikel';

  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = `Menampilkan ${totalValidRecords} hasil (atau ketik yang ingin dicari)`;
  }
}

function applyIntersectionFilter(preventZoom = false) {
  // === PASANG GEMBOKNYA DI SINI SAYANGKU ===
  if (!PrimaryDataIsLoaded) return;

  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  ol.innerHTML = '';

  let validMarkers = [];
  
  let btnAll = document.getElementById('btn-all');
  if (btnAll) {
    if (currentSearchQuery.trim() === '' && 
        currentRegionFilter === 'all' && 
        currentUsiaFilter === 'all' && 
        activeFeatures.size === 0) {
      btnAll.classList.add('active');
      btnAll.textContent = 'Semua Hasil'; 
    } else {
      btnAll.classList.remove('active');
      btnAll.textContent = 'Reset'; 
    }
  }

  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = (currentRegionFilter === 'all' || record.areaTags.has(currentRegionFilter));
    let matchFeature = true;
    
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }

    let matchSearch = true;
    if (currentSearchQuery.trim() !== '') {
      let cleanQuery = currentSearchQuery.replace(/[-'\s]/g, '');
      if (record.indexTitle) {
        let cleanTitle = record.indexTitle.toLowerCase().replace(/[-'\s]/g, '');
        matchSearch = cleanTitle.includes(cleanQuery);
      } else {
        matchSearch = false;
      }
    }

    let matchUsia = true;
    if (currentUsiaFilter.startsWith('usia_')) {
      if (record.rawTahunBerdiri) {
        let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
        let batasUmur = parseInt(currentUsiaFilter.split('_')[1]); 
        let batasTahun = new Date().getFullYear() - batasUmur;
        
        matchUsia = tahunBangunan <= batasTahun;
      } else {
        matchUsia = false; 
      }
    }
    
    return matchRegion && matchFeature && matchSearch && matchUsia;

  }).sort((a, b) => {
    if (currentUsiaFilter.startsWith('usia_')) {
      let aHasYear = !!a.rawTahunBerdiri;
      let bHasYear = !!b.rawTahunBerdiri;

      if (aHasYear && bHasYear) {
        return a.rawTahunBerdiri.localeCompare(b.rawTahunBerdiri);
      } else if (aHasYear && !bHasYear) {
        return -1; 
      } else if (!aHasYear && bHasYear) {
        return 1;  
      }
    }
    return a.indexTitle.localeCompare(b.indexTitle);    
  });

currentFilteredRecords = validRecords;
  currentRenderIndex = 0; 

  // 1. Gambar daftar list-nya dulu (Muncul Instan)
  renderNextChunk();
  
  // 2. Update jumlah hasil di kolom pencarian
  updateFeatureCounts(validRecords.length);

  // 3. Masukkan pekerjaan berat (Peta) ke "jalur lambat" (Jeda 10ms)
  // agar browser sempat memunculkan daftar ke layar pengguna
  setTimeout(() => {
    validRecords.forEach(record => {
      if (record.mapMarker) validMarkers.push(record.mapMarker);
    });

    if (validMarkers.length > 0) {
      Cluster.addLayers(validMarkers);
      if (!preventZoom) {
        Map.fitBounds(Cluster.getBounds());
      }
    }
  }, 10);
}

function activateSite(qid) {
  displayRecordDetails(qid); 
  
  populateImportantEventsData(qid);
  populateHistoricalImagesData(qid);

  let record = Records[qid];
  if (record.isCompound) {
    // Kosongkan
  }
  else if (record.mapMarker) {
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      },
    );
  }
}

function generateRecordDetails(qid) {
  let record = Records[qid];
  let titleHtml = `<h1>${record.title}</h1>`;
  let figureHtml = generateFigure(record.imageFilename, record.title);

  if (record.imageFilename) {
    figureHtml = figureHtml.replace('<figure class="', '<figure class="gambar-utama ');
  }

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  } else {
    let namaAmanURL = encodeURIComponent(record.title);
    let gFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLSeHMSn6cwcgbZ0xx1CJ5tGXDQacYgzRZUG51STByKUROWXgmg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    articleHtml = `<div class="article main-text nodata"><p>Entitas ini belum memiliki artikel. <a href="${gFormUrl}" target="_blank" rel="noopener noreferrer" class="sunting-linktambah">Tambahkan!</a></p></div>`;
  }
  
  let wikiUrlUtama = `https://www.wikidata.org/wiki/${qid}`;
  let tautanSuntingRingkasan = `<a href="${wikiUrlUtama}" target="_blank" class="sunting-link" title="Sunting data di Wikidata" aria-label="Sunting data di Wikidata"></a>`;

  // === PERBAIKAN: LOGIKA JUDUL YANG LEBIH RAPI DAN BERSIH ===
  let teksJudul = 'Informasi';
  if (currentKategoriUtama === 'alam') {
    teksJudul = 'Informasi Geografis';
  } else if (currentKategoriUtama === 'pers') {
    teksJudul = 'Informasi Publikasi';
  } else {
    let isBersejarah = false;
    if (record.rawTahunBerdiri) {
      let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
      if (tahunBangunan <= (new Date().getFullYear() - 50)) isBersejarah = true;
    }
    teksJudul = isBersejarah ? 'Situs Bersejarah' : 'Informasi Bangunan';
  }

  let designationsHtml = `<h2 style="margin-top:10px">${teksJudul} ${tautanSuntingRingkasan}</h2>`;
  designationsHtml += '<ul class="designations">';

  // === PERBAIKAN: MENGEMBALIKAN VARIABEL YANG HILANG ===
  let isFirstDesignation = true; 

  Object.keys(record.designations).forEach(provQid => {
    let namaProvinsi = record.designations[provQid];
    let infoTahunHtml = '';
    
    // HANYA cetak "Didirikan" jika BUKAN alam dan BUKAN wilayah
    if (currentKategoriUtama !== 'alam' && currentKategoriUtama !== 'wilayah') {
      if (record.tahunBerdiri) {
        infoTahunHtml = `<p>Didirikan: ${record.tahunBerdiri}</p>`;
      } else {
        infoTahunHtml = `<p>Didirikan: <span style="font-style: italic; color: #888;">Data belum tersedia</span></p>`;
      }
    }

    let induk = namaProvinsi; 
    let spesifik = record.lokasiSpesifik; 
    let namaLokasi = induk; 

    if (spesifik && spesifik.toLowerCase() !== induk.toLowerCase()) {
      namaLokasi = `${spesifik}, ${induk}`; 
    }

    let infoLokasiHtml = '';

    if (record.lat && record.lon) {
      let mapsUrl = `https://www.google.com/maps?q=${record.lat},${record.lon}`;
      infoLokasiHtml = `<p class="koordinat-link">Terletak di <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" title="Buka di Google Maps">${namaLokasi}</a></p>`;
    } else {
      infoLokasiHtml = `<p class="koordinat-link">Terletak di: ${namaLokasi}</p>`;
    }
    
    let eventsHtmlPlaceholder = '';
    if (isFirstDesignation) {
      eventsHtmlPlaceholder = `
        <div id="events-container-${qid}" class="loading" style="margin-top: 8px; min-height: 24px;">
          <div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
        </div>`;
      isFirstDesignation = false;
    }

    designationsHtml +=
      '<li>' +
        infoLokasiHtml + 
        infoTahunHtml +
        eventsHtmlPlaceholder + 
      '</li>';
        
  });
    
  designationsHtml += '</ul>';

  let arsipHtml = `<div id="arsip-container-${qid}" class="loading"><div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div></div>`;

  let panelElem = document.createElement('div');
  
  panelElem.innerHTML =
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" target="_blank" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml +
    figureHtml + 
    articleHtml +
    designationsHtml + 
    arsipHtml;

  record.panelElem = panelElem;

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));
  queryOsm(qid);
}

function populateHistoricalImagesData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery5(qid); 

  record.vicinityImages = [];
  record.pastImage = undefined;

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('vicinityImage' in result) {
        let filename = extractImageFilename(result.vicinityImage);
        let captionText = result.vicinityCaption ? result.vicinityCaption.value : '';
        
        let isDuplicate = record.vicinityImages.some(img => img.file === filename);
        if (!isDuplicate) {
          record.vicinityImages.push({ file: filename, caption: captionText });
        }
      }
      
      if ('pastImage' in result) {
        if (!record.pastImage) { 
          let filename = extractImageFilename(result.pastImage);
          let captionText = result.pastCaption ? result.pastCaption.value : '';
          record.pastImage = { file: filename, caption: captionText };
        }
      }
    },
    function() {
      renderHistoricalImagesInPanel(qid);
    }
  );
}

function renderHistoricalImagesInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#arsip-container-${qid}`);
  if (!container) return; 

  let html = '';
  
  function buildImageBlock(imgObj) {
    let block = '<div class="arsip-block" style="overflow: hidden;">';
    block += generateFigure(imgObj.file);
    if (imgObj.caption && imgObj.caption.trim() !== '') {
      block += `<div class="article main-text"><p>${imgObj.caption}</p></div>`;
    } else {
      block += `<div class="article main-text nodata"><p>Belum ada keterangan foto di Wikidata.</p></div>`;
    }
    block += '</div>';
    return block;
  }

  if (record.pastImage) {
    html += buildImageBlock(record.pastImage);
  }
  
  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgObj => {
      html += buildImageBlock(imgObj);
    });
  }

  if (html !== '') {
    let wikiUrlGaleri = `https://www.wikidata.org/wiki/${qid}#P18`;
    let tautanSuntingGaleri = `<a href="${wikiUrlGaleri}" target="_blank" class="sunting-link" title="Sunting data galeri di Wikidata" aria-label="Sunting data galeri di Wikidata"></a>`;
    container.innerHTML = `<h2 style="margin-bottom:15px;">Galeri ${tautanSuntingGaleri}</h2>` + html;
    container.classList.remove('loading');
  } else {
    container.innerHTML = '';
    container.classList.remove('loading');
    container.style.display = 'none';
  }
}

function displayArticleExtract(title, elem) {
  loadJsonp(
    'https://id.wikipedia.org/w/api.php',
    {
      action    : 'query',
      format    : 'json',
      prop      : 'extracts',
      exintro   : 1,
      redirects : true,
      titles    : title,
    },
    function(data) {
      elem.innerHTML =
        Object.values(data.query.pages)[0].extract.match(/<p[^]+?<\/p>/g).find(text => text.length > 50) +
        '<p class="wikipedia-link">' +
          `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
            '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
            '<span>Baca selengkapnya di Wikipedia</span>' +
          '</a>' +
        '</p>';
      elem.classList.remove('loading');
    }
  );
}

function renderNextChunk() {
  let ol = document.getElementById('index-list');
  if (!ol) return;

  let nextBatch = currentFilteredRecords.slice(currentRenderIndex, currentRenderIndex + CHUNK_SIZE);  
  if (nextBatch.length === 0) return;
  
  let fragment = document.createDocumentFragment();

  nextBatch.forEach(record => {
    if (record.indexLi) {
      record.indexLi.style.display = '';
      fragment.appendChild(record.indexLi);
    }
  });

  ol.appendChild(fragment);
  currentRenderIndex += CHUNK_SIZE; 
}

let scrollContainer = document.getElementById('index-container'); 

if (scrollContainer) {
  scrollContainer.addEventListener('scroll', function() {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 10) {
      renderNextChunk(); 
    }
  });
}

function queryOsm(qid) {
  let xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== xhr.DONE) return;
    if (xhr.status === 200) {
      let geoJson = osmtogeojson(JSON.parse(xhr.responseText));
      if (!geoJson || geoJson.features.length === 0) return;
      let shapeLayer = L.geoJSON(
        geoJson,
        {
          style: {
            color   : '#ff3333',
            opacity : 0.7,
            fill    : true,
          },
          filter: feature => feature.geometry.type !== 'Point',
        },
      );
      Records[qid].shapeLayer = shapeLayer;
      shapeLayer.addTo(Map);

      if (window.location.hash.replace('#', '') === qid) {
        Map.fitBounds(shapeLayer.getBounds());
      }
    }
    else {
      console.log('ERROR loading from Overpass API', xhr);
    }
  };
  xhr.open(
    'GET',
    'https://overpass-api.de/api/interpreter?data=' +
    encodeURIComponent(
`[out:json][timeout:25];
(
  way      ["wikidata"="${qid}"];
  relation ["wikidata"="${qid}"];
);
out body;
>;
out skel qt;`
    ),
    true,
  );
  xhr.send();
}

class ProvinceIndexEntry {
  constructor() {
    this.name       = '';
    this.total      = 0;
    this.mapMarkers = [];
    this.indexLis   = [];
  }
}

class Record {
  constructor(isCompound) {
    this.isCompound = isCompound;
    this.title = undefined;
    this.imageFilename = '';
    this.articleTitle = undefined;
    this.designations = {}; 
    this.panelElem = undefined;
    this.indexLi = undefined;
    this.tahunBerdiri = undefined;
    this.rawTahunBerdiri = undefined;
    this.events = [];
    this.areaTags = new Set();
    this.vicinityImages = [];
  }
}

class SimpleRecord extends Record {
  constructor() {
    super(false);
    this.lat        = undefined;
    this.lon        = undefined;
    this.mapMarker  = undefined;
    this.popup      = undefined;
    this.shapeLayer = undefined;
  }
}

class CompoundRecord extends Record {
  constructor() {
    super(true);
    this.parts = []; 
  }
}
