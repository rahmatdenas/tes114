'use strict';

// =========================================================
// VARIABEL GLOBAL FILTER & RENDERING
// =========================================================
const CHUNK_SIZE = 35; // Mempertahankan settingan asli Anda
var currentRenderIndex = 0;
var currentFilteredRecords = [];
var isFilterEventAttached = false; 

// --- Tambahan Variabel yang Sempat Hilang ---
var currentRegionFilter = 'all';
var currentUsiaFilter = 'default';
var currentSearchQuery = ''; // <-- Ini yang menyelesaikan eror barusan
var activeFeatures = new Set();
var userLocation = null;
var userRadiusCircle = null;

// Fungsi pembelah array menjadi potongan kecil (Batching)
function potongJadiKelompok(array, ukuran) {
  let hasilPotongan = [];
  for (let i = 0; i < array.length; i += ukuran) {
    hasilPotongan.push(array.slice(i, i + ukuran));
  }
  return hasilPotongan;
}

// Format Tahun (Mengatasi Tahun Sebelum Masehi / Padding)
function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;  
  let isBCE = dateString.startsWith('-');
  let cleanStr = dateString.replace(/^[+-]/, '');   
  
  // Tangkap tahun secara aman (bisa 1 digit sampai 4+ digit)
  let yearStr  = cleanStr.split('-')[0];
  let monthStr = cleanStr.substring(yearStr.length + 1, yearStr.length + 3);
  let dayStr   = cleanStr.substring(yearStr.length + 4, yearStr.length + 6);
  let yearNum  = parseInt(yearStr);
  
  if (isBCE) {
    yearStr = `${yearNum} SM`;
    yearNum = -yearNum;
  }
  
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  let prec = parseInt(precision) || 9; 
  
  if (prec === 11) return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  if (prec === 10) return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  if (prec === 9)  return yearStr;
  if (prec === 8)  return `${yearStr}-an`;
  if (prec === 7)  return `abad ke-${Math.ceil(Math.abs(yearNum) / 100)}${isBCE ? ' SM' : ''}`;
  
  return yearStr;
}

function loadPrimaryData() {
  let tiketPencarianIni = currentSearchToken;
  
  doPreProcessing();

  populateProvinceTypesData() 
    .then(() => {
      if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
      if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
      
      return populateCoordinatesData().then(() => {
         if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
         if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
         populateMapAndIndex();
      });
    })
    .then(() => {
      if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
      if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
      
      enableApp(); 
      applyIntersectionFilter(); 

      let btnAll = document.getElementById('btn-all');
      if (btnAll) {
        btnAll.classList.remove('disabled'); 
        btnAll.classList.add('active');      
      }

      populateImageAndWikipediaData();
    })
    .catch(error => {
       if (error === 'ABORTED' || (error && error.name === 'AbortError')) {
         console.log("Pencarian dibatalkan atau diganti.");
         return; 
       }
       isFetching = false;
       PrimaryDataIsLoaded = false;
       let indexList = document.getElementById('index-list');
       if (indexList) {         
         indexList.innerHTML = `
           <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
             <h3 style="margin-bottom: 10px; margin-top:0; color: #cc0000;">Gagal Menarik Data</h3>
             <p style="color: #666; font-size:14px; margin-bottom: 25px;">Pastikan internet stabil atau server Wikidata sedang sibuk.</p>
             <a href="#" onclick="window.location.href = window.location.pathname; return false;" style="background-color: #7b0d0c; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: 600; display: inline-block;">Kembali</a>
           </div>`;
       }
       console.error("Data utama gagal dimuat.", error);
    }); 
}

function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

function populateProvinceTypesData() {
  let jenisDropdown = document.getElementById('jenis-dropdown');
  let inputJenisKustom = document.getElementById('jenis-input').value.trim();
  
  let dropdownTipeWilayah = document.getElementById('pilih-tipe-wilayah');
  let tipeWil = dropdownTipeWilayah ? dropdownTipeWilayah.value : '1'; 

  // Tentukan Klaster (Gunakan Data-Driven Config)
  let opsiTerpilihObjek = jenisDropdown.options[jenisDropdown.selectedIndex];
  window.currentKlasterId = (jenisDropdown.value === 'custom') ? 'default' : (opsiTerpilihObjek.getAttribute('data-id') || 'default');
  currentNamaKlaster = (jenisDropdown.value === 'custom') ? 'Objek Kustom' : opsiTerpilihObjek.text;
  
  // Ambil Config dari Kamus (Jika ada fallback ke default)
  let config = KAMUS_KLASTER[window.currentKlasterId] || KAMUS_KLASTER['default'];
  
  let propLokasi = 'P131'; // Default
  let propTahun = 'P571';  // Default
  
  // Tentukan Wilayah & Template Kueri
  let baseQuery = KUMPULAN_KUERI_0['universal'];
  let dynamicQuery = '';
  
  // ==========================================
  // OPSI 1: INDONESIA
  // ==========================================
  if (tipeWil === '1') {
    let provDropdown = document.getElementById('provinsi-input');
    let provInput = provDropdown.value;
    currentNamaWilayah = provDropdown.options[provDropdown.selectedIndex].text;
    
    let wilayahClause1 = '';
    let unionEkstra = ''; 
    let hierarkiLokasi = '?l wdt:P131* ?p .'; 
    let kurungBuka = '', kurungTutup = '';
    let filterNasional = '?s wdt:P17 wd:Q252 .';
    
    // Klaster khusus yang ada di P17 vs P407 (Publikasi) diatur di SPARQL builder jika perlu,
    // Untuk sederhana, kita asumsikan semua di Indonesia pakai Q252 (Atau sesuaikan jika perlu)

    if (provInput === 'all') {
      wilayahClause1 = '?p wdt:P31 wd:Q5098 .';
      if (inputJenisKustom.toLowerCase() !== 'apapun') {
        baseQuery = KUMPULAN_KUERI_0['khusus_negara_all'];
      }
    } else {
      wilayahClause1 = `?p wdt:P131 ${provInput}.`;
      let wilayahClause2 = `BIND(${provInput} AS ?p) BIND(${provInput} AS ?l)`; 
      kurungBuka = '{'; kurungTutup = '}';
      unionEkstra = `UNION { ${wilayahClause2} ?s wdt:P31 ?j ; wdt:${propLokasi} ?l . }`;
      
      if (inputJenisKustom.toLowerCase() === 'apapun') {
         unionEkstra = `UNION { ${wilayahClause2} ?s wdt:P17 wd:Q252 ; wdt:P625 [] ; wdt:P18 [] ; wdt:P131 ?l . }`;
      }
    }

    dynamicQuery = baseQuery
      .replace(/<PLACEHOLDER_FILTER_NASIONAL>/g, filterNasional)
      .replace(/<PLACEHOLDER_KURUNG_BUKA>/g, kurungBuka)  
      .replace(/<PLACEHOLDER_KURUNG_TUTUP>/g, kurungTutup)  
      .replace(/<PLACEHOLDER_WILAYAH_1>/g, wilayahClause1)
      .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
      .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun)
      .replace(/<PLACEHOLDER_HIERARKI_LOKASI>/g, hierarkiLokasi)
      .replace(/<PLACEHOLDER_UNION_EKSTRA>/g, unionEkstra);
  }
  // ==========================================
  // OPSI 2: LUAR NEGERI
  // ==========================================
  else if (tipeWil === '2') {
    let negaraInput = document.getElementById('negara-input');
    currentNamaWilayah = negaraInput.options[negaraInput.selectedIndex].text;
    let negaraVal = negaraInput.value;

    baseQuery = KUMPULAN_KUERI_0['luar_negeri'];
    if (inputJenisKustom.toLowerCase() === 'apapun') {
      baseQuery = KUMPULAN_KUERI_0['apapun']; 
    }
    
    dynamicQuery = baseQuery
      .replace(/<PLACEHOLDER_NEGARA>/g, negaraVal)
      .replace(/<PLACEHOLDER_NEGARA_MUTLAK>/g, negaraVal)
      .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
      .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun)
      .replace(/<PLACEHOLDER_KURUNG_BUKA>/g, '')  
      .replace(/<PLACEHOLDER_KURUNG_TUTUP>/g, '')  
      .replace(/<PLACEHOLDER_WILAYAH_1>/g, '')
      .replace(/<PLACEHOLDER_HIERARKI_LOKASI>/g, '')
      .replace(/<PLACEHOLDER_UNION_EKSTRA>/g, '');
  }
  // ==========================================
  // OPSI 3: WILAYAH KUSTOM
  // ==========================================
  else if (tipeWil === '3') {
    currentNamaWilayah = "Wilayah Kustom";
    let qidWilayahKustom = document.getElementById('wilayah-kustom-qid').value.trim(); // cth: wd:Q3191695
    let propWilayahKustom = document.getElementById('wilayah-kustom-prop').value.trim(); // cth: wdt:P131

    propLokasi = propWilayahKustom.replace('wdt:', ''); 
    baseQuery = KUMPULAN_KUERI_0['universal'];

    let wilayahClause1 = `?p wdt:P131 ${qidWilayahKustom} .`;
    let unionEkstra = `UNION { BIND(${qidWilayahKustom} AS ?p) BIND(${qidWilayahKustom} AS ?l) ?s wdt:P31 ?j ; ${propWilayahKustom} ?l . }`;
    
    dynamicQuery = baseQuery
      .replace(/<PLACEHOLDER_KURUNG_BUKA>/g, '{')  
      .replace(/<PLACEHOLDER_KURUNG_TUTUP>/g, '}')  
      .replace(/<PLACEHOLDER_WILAYAH_1>/g, wilayahClause1)
      .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
      .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun)
      .replace(/<PLACEHOLDER_HIERARKI_LOKASI>/g, `?l ${propWilayahKustom}* ?p .`)
      .replace(/<PLACEHOLDER_UNION_EKSTRA>/g, unionEkstra);
  }

  // Finalisasi Inject Jenis QID
  if (inputJenisKustom.toLowerCase() === 'apapun') {
    dynamicQuery = dynamicQuery.replace(/VALUES \?j \{ <PLACEHOLDER_JENIS> \}/g, '');
  } else {
    dynamicQuery = dynamicQuery.replace(/<PLACEHOLDER_JENIS>/g, inputJenisKustom);
  }

  // Update UI Loading
  let brandingDesc = document.getElementById('branding-desc');
  if (brandingDesc) brandingDesc.textContent = `${currentNamaKlaster} di ${currentNamaWilayah}`;

  let indexList = document.getElementById('index-list');
  if (indexList) {
    indexList.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
        <h3 id="loading-text" style="margin-bottom: 10px; margin-top:0; color: #333;">Sedang Menarik Data<br/>${currentNamaKlaster} di ${currentNamaWilayah}</h3>
        <p style="color: #666; font-size:14px; margin-bottom: 25px;">Harap menunggu sebentar...</p>
        <div class="loader" style="margin: 0 auto; width: 40px; height: 40px; border-width: 4px;"></div>
        <div id="wadah-tombol-berhenti" style="margin-top: 42px;"></div>
      </div>
    `;
  }
  
  // Eksekusi Kueri
  return queryWdqsPaginated(
    dynamicQuery,
    function(result) {
      let qid = result.SQ.value;
      if (!(qid in Records)) Records[qid] = new SimpleRecord(); 
      
      let record = Records[qid];
      record.id = qid;
      record.title = ('sLabel' in result && result.sLabel.value) ? result.sLabel.value : '[Tak Berjudul]';

      let provQid = result.PQ ? result.PQ.value : 'Q_UNKNOWN';
      let provLabel = result.pLabel ? result.pLabel.value : 'Wilayah Lainnya';

      if (!(provQid in ProvinceIndex)) {
        ProvinceIndex[provQid] = new ProvinceIndexEntry();
        ProvinceIndex[provQid].name = provLabel; 
      }
      if (!(provQid in record.designations)) record.designations[provQid] = provLabel; 
      
      record.areaTags.add(provQid);
      if ('lLabel' in result && result.lLabel.value) record.lokasiSpesifik = result.lLabel.value;
      
      if (!record.tahunBerdiri && result.tM && result.tM.value) {
        let precision = result.tP ? result.tP.value : 9;
        record.tahunBerdiri = formatWikidataDate(result.tM.value, precision);        
        record.rawTahunBerdiri = result.tM.value; 
      }
    },
    function() {
      // PRE-COMPUTING (KUNCI OPTIMASI PENCARIAN)
      Object.values(Records).forEach(record => {
        record.indexTitle = record.title;
        // Search murni
        if (record.title) {
          record.searchTitle = record.title.toLowerCase().replace(/[-'\s]/g, '');
        } else {
          record.searchTitle = '';
        }
        // Parsing Tahun Aman
        if (record.rawTahunBerdiri) {
          let cleanYear = record.rawTahunBerdiri.replace(/^[+]/, '');
          let yearMatch = cleanYear.match(/^(-?\d{1,4})/);
          record.parsedYear = yearMatch ? parseInt(yearMatch[1]) : null;
        } else {
          record.parsedYear = null;
        }
      });
      populateProvinceIndex(); 
    },
    5000 
  );
}

async function populateCoordinatesData() {
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return;

  let templateKueri = KUMPULAN_KUERI_1['universal'];
  
  // Karena sekarang data-driven, jika objek butuh perlakuan khusus koordinat,
  // bisa disesuaikan, tapi defaultnya P625 (Koordinat langsung)
  let klausaKoordinat = `?site p:P625 ?coordStatement .`;

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);
  let batchSize = 4; 
  let tiketPencarianIni = currentSearchToken;
  
  for (let i = 0; i < kelompokCicilan.length; i += batchSize) {
    if (currentSearchToken !== tiketPencarianIni) break;
    let potonganBatch = kelompokCicilan.slice(i, i + batchSize);
    
    let progressText = document.querySelector('#index-list p');
    if (progressText) {
      let persentase = Math.round((i / kelompokCicilan.length) * 100);
      progressText.innerHTML = `Menyusun koordinat... (${persentase}%)`;
    }

    let daftarJanji = potonganBatch.map(cicilan => {
      let kueriFinal = templateKueri
        .replace(/<PLACEHOLDER_QIDS>/g, cicilan.join(' '))
        .replace(/<PLACEHOLDER_KLAUSA_KOORDINAT>/g, klausaKoordinat);

      return queryWdqsThenProcess(kueriFinal, function(result) {
        let record = Records[result.siteQid.value];
        if (!record) return; 
        let wktBits = result.coord.value.split(/\(|\)| /);
        record.lat = parseFloat(wktBits[2]);
        record.lon = parseFloat(wktBits[1]);
      });
    });

    try {
      await Promise.all(daftarJanji);
    } catch (error) {
      if (error === 'ABORTED') throw error;
      console.warn("Gagal tarik sebagian koordinat, lanjut ke batch berikutnya...");
    }
  }
  BootstrapDataIsLoaded = true;
}

async function populateImageAndWikipediaData() {
  let daftarQid = Object.values(Records)
    .sort((a, b) => a.indexTitle.localeCompare(b.indexTitle))
    .map(record => 'wd:' + record.id);
  
  if (daftarQid.length === 0) return;

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  let totalData = daftarQid.length;
  let signal = typeof globalFetchController !== 'undefined' ? globalFetchController.signal : null;

  if (btnImg) btnImg.classList.remove('disabled');
  if (btnArt) btnArt.classList.remove('disabled');

  const tarikSatuKloter = async (cicilan) => {
    let kueriFinal = SPARQL_QUERY_3_TEMPLATE.replace('<PLACEHOLDER_QIDS>', cicilan.join(' '));
    return queryWdqsThenProcess(kueriFinal, function(result) {
      let rawQid = result.siteQid.value;
      let cleanQid = rawQid.includes('entity/') ? rawQid.split('entity/')[1] : rawQid;
      let record = Records[cleanQid];      
      if (!record) return; 

      if ('image' in result) record.imageFilename = extractImageFilename(result.image);
      if ('wikipediaUrlTitle' in result) {
        let rawArt = result.wikipediaUrlTitle.value;
        record.articleTitle = decodeURIComponent(rawArt.substring(rawArt.lastIndexOf('/') + 1));
      }
    }, null, signal);
  };

  try {
    let batchSize = totalData <= 20000 ? kelompokCicilan.length : 3; 
    let chunksCompleted = 0;

    for (let i = 0; i < kelompokCicilan.length; i += batchSize) {
      if (signal && signal.aborted) throw 'ABORTED'; 
      let potonganBatch = kelompokCicilan.slice(i, i + batchSize);
      let hasilKloter = await Promise.allSettled(potonganBatch.map(c => tarikSatuKloter(c)));
      
      for (let hasil of hasilKloter) {
        if (hasil.status === 'rejected' && (hasil.reason === 'ABORTED' || (hasil.reason && hasil.reason.name === 'AbortError'))) {
           throw 'ABORTED';
        }
      }

      chunksCompleted += potonganBatch.length;
      let persentase = Math.round((chunksCompleted / kelompokCicilan.length) * 100);
      
      if (totalData > 20000) {
        if (btnImg) btnImg.textContent = `Gambar (${persentase}%)`;
        if (btnArt) btnArt.textContent = `Artikel (${persentase}%)`;
      }
      
      Object.values(Records).forEach(r => {
        if (r.id !== currentDisplayedQid) r.panelElem = undefined;
      });
      if (activeFeatures.has('image') || activeFeatures.has('article')) {
        applyIntersectionFilter(true); 
      }
    }
    
    if (btnImg) btnImg.textContent = 'Memiliki Gambar';
    if (btnArt) btnArt.textContent = 'Memiliki Artikel';
    
  } catch (error) {
    if (error !== 'ABORTED') console.error("Proses penarikan gambar terhenti:", error);
  }
}

// =========================================================
// RENDER DINAMIS & PETA
// =========================================================
function populateImportantEventsData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery4(qid);
  record.events = []; 

  const ALLOWED_EVENTS = ['konstruksi', 'dibuka untuk umum', 'upacara pembukaan', 'renovasi', 'pembangunan kembali'];

  return queryWdqsThenProcess(queryStr, function(result) {
      if ('eventLabel' in result && result.eventLabel.value) {
        let labelKecil = result.eventLabel.value.toLowerCase();
        if (ALLOWED_EVENTS.includes(labelKecil)) {
          let rawDateStr = (result.pointInTime ? result.pointInTime.value : null) || 
                           (result.startTime ? result.startTime.value : null) || 
                           (result.endTime ? result.endTime.value : null);
          let extractYear = rawDateStr ? parseInt(rawDateStr.replace(/^[+]/, '').match(/(-?\d{1,4})/)[0]) : 9999;
          let eventObj = { label: result.eventLabel.value, time: '', sortYear: extractYear };
          
          let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
          let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
          let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

          if (pt) eventObj.time = pt;
          else if (st && et) eventObj.time = `${st}–${et}`;
          else if (st) eventObj.time = `${st} (dimulai)`; 
          else if (et) eventObj.time = `${et} (diselesaikan)`; 

          if (!record.events.some(e => e.label === eventObj.label && e.time === eventObj.time)) {
            record.events.push(eventObj);
          }
        }
      }
    },
    function() { populateStatusAndCapacityData(qid); }
  ).catch(error => {
    record._gagalOffline = true;
    populateStatusAndCapacityData(qid);
  });
}

function populateStatusAndCapacityData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery6(qid); 

  record.dynamicProps = {};

  return queryWdqsThenProcess(queryStr, function(result) {
      Object.keys(result).forEach(key => {
        if (key !== 'siteQid' && result[key].value) {
          record.dynamicProps[key] = result[key].value;
        }
      });
    },
    function() { renderDynamicDataInPanel(qid); }
  ).catch(error => {
    record._gagalOffline = true;
    renderDynamicDataInPanel(qid);
  });
}

function renderDynamicDataInPanel(qid) {
  // PENCEGAHAN RACE CONDITION DOM
  if (currentDisplayedQid !== qid) return; 

  let record = Records[qid];
  if (!record || !record.panelElem) return;
  let container = record.panelElem.querySelector(`#events-container-${qid}`);
  if (!container) return; 

  let html = '';
  let wikiBaseUrl = `https://www.wikidata.org/wiki/${qid}`;

  // 1. Render Events
  if (record.events && record.events.length > 0) {
    const EVENT_ORDER = { 'konstruksi': 1, 'dibuka untuk umum': 2, 'upacara pembukaan': 3, 'renovasi': 4, 'pembangunan kembali': 5 };
    record.events.sort((a, b) => {
      if (a.sortYear !== b.sortYear) return a.sortYear - b.sortYear;
      return (EVENT_ORDER[a.label.toLowerCase()] || 99) - (EVENT_ORDER[b.label.toLowerCase()] || 99);
    });
    record.events.forEach(ev => {
      let capLabel = ev.label.charAt(0).toUpperCase() + ev.label.slice(1);
      html += `<p>${capLabel}: ${ev.time ? ev.time : ''}</p>`;
    });
  }

  // 2. Label Kamus Sederhana untuk UI
  const labelKamusUI = {
    ketinggian: 'Ketinggian', luas: 'Luas', kapasitas: 'Kapasitas', kondisi: 'Kondisi', lamanResmi: 'Laman resmi', 
    fasilitasList: 'Fasilitas', arsitek: 'Arsitek', gayaList: 'Gaya arsitektur', populasi: 'Jumlah penduduk',
    kepalaDaerah: 'Kepala daerah', jalurList: 'Jalur penghubung', jumlahKoleksi: 'Jumlah koleksi', spesialisasiList: 'Spesialisasi', 
    tglTemu: 'Tanggal penemuan', tempatTemu: 'Lokasi penemuan', bahasaList: 'Bahasa', bentukList: 'Bentuk karya', 
    penulisList: 'Penulis/pencipta', subjekList: 'Subjek utama', kolektorList: 'Koleksi dari', pemredList: 'Pimpinan redaksi',
    pendiriList: 'Pendiri', penerbit: 'Penerbit', bahanList: 'Bahan utama', caraList: 'Cara pembuatan', penutur: 'Jumlah penutur', 
    tglWafat: 'Wafat', pekerjaanList: 'Pekerjaan', pegunungan: 'Bagian dari', korban: 'Korban jiwa', agamaList: 'Agama', 
    bagianDari: 'Bagian dari', berakhirPada: 'Berhenti terbit', pencipta: 'Pencipta', genreList: 'Genre',
    panjang: 'Panjang', koleksiKaryaList: 'Tempat koleksi karya disimpan', tinggi: 'Tinggi', lebar: 'Lebar', aksaraList: 'Sistem penulisan'
  };

  let urlWikibooks = null;

  if (record.dynamicProps && Object.keys(record.dynamicProps).length > 0) {
    if (record.dynamicProps.wikibooks) {
      urlWikibooks = record.dynamicProps.wikibooks;
      delete record.dynamicProps.wikibooks;
    }
    if (record.dynamicProps.tipeList) {
      let headerTextElem = record.panelElem.querySelector(`#header-text-${qid}`);
      if (headerTextElem && record.dynamicProps.tipeList.trim() !== '') {
        headerTextElem.textContent = record.dynamicProps.tipeList.split(', ').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
      }
      delete record.dynamicProps.tipeList;
    }

    for (let key in record.dynamicProps) {
      let rawValue = record.dynamicProps[key];
      let formattedValue = rawValue;
      let titleLabel = labelKamusUI[key] || key; 

      if (key === 'populasi' || key === 'penutur') {
        let [angka, tahun] = rawValue.split('|');
        let angkaRapi = parseInt(angka).toLocaleString('id-ID');
        formattedValue = tahun !== 'null' ? `${angkaRapi} jiwa (${tahun})` : `${angkaRapi} jiwa`;
      } 
      else if (key === 'kepalaDaerah') {
        let [nama, tahun, wikiUrl] = rawValue.split('|');
        let teksNama = nama;
        if (wikiUrl && wikiUrl !== 'kosong') {
          teksNama = `<span class="koordinat-link"><a href="${wikiUrl}" target="_blank" rel="noopener noreferrer">${nama}</a></span>`;
        }
        formattedValue = tahun !== 'null' ? `${teksNama} (sejak ${tahun})` : teksNama;
      }
      else if (key === 'luas') {
        let [angka, satuan, bagian] = rawValue.split('|');
        let teksLuas = satuan ? `${parseFloat(angka).toLocaleString('id-ID')} ${satuan}` : parseFloat(angka).toLocaleString('id-ID');
        formattedValue = bagian ? `${teksLuas} (untuk ${bagian})` : teksLuas;
      }
      else if (['jumlahKoleksi', 'panjang', 'tinggi', 'lebar'].includes(key)) {
        let [angka, satuan] = rawValue.split('|');
        formattedValue = satuan ? `${parseFloat(angka).toLocaleString('id-ID')} ${satuan}` : parseFloat(angka).toLocaleString('id-ID');
      }
      else if (key === 'kapasitas' || key === 'korban') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID');
      }
      else if (key === 'ketinggian') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID') + " mdpl";
      }
      else if (key === 'lamanResmi') {
        const displayUrl = rawValue.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        formattedValue = `<span class="koordinat-link"><a href="${rawValue}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">${displayUrl}</a></span>`;
      }
      else if (['tglTemu', 'tglWafat', 'berakhirPada'].includes(key)) {
        let [waktu, presisi] = rawValue.split('|');
        formattedValue = formatWikidataDate(waktu, presisi);
      }
      else if (key === 'bahanList' || key === 'caraList') {
        formattedValue = formattedValue.toLowerCase();
      }
      
      html += `<p>${titleLabel}: ${formattedValue}</p>`;
    }
  }

  html += `<p><a href="${wikiBaseUrl}" target="_blank" class="sunting-linktambah" title="Tambahkan data di Wikidata" style="font-style: italic;">Lengkapi data di Wikidata!</a></p>`;
  container.insertAdjacentHTML('beforebegin', html);
  container.remove();

  if (urlWikibooks) {
    let arsipContainer = record.panelElem.querySelector(`#arsip-container-${qid}`);
    if (arsipContainer) {
      arsipContainer.insertAdjacentHTML('beforebegin', `
        <div style="margin-top:10px;">
          <h2 style="margin-bottom: 7px;">Resep & Panduan</h2>
          <p class="wikipedia-link"><a href="${urlWikibooks}" target="_blank"><img src="img/wikibook_tiny_logo.png" alt="" /><span>Lihat di Wikibuku</span></a></p>
        </div>
      `);
    }
  }
}

function applyIntersectionFilter(preventZoom = false) {
  if (!PrimaryDataIsLoaded) return;

  Cluster.clearLayers();
  document.getElementById('index-list').innerHTML = '';

  let validMarkers = [];
  let btnAll = document.getElementById('btn-all');
  
  if (btnAll) {
    if (currentSearchQuery === '' && currentRegionFilter === 'all' && currentUsiaFilter === 'all' && activeFeatures.size === 0) {
      btnAll.classList.add('active'); btnAll.textContent = 'Semua Hasil'; 
    } else {
      btnAll.classList.remove('active'); btnAll.textContent = 'Pulihkan'; 
    }
  }

  // 1. OPTIMASI: PENCARIAN & TAHUN DILAKUKAN SEKALI (PRE-COMPUTED)
  let cleanQuery = currentSearchQuery; 
  let currentYear = new Date().getFullYear();

  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = false;
    
    if (currentRegionFilter === 'all') matchRegion = true;
    else if (currentRegionFilter === 'terdekat') {
      if (userLocation && record.lat && record.lon) {
        let jarakMeter = Map.distance([userLocation.lat, userLocation.lon], [record.lat, record.lon]);
        if (jarakMeter <= 10000) { 
          record.jarakDariUser = (jarakMeter / 1000).toFixed(1); 
          matchRegion = true;
        }
      }
    } else {
      matchRegion = record.areaTags.has(currentRegionFilter);
    }

    let matchFeature = true;
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }

    let matchSearch = true;
    if (cleanQuery !== '') {
      matchSearch = record.searchTitle.includes(cleanQuery);
    }

    let matchUsia = true;
    if (currentUsiaFilter !== 'all') {
      if (record.parsedYear !== null) {
        let [tipeFilter, umurStr] = currentUsiaFilter.split('_');
        let batasTahun = currentYear - parseInt(umurStr);
        if (tipeFilter === 'muda') matchUsia = record.parsedYear > batasTahun;
        else matchUsia = record.parsedYear <= batasTahun;
      } else {
        matchUsia = false; 
      }
    }
    
    return matchRegion && matchFeature && matchSearch && matchUsia;

  }).sort((a, b) => {
    if (currentUsiaFilter !== 'all') {
      let aHasYear = a.parsedYear !== null;
      let bHasYear = b.parsedYear !== null;
      if (aHasYear && bHasYear) return a.parsedYear - b.parsedYear; // Urut absolut number
      if (aHasYear && !bHasYear) return -1; 
      if (!aHasYear && bHasYear) return 1;  
    }
    return a.indexTitle.localeCompare(b.indexTitle);    
  });

  currentFilteredRecords = validRecords;
  currentRenderIndex = 0; 
  renderNextChunk();
  updateFeatureCounts(validRecords.length);
  
  validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
  });

  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    if (!preventZoom) Map.flyToBounds(Cluster.getBounds(), { duration: 0.5 });
  }
}

function generateFilterSelect() {
  currentRegionFilter = 'all';
  currentUsiaFilter = 'all';
  activeFeatures.clear();
  currentSearchQuery = '';

  let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    selectKombinasi.value = 'default';
    
    if (currentKategoriUtama === 'alam') {
      selectKombinasi.style.display = 'none';
    } else {
      selectKombinasi.style.display = ''; 
    }
  }
  let searchInput = document.getElementById('search-input');
  if (searchInput && !isFilterEventAttached) {
    searchInput.addEventListener('input', function() {
      currentSearchQuery = this.value.trim().toLowerCase().replace(/[-'\s]/g, '');
      if (searchDebounceToken) clearTimeout(searchDebounceToken);
      
      searchDebounceToken = setTimeout(() => {
        // Yield to Main Thread agar tidak freeze
        requestAnimationFrame(() => applyIntersectionFilter());
      }, 350);
    });
  }
  isFilterEventAttached = true;
}

// Generate UI Peta
function generateRecordDetails(qid) {
  let record = Records[qid];
  let titleHtml = `<h1>${record.title}</h1>`;
  let figureHtml = generateFigure(record.imageFilename, record.title);
  if (record.imageFilename) figureHtml = figureHtml.replace('<figure class="', '<figure class="gambar-utama ');

  let articleHtml;
  if (record.articleTitle) articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  else {
    let namaAmanURL = encodeURIComponent(record.title);
    let gFormUrl = `https://docs.google.com/forms/...${namaAmanURL}`;
    articleHtml = `<div class="article main-text nodata"><p>${currentNamaKlaster} ini belum memiliki artikel. <a href="${gFormUrl}" target="_blank" rel="noopener noreferrer" class="sunting-linktambah">Tambahkan!</a></p></div>`;
  }
  
  let wikiUrlUtama = `https://www.wikidata.org/wiki/${qid}`;
  let designationsHtml = `<h2 style="margin-top:10px;display: flex;align-items: flex-start; justify-content: space-between;">
                            <div><span id="header-text-${qid}" style="margin-right:7px;">Informasi</span><a href="${wikiUrlUtama}" target="_blank" class="sunting-link"></a></div>
                          </h2><ul class="designations">`;

  // Logika Nama Lokasi ... [Tetap sama dengan JS lama]
  let namaLokasi = record.lokasiSpesifik || 'Belum ada data'; 
  
  // LOGIKA BERBASIS KAMUS
  let activeClusterId = window.currentKlasterId || 'default';
  let configKlaster = KAMUS_KLASTER[activeClusterId] || KAMUS_KLASTER['default'];
  
  let prefixLokasi = configKlaster.teksLokasi; 
  let prefixTahun = configKlaster.teksTahun;
  
  let infoLokasiHtml = '';
  if (record.lat && record.lon) {
    let mapsUrl = `https://www.google.com/maps?q=${record.lat},${record.lon}`;
    infoLokasiHtml = `<p class="koordinat-link">${prefixLokasi}: <a href="${mapsUrl}" target="_blank">${namaLokasi}</a></p>`;
  } else {
    infoLokasiHtml = `<p class="koordinat-link">${prefixLokasi}: ${namaLokasi}</p><p>Koordinat: <span style="font-style: italic; color: #888;">Belum tersedia</span></p>`;
  }

  let infoTahunHtml = '';
  if (prefixTahun !== null) {
    infoTahunHtml = `<p>${prefixTahun}: ${record.tahunBerdiri ? record.tahunBerdiri : '<span style="font-style: italic; color: #888;">Belum tersedia</span>'}</p>`;
  }

  let eventsHtmlPlaceholder = `<div id="events-container-${qid}" class="loading"><div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin-top: 2px;"></div></div>`;
  designationsHtml += '<li>' + infoLokasiHtml + infoTahunHtml + eventsHtmlPlaceholder + '</li></ul>';
  let arsipHtml = `<div id="arsip-container-${qid}" class="loading"><div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin-top: 8px;"></div></div>`;

  let panelElem = document.createElement('div');
  if (currentNamaKlaster === 'Tokoh') panelElem.classList.add('mode-tokoh');
  
  panelElem.innerHTML = titleHtml + figureHtml + articleHtml + designationsHtml + arsipHtml;
  record.panelElem = panelElem;

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));
  queryOsm(qid);
}

// BUGFIX OSM RACE CONDITION
function queryOsm(qid) {
  if (osmFetchController) osmFetchController.abort();
  osmFetchController = new AbortController();
  
  let queryStr = `[out:json][timeout:25];\n(\n  way["wikidata"="${qid}"];\n  relation["wikidata"="${qid}"];\n);\nout body;\n>;\nout skel qt;`;
  let url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(queryStr);

  fetch(url, { signal: osmFetchController.signal })
    .then(response => {
      if (!response.ok) throw new Error('Koneksi ke Overpass gagal');
      return response.json();
    })
    .then(data => {
      if (typeof osmtogeojson !== 'function') return; 
      let geoJson = osmtogeojson(data);
      if (!geoJson || geoJson.features.length === 0) return;
      
      let shapeLayer = L.geoJSON(geoJson, {
        style: { color: '#ff3333', opacity: 0.7, fill: true },
        filter: feature => feature.geometry.type !== 'Point',
      });
      
      Records[qid].shapeLayer = shapeLayer;
      if (window.location.hash.replace('#', '') === qid) {
        if (currentActiveShapeLayer) Map.removeLayer(currentActiveShapeLayer);
        shapeLayer.addTo(Map);
        currentActiveShapeLayer = shapeLayer;
      }
    })
    .catch(error => {
      if (error.name === 'AbortError') console.log('Poligon OSM sebelumnya dibatalkan.');
    });
}

// =========================================================
// FUNGSI PEMBANTU, RENDER DOM, & DEKLARASI KELAS (YANG TERHAPUS)
// =========================================================

function activateMapMarker(qid) {
  let record = Records[qid];
  if (!record.mapMarker) return; 

  if (record.popup && record.popup.isOpen()) return;

  try {
    Map.closePopup();
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        if (window.location.hash !== '#' + qid) return;
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      }
    );
  } catch (error) {
    console.warn("Interupsi animasi peta dicegat:", error);
  }
}

function displayRecordDetails(qid) {
  if (currentDisplayedQid === qid) return; 
  currentDisplayedQid = qid;
  let record = Records[qid];
  document.title = `${record.indexTitle} – ${BASE_TITLE}`;

  if (record._gagalOffline) {
    record.panelElem = undefined;
    record._gagalOffline = false; 
  }
  
  if (PrimaryDataIsLoaded) {
    if (currentActiveShapeLayer) Map.removeLayer(currentActiveShapeLayer);
    if (record.shapeLayer) {
      record.shapeLayer.addTo(Map);
      currentActiveShapeLayer = record.shapeLayer;
    }

    if (!record.panelElem) {
      generateRecordDetails(qid);
      if (typeof populateImportantEventsData === 'function') populateImportantEventsData(qid);
      if (typeof populateHistoricalImagesData === 'function') populateHistoricalImagesData(qid);
    }
    
    let detailsElem = document.getElementById('details');
    detailsElem.innerHTML = ''; 
    detailsElem.appendChild(record.panelElem);

    let stuckImages = record.panelElem.querySelectorAll('img.loading');
    stuckImages.forEach(img => {
      if (!img.complete || img.naturalWidth === 0) {
        let currentSrc = img.src;
        img.src = ''; 
        img.src = currentSrc; 
      }
    });
    
    let stuckCaptions = record.panelElem.querySelectorAll('figcaption');
    stuckCaptions.forEach(caption => {
      if (caption.textContent.includes('(Memuat…)')) {
        let encodedFile = caption.getAttribute('data-filename');
        if (encodedFile) tarikMetadataCaption(encodedFile, null, caption);
      }
    });
    displayPanelContent('details');
  } else {
    displayPanelContent('loading');
  }
}

function generateFigure(filename, title = "Situs", classNames = []) {
  if (filename) {
    let uniqueId = 'caption-' + Math.random().toString(36).substr(2, 9);
    let encodedFilename = encodeURIComponent(filename);
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
    let namaAmanURL = encodeURIComponent(title);
    let gFormFotoUrl = `https://docs.google.com/forms/d/e/1FAIpQLSd7_u-7yCwDtXIkDO--bILry6mWGoRCnnfSumL_PEjfle0aLg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    return `<figure class="${classNames.join(' ')} nodata">Belum ada foto. <a href="${gFormFotoUrl}" target="_blank" rel="noopener noreferrer" style="border:none;" class="sunting-linktambah">Tambahkan!</a></figure>`;
  }
}

function extractImageFilename(image) {
  let regex = /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;
  return decodeURIComponent(image.value.replace(regex, ''));
}

function tarikMetadataCaption(filename, targetId, targetNode = null) {
  let url = new URL(COMMONS_API_URL);
  let params = {
    action: 'query', format: 'json', prop: 'imageinfo',
    iiprop: 'extmetadata', titles: 'File:' + decodeURIComponent(filename), origin: '*'
  };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  let fetchOptions = {};
  if (!targetNode && typeof globalFetchController !== 'undefined') {
    fetchOptions.signal = globalFetchController.signal;
  }

  fetch(url, fetchOptions)
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
      let pages = data.query.pages;
      let page = Object.values(pages)[0];
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

function updateFeatureCounts(totalValidRecords) {
  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = `Menampilkan ${totalValidRecords} hasil (atau ketik yang dicari)`;
  }
}

function displayArticleExtract(title, elem) {
  let url = new URL('https://id.wikipedia.org/w/api.php');
  let params = {
    action: 'query', format: 'json', prop: 'extracts',
    exintro: 1, redirects: true, titles: title, origin: '*' 
  };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  fetch(url, { signal: globalFetchController.signal })
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(data => {
      if (!data.query || !data.query.pages) throw new Error('Struktur data Wikipedia tidak ditemukan');
      let rawExtract = Object.values(data.query.pages)[0].extract || '';
      
      let kumpulanParagraf = rawExtract.match(/<p[^>]*>[\s\S]+?<\/p>/g);
      let paragrafPilihan = kumpulanParagraf ? kumpulanParagraf.find(text => text.length > 50) : null;

      if (paragrafPilihan) {
        paragrafPilihan = paragrafPilihan.replace(/^<p[^>]*>(\s|<br\s*\/?>| )*/i, '<p>');
        paragrafPilihan = paragrafPilihan.replace(/<span[^>]*>[^<]*code:\s*[a-z\-]+\s*is deprecated[^<]*<\/span>/gi, '');
        paragrafPilihan = paragrafPilihan.replace(/<[^>]*>[^<]*(is deprecated|Lua error|Script error)[^<]*<\/[^>]*>/gi, '');
      } else {
        paragrafPilihan = '<p>Ringkasan artikel belum memadai.</p>'; 
      }

      if (elem) {
        elem.innerHTML = paragrafPilihan +
          '<p class="wikipedia-link">' +
            `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
              '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
              '<span>Baca selengkapnya di Wikipedia</span>' +
            '</a>' +
          '</p>';
        elem.classList.remove('loading');
      }
    })
    .catch(error => {
      if (error.name === 'AbortError') return;
      if (elem) {
        elem.innerHTML = '<p class="nodata" style="color:#cc0000; margin-top:10px;">Gagal memuat ringkasan artikel.</p>';
        elem.classList.remove('loading');
      }
    });
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

function renderHistoricalImagesInPanel(qid) {
  let record = Records[qid];
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#arsip-container-${qid}`);
  if (!container) return; 

  let html = '';
  
  function buildImageBlock(imgObj, teksPengganti) {
    let block = '<div class="arsip-block" style="overflow: hidden;">';
    block += generateFigure(imgObj.file);
    if (imgObj.caption && imgObj.caption.trim() !== '') {
      block += `<div class="article main-text"><p>${imgObj.caption}</p></div>`;
    } else {
      block += `<div class="article main-text nodata"><p>${teksPengganti}</p></div>`;
    }
    block += '</div>';
    return block;
  }

  if (record.pastImage) html += buildImageBlock(record.pastImage, 'Suasana/bentuk/tampilan sebelumnya');
  if (record.interiorImage) html += buildImageBlock(record.interiorImage, 'Pemandangan di dalam');
  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgObj => {
      html += buildImageBlock(imgObj, 'Objek di sekitar');
    });
  }

  if (record.commonsCat) {
    html += '<h2 style="margin-top:10px; margin-bottom: 7px;">Galeri lainnya</h2>';
    html += 
      '<p class="wikipedia-link" style="margin-bottom: 0;">' +
        `<a href="https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(record.commonsCat)}" target="_blank">` +
          '<img src="img/wikicommons_tiny_logo.png" alt="" />' +
          '<span>Lihat di Wikimedia Commons</span>' +
        '</a>' +
      '</p>';
  }

  if (html !== '') {
    let wikiUrlGaleri = `https://www.wikidata.org/wiki/${qid}#P18`;
    let tautanSuntingGaleri = `<a href="${wikiUrlGaleri}" target="_blank" class="sunting-link" title="Sunting data galeri di Wikidata" aria-label="Sunting data galeri di Wikidata"></a>`;
    
    let judulGaleriUtama = '';
    if (record.pastImage || record.interiorImage || (record.vicinityImages && record.vicinityImages.length > 0)) {
      judulGaleriUtama = `<h2 style="margin-top:10px;margin-bottom:10px;">Galeri ${tautanSuntingGaleri}</h2>`;
    }
    
    container.innerHTML = judulGaleriUtama + html;
    container.classList.remove('loading');
  } else {
    container.innerHTML = '';
    container.classList.remove('loading');
    container.style.display = 'none';
  }
}

function populateProvinceIndex() {
  if (!ProvinceIndex['all']) ProvinceIndex['all'] = new ProvinceIndexEntry();

  Object.values(Records).forEach(record => {
    ProvinceIndex['all'].total++;
    Object.keys(record.designations).forEach(provQid => {
      if (!ProvinceIndex[provQid]) {
        ProvinceIndex[provQid] = new ProvinceIndexEntry();
        ProvinceIndex[provQid].name = record.designations[provQid];
      }
      ProvinceIndex[provQid].total++;
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
        { icon: ikonTetesanAir }
      );
      record.mapMarker = mapMarker;
      
      mapMarker.bindPopup(record.title, { 
        closeButton: false,
        maxWidth: 200 
      });

      mapMarker.togglePopup = function() {
        if (!this.isPopupOpen()) this.openPopup();
      };

      mapMarker.on('mousedown touchstart', function() {
        this._bukaSaatDisentuh = this.isPopupOpen();
      });

      mapMarker.on('click', function() {
        if (this._bukaSaatDisentuh && typeof window.setMobilePanelExpanded === 'function') {
          window.setMobilePanelExpanded(true, true);
        }
      });
      mapMarker.on('dblclick', function(e) {
        L.DomEvent.stopPropagation(e);
        if (typeof window.setMobilePanelExpanded === 'function') {
          window.setMobilePanelExpanded(true, true);
        }
      });
      
      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
      mapMarkers.push(mapMarker);
    }
    
    let li = document.createElement('li');
    let a = document.createElement('a');
    a.href = '#' + qid;
    a.textContent = record.indexTitle; 
    li.appendChild(a);
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
      if (ProvinceIndex[provQid]) {
        if (record.mapMarker) ProvinceIndex[provQid].mapMarkers.push(record.mapMarker);
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

function jalankanFilterGPS(selectElem) {
  selectElem.options[selectElem.selectedIndex].text = "⏳ Mencari satelit GPS...";
  let konfigurasiZoomAsli = window.TombolGPSMap.options.setView;
  window.TombolGPSMap.options.setView = false; 
  window.TombolGPSMap.start();

  Map.once('locationfound', function(e) {
    window.TombolGPSMap.options.setView = konfigurasiZoomAsli;
    userLocation = { lat: e.latlng.lat, lon: e.latlng.lng };
    selectElem.options[selectElem.selectedIndex].text = "Sekitar Anda (Radius 10 km)";
    currentRegionFilter = 'terdekat';

    if (userRadiusCircle) Map.removeLayer(userRadiusCircle);
    userRadiusCircle = L.circle([userLocation.lat, userLocation.lon], {
      color: 'transparent', fillColor: '#882222', fillOpacity: 0.1, radius: 10000
    }).addTo(Map);

    Map.fitBounds(userRadiusCircle.getBounds());
    applyIntersectionFilter();
  });

  Map.once('locationerror', function(e) {
    window.TombolGPSMap.options.setView = konfigurasiZoomAsli;
    window.TombolGPSMap.stop(); 
    alert("Akses lokasi gagal atau ditolak. Pastikan GPS HP Anda menyala.");
    batalkanFilterGPS(selectElem);
  });
}

function batalkanFilterGPS(selectElem) {
  if (window.TombolGPSMap) window.TombolGPSMap.stop();
  Map.off('locationfound');
  Map.off('locationerror');
  if (userRadiusCircle) Map.removeLayer(userRadiusCircle);

  selectElem.value = 'all';
  currentRegionFilter = 'all';
  userLocation = null;

  let opsi = Array.from(selectElem.options).find(opt => opt.value === 'terdekat');
  if (opsi) opsi.text = "Sekitar Anda (Radius 10 km)";
  applyIntersectionFilter();
}

// =========================================================
// DEKLARASI KELAS DATA (CLASS)
// =========================================================

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
    this.interiorImage = undefined;
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
