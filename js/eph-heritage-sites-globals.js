'use strict';
const BASE_TITLE = 'WikiJelajah';

// =========================================================
// 1. KAMUS PROPERTI WIKIDATA (Konfigurasi Modular)
// Semua P-number dan cara query-nya diatur di sini
// =========================================================
const KAMUS_PROPERTI = {
  // TIPE: 'item' (Satu nilai label biasa)
  'arsitek': { id: 'P84', tipe: 'item' },
  'kondisi': { id: 'P5817', tipe: 'item' },
  'penerbit': { id: 'P123', tipe: 'item' },
  'pegunungan': { id: 'P4552', tipe: 'item' },
  'tempatTemu': { id: 'P189', tipe: 'item' },
  'bagianDari': { id: 'P361', tipe: 'item' },
  'pencipta': { id: 'P170', tipe: 'item' },

  // TIPE: 'item_list' (Banyak nilai, digabung dengan koma)
  'fasilitasList': { id: 'P912', tipe: 'item_list' },
  'gayaList': { id: 'P149', tipe: 'item_list' },
  'jalurList': { id: 'P81', tipe: 'item_list' },
  'spesialisasiList': { id: 'P101', tipe: 'item_list' },
  'agamaList': { id: 'P140', tipe: 'item_list' },
  'bahasaList': { id: 'P407', tipe: 'item_list' },
  'bentukList': { id: 'P7937', tipe: 'item_list' },
  'genreList': { id: 'P136', tipe: 'item_list' },
  'penulisList': { id: 'P50', tipe: 'item_list' },
  'subjekList': { id: 'P921', tipe: 'item_list' },
  'kolektorList': { id: 'P195', tipe: 'item_list' },
  'bahanList': { id: 'P186', tipe: 'item_list' },
  'aksaraList': { id: 'P282', tipe: 'item_list' },
  'pemredList': { id: 'P5769', tipe: 'item_list' },
  'pendiriList': { id: 'P112', tipe: 'item_list' },
  'caraList': { id: 'P2079', tipe: 'item_list' },
  'pekerjaanList': { id: 'P106', tipe: 'item_list' },
  'koleksiKaryaList': { id: 'P6379', tipe: 'item_list' },

  // TIPE: 'angka' (Nilai numerik murni)
  'kapasitas': { id: 'P1083', tipe: 'angka' },
  'korban': { id: 'P1120', tipe: 'angka' },

  // TIPE: 'url' (Tautan situs web)
  'lamanResmi': { id: 'P856', tipe: 'url' },

  // TIPE: 'waktu' (Data waktu spesifik + presisi)
  'tglTemu': { id: 'P575', tipe: 'waktu' },
  'berakhirPada': { id: 'P582', tipe: 'waktu' },
  'tglWafat': { id: 'P570', tipe: 'waktu' },

  // TIPE: 'kuantitas_satuan' (Angka + Satuan ukur opsional)
  'jumlahKoleksi': { id: 'P1436', tipe: 'kuantitas_satuan' },
  'panjang': { id: 'P2043', tipe: 'kuantitas_satuan' },
  'lebar': { id: 'P2049', tipe: 'kuantitas_satuan' },
  'tinggi': { id: 'P2048', tipe: 'kuantitas_satuan' },

  // TIPE SPESIFIK / KOMPLEKS (Membutuhkan kueri unik)
  'populasi': { id: 'P1082', tipe: 'khusus_populasi' },
  'penutur': { id: 'P1098', tipe: 'khusus_populasi' },
  'kepalaDaerah': { id: 'P6', tipe: 'khusus_tokoh_wiki' },
  'wikibooks': { id: 'custom_wiki', tipe: 'khusus_wikibooks' }
};

// =========================================================
// 2. KAMUS KLASTER & LABEL UI
// Mengatur UI (teks tahun/lokasi) & daftar P-number per kategori
// =========================================================
const KAMUS_KLASTER = {
  // --- KLASTER UMUM / BANGUNAN ---
  'bangunan_umum': {
    teksLokasi: 'Letak', teksTahun: 'Didirikan',
    props: ['kapasitas', 'kondisi', 'lamanResmi', 'arsitek', 'fasilitasList', 'gayaList']
  },
  'stasiun': {
    teksLokasi: 'Letak', teksTahun: 'Didirikan',
    props: ['kapasitas', 'kondisi', 'lamanResmi', 'arsitek', 'fasilitasList', 'gayaList', 'jalurList']
  },
  'museum': {
    teksLokasi: 'Letak', teksTahun: 'Didirikan',
    props: ['kapasitas', 'kondisi', 'lamanResmi', 'arsitek', 'fasilitasList', 'gayaList', 'jumlahKoleksi', 'spesialisasiList']
  },
  
  // --- KLASTER ADMINISTRATIF ---
  'wilayah': {
    teksLokasi: 'Provinsi', teksTahun: 'Hari jadi',
    props: ['populasi', 'kepalaDaerah', 'lamanResmi']
  },

  // --- KLASTER SEJARAH / ARKEOLOGI ---
  'situs_arkeologi': {
    teksLokasi: 'Letak', teksTahun: 'Era/periode',
    props: ['tglTemu', 'tempatTemu', 'agamaList', 'bagianDari', 'pencipta', 'panjang', 'lebar', 'tinggi', 'bahanList', 'aksaraList']
  },
  'artefak': {
    teksLokasi: 'Lokasi sekarang', teksTahun: 'Tarikh',
    props: ['tglTemu', 'tempatTemu', 'bagianDari', 'kolektorList', 'pencipta', 'panjang', 'lebar', 'tinggi', 'bahanList', 'aksaraList']
  },

  // --- KLASTER KARYA SASTRA & PUBLIKASI ---
  'literatur': {
    teksLokasi: 'Tempat terbit', teksTahun: 'Terbit perdana',
    props: ['bahasaList', 'bentukList', 'genreList', 'penulisList', 'subjekList']
  },
  'media_massa': {
    teksLokasi: 'Tempat terbit', teksTahun: 'Terbit perdana',
    props: ['bahasaList', 'bentukList', 'genreList', 'penulisList', 'subjekList', 'pemredList', 'pendiriList', 'penerbit', 'berakhirPada']
  },

  // --- KLASTER ALAM & BUDAYA ---
  'gunung': {
    teksLokasi: 'Letak', teksTahun: null, // Alam tidak pakai tahun
    props: ['pegunungan']
  },
  'hidangan': {
    teksLokasi: 'Hidangan khas', teksTahun: null,
    props: ['bahanList', 'caraList', 'wikibooks']
  },
  'bahasa': {
    teksLokasi: 'Wilayah penutur utama', teksTahun: null,
    props: ['penutur']
  },
  
  // --- KLASTER BENCANA & PERISTIWA ---
  'peristiwa': {
    teksLokasi: 'Pusat kejadian/terdampak', teksTahun: 'Pada',
    props: ['korban', 'bagianDari']
  },

  // --- TOKOH ---
  'tokoh': {
    teksLokasi: 'Tempat lahir', teksTahun: 'Lahir',
    props: ['tglWafat', 'pekerjaanList', 'spesialisasiList', 'koleksiKaryaList']
  },

  // --- FALLBACK (Kustom / Default) ---
  'default': {
    teksLokasi: 'Lokasi', teksTahun: 'Tahun',
    props: [] // Kosong, hanya akan menarik data dasar (tipe, tinggi, luas)
  }
};

// =========================================================
// 3. BASE QUERIES (Sistem Hierarki & Paginasi)
// =========================================================
const KUMPULAN_KUERI_0 = {
'universal': `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      VALUES ?j { <PLACEHOLDER_JENIS> }
      <PLACEHOLDER_KURUNG_BUKA>
      <PLACEHOLDER_WILAYAH_1>
      ?s wdt:P31 ?j ;
         wdt:<PLACEHOLDER_PROP_LOKASI> ?l .
      <PLACEHOLDER_HIERARKI_LOKASI>
      <PLACEHOLDER_KURUNG_TUTUP>
      <PLACEHOLDER_UNION_EKSTRA>
    }
    ORDER BY ?s ?p ?l
    <PLACEHOLDER_LIMIT_OFFSET>
  }
  OPTIONAL {
    ?s p:<PLACEHOLDER_PROP_TAHUN> ?iS .
    ?iS psv:<PLACEHOLDER_PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ;
        wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s), 32) AS ?SQ) .
  BIND(SUBSTR(STR(?p), 32) AS ?PQ) .
  BIND(SUBSTR(STR(?l), 32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
}`,

'khusus_negara_all': `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?lLabel ?tM ?tP
WHERE {
  <PLACEHOLDER_FILTER_NASIONAL>
  ?s wdt:P31 ?j .
  VALUES ?j { <PLACEHOLDER_JENIS> }
  OPTIONAL {
    ?p wdt:P31 wd:Q5098 .
    ?s wdt:<PLACEHOLDER_PROP_LOKASI> ?l .
    ?l wdt:P131* ?p .
  }
  OPTIONAL {
    ?s p:<PLACEHOLDER_PROP_TAHUN> ?iS .
    ?iS psv:<PLACEHOLDER_PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ;
        wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s), 32) AS ?SQ) .
  BIND(SUBSTR(STR(?p), 32) AS ?PQ) .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
}`,

'apapun': `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      <PLACEHOLDER_KURUNG_BUKA>
      <PLACEHOLDER_WILAYAH_1>
      
      # Syarat Mutlak: Punya Koordinat, Punya Gambar, Berada di Negara Pilihan
      ?s wdt:P17 <PLACEHOLDER_NEGARA_MUTLAK> ;
         wdt:P625 [] ;
         wdt:P18 [] ;
         wdt:<PLACEHOLDER_PROP_LOKASI> ?l .
         
      <PLACEHOLDER_HIERARKI_LOKASI>
      <PLACEHOLDER_KURUNG_TUTUP>
      <PLACEHOLDER_UNION_EKSTRA>
    }
    ORDER BY ?s ?p ?l
    <PLACEHOLDER_LIMIT_OFFSET>
  }
  OPTIONAL {
    ?s p:<PLACEHOLDER_PROP_TAHUN> ?iS .
    ?iS psv:<PLACEHOLDER_PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ;
        wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s), 32) AS ?SQ) .
  BIND(SUBSTR(STR(?p), 32) AS ?PQ) .
  BIND(SUBSTR(STR(?l), 32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
}`,

'luar_negeri': `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      VALUES ?j { <PLACEHOLDER_JENIS> }
      ?s wdt:P17 <PLACEHOLDER_NEGARA> ;
         wdt:P31 ?j ;
         wdt:<PLACEHOLDER_PROP_LOKASI> ?l .
      OPTIONAL {
        ?l wdt:P131* ?p .
        ?p wdt:P131 <PLACEHOLDER_NEGARA> .
      }
    }
    ORDER BY ?s ?p ?l
    <PLACEHOLDER_LIMIT_OFFSET>
  }
  OPTIONAL {
    ?s p:<PLACEHOLDER_PROP_TAHUN> ?iS .
    ?iS psv:<PLACEHOLDER_PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ;
        wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s), 32) AS ?SQ) .
  BIND(SUBSTR(STR(?p), 32) AS ?PQ) .
  BIND(SUBSTR(STR(?l), 32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
}`
};

const KUMPULAN_KUERI_1 = {
'universal': `SELECT DISTINCT ?siteQid ?coord WHERE {
  VALUES ?site { <PLACEHOLDER_QIDS> }
  <PLACEHOLDER_KLAUSA_KOORDINAT>
  ?coordStatement ps:P625 ?coord .
  FILTER NOT EXISTS { ?coordStatement pq:P518 ?x }
  BIND (SUBSTR(STR(?site), 32) AS ?siteQid) .
}`
};

const SPARQL_QUERY_3_TEMPLATE = `SELECT ?siteQid (SAMPLE(?imgUtama) AS ?image) (SAMPLE(?wikiTitle) AS ?wikipediaUrlTitle) WHERE {
  VALUES ?site { <PLACEHOLDER_QIDS> }
  OPTIONAL {
    ?site p:P18 ?imageStatement .
    ?imageStatement ps:P18 ?imgUtama .
    FILTER NOT EXISTS { ?imageStatement pq:P3831 wd:Q16189205 }
    FILTER NOT EXISTS { ?imageStatement pq:P180 wd:Q192630 }
  }
  OPTIONAL {
    ?wikipedia schema:about ?site ;
               schema:isPartOf <https://id.wikipedia.org/> .
    BIND (SUBSTR(STR(?wikipedia), 31) AS ?wikiTitle) .
  }
  BIND (SUBSTR(STR(?site), 32) AS ?siteQid) .
} GROUP BY ?siteQid`;

// =========================================================
// 4. PEMBANGUN KUERI DINAMIS (DYNAMIC BUILDERS)
// =========================================================

function getSparqlQuery4(qid) {
  return `SELECT ?siteQid ?eventLabel ?pointInTime ?ptPrecision ?startTime ?stPrecision ?endTime ?etPrecision WHERE {
  VALUES ?site { wd:${qid} }
  ?site p:P793 ?eventStatement .
  ?eventStatement ps:P793 ?event .
  ?event rdfs:label ?eventLabel . 
  FILTER(LANG(?eventLabel) = "id") .
  OPTIONAL { 
    ?eventStatement pqv:P585 ?ptNode .
    ?ptNode wikibase:timeValue ?pointInTime ;
            wikibase:timePrecision ?ptPrecision .
  }
  OPTIONAL { 
    ?eventStatement pqv:P580 ?stNode .
    ?stNode wikibase:timeValue ?startTime ;
            wikibase:timePrecision ?stPrecision .
  }
  OPTIONAL { 
    ?eventStatement pqv:P582 ?etNode .
    ?etNode wikibase:timeValue ?endTime ;
            wikibase:timePrecision ?etPrecision .
  }
  BIND (SUBSTR(STR(?site), 32) AS ?siteQid) .
  }`;
}

// PERBAIKAN: Menghapus LIMIT 1 agar interiorImage dan pastImage tidak terpotong!
function getSparqlQuery5(qid) {
  return `SELECT ?siteQid ?vicinityImage ?vicinityCaption ?pastImage ?pastCaption ?interiorImage ?interiorCaption ?commonsCat WHERE {
  VALUES ?site { wd:${qid} }
  OPTIONAL { ?site wdt:P373 ?commonsCat . }
  OPTIONAL {
    ?site p:P18 ?vicinityStatement .
    ?vicinityStatement ps:P18 ?vicinityImage .
    FILTER EXISTS { ?vicinityStatement pq:P3831 wd:Q16189205 }
    OPTIONAL {
      ?vicinityStatement pq:P2096 ?vicinityCaption .
      FILTER(LANG(?vicinityCaption) = "id")
    }
  }
  OPTIONAL {
    ?site p:P18 ?pastImgStmt .
    ?pastImgStmt ps:P18 ?pastImage .
    ?pastImgStmt pq:P180 wd:Q192630 .
    OPTIONAL {
      ?pastImgStmt pq:P2096 ?pastCaption .
      FILTER(LANG(?pastCaption) = "id")
    }
  }
  OPTIONAL {
    ?site p:P5775 ?interiorStmt .
    ?interiorStmt ps:P5775 ?interiorImage .
    OPTIONAL {
      ?interiorStmt pq:P2096 ?interiorCaption .
      FILTER(LANG(?interiorCaption) = "id")
    }
  }
  BIND (SUBSTR(STR(?site), 32) AS ?siteQid) .
  }`;
}

// =========================================================
// CORE DYNAMIC BUILDER (FUNGSI UTAMA YANG DIROMBAK)
// Menggabungkan data universal & spesifik klaster berdasarkan kamus
// =========================================================
function getSparqlQuery6(qid) {
  // 1. Tentukan ID Klaster yang sedang aktif (Atau fallback ke default)
  let activeClusterId = window.currentKlasterId || 'default';
  let klasterConfig = KAMUS_KLASTER[activeClusterId] || KAMUS_KLASTER['default'];

  // 2. Siapkan Blok Universal (Selalu diambil untuk semua objek)
  let selectClause = `SELECT ?siteQid (GROUP_CONCAT(DISTINCT ?tipeLabel; SEPARATOR=", ") AS ?tipeList) (SAMPLE(?ketinggianVal) AS ?ketinggian) (SAMPLE(?luasData) AS ?luas) `;
  let whereClause = `
    VALUES ?site { wd:${qid} }
    
    OPTIONAL {
      ?site wdt:P31 ?tipeVal .
      OPTIONAL { ?tipeVal rdfs:label ?tipeLabelId . FILTER(LANG(?tipeLabelId) = "id") }
      BIND(COALESCE(?tipeLabelId, REPLACE(STR(?tipeVal), "^.*/", "")) AS ?tipeLabel)
    }
    
    OPTIONAL { ?site wdt:P2044 ?ketinggianVal . }
    
    OPTIONAL {
      ?site p:P2046 ?luasStmt .
      ?luasStmt psv:P2046 ?luasNode .
      ?luasNode wikibase:quantityAmount ?luasVal .
      OPTIONAL { 
        ?luasNode wikibase:quantityUnit ?luasUnitItem . 
        ?luasUnitItem rdfs:label ?luasUnitLabel . 
        FILTER(LANG(?luasUnitLabel) = "id") 
      }
      OPTIONAL { 
        ?luasStmt pq:P518 ?luasBagianItem . 
        ?luasBagianItem rdfs:label ?luasBagianLabel . 
        FILTER(LANG(?luasBagianLabel) = "id") 
      }
      BIND(CONCAT(STR(?luasVal), "|", IF(BOUND(?luasUnitLabel), ?luasUnitLabel, ""), "|", IF(BOUND(?luasBagianLabel), ?luasBagianLabel, "")) AS ?luasData)
    }
  `;

  // 3. Merakit (Build) Blok Properti Tambahan Berdasarkan Kamus
  klasterConfig.props.forEach(propKey => {
    let propMeta = KAMUS_PROPERTI[propKey];
    if (!propMeta) return; 

    // --- A. TIPE: ITEM BIASA (1 Nilai) ---
    if (propMeta.tipe === 'item') {
      selectClause += `(SAMPLE(?${propKey}Label) AS ?${propKey}) `;
      whereClause += `OPTIONAL { ?site wdt:${propMeta.id} ?${propKey}Item . ?${propKey}Item rdfs:label ?${propKey}Label . FILTER(LANG(?${propKey}Label) = "id" || LANG(?${propKey}Label) = "en") } \n`;
    } 
    // --- B. TIPE: DAFTAR ITEM (Banyak Nilai -> GROUP_CONCAT) ---
    else if (propMeta.tipe === 'item_list') {
      selectClause += `(GROUP_CONCAT(DISTINCT ?${propKey}Label; separator=", ") AS ?${propKey}) `;
      whereClause += `OPTIONAL { ?site wdt:${propMeta.id} ?${propKey}Item . ?${propKey}Item rdfs:label ?${propKey}Label . FILTER(LANG(?${propKey}Label) = "id" || LANG(?${propKey}Label) = "en") } \n`;
    }
    // --- C. TIPE: ANGKA & URL ---
    else if (propMeta.tipe === 'angka' || propMeta.tipe === 'url') {
      selectClause += `(SAMPLE(?${propKey}Val) AS ?${propKey}) `;
      whereClause += `OPTIONAL { ?site wdt:${propMeta.id} ?${propKey}Val . } \n`;
    }
    // --- D. TIPE: WAKTU (Angka + Presisi) ---
    else if (propMeta.tipe === 'waktu') {
      selectClause += `(SAMPLE(?${propKey}Data) AS ?${propKey}) `;
      whereClause += `
        OPTIONAL {
          ?site p:${propMeta.id} ?${propKey}Stmt .
          ?${propKey}Stmt psv:${propMeta.id} ?${propKey}Node .
          ?${propKey}Node wikibase:timeValue ?${propKey}Val ; 
                          wikibase:timePrecision ?${propKey}Prec .
          BIND(CONCAT(STR(?${propKey}Val), "|", STR(?${propKey}Prec)) AS ?${propKey}Data)
        }
      `;
    }
    // --- E. TIPE: KUANTITAS + SATUAN ---
    else if (propMeta.tipe === 'kuantitas_satuan') {
      selectClause += `(SAMPLE(?${propKey}Data) AS ?${propKey}) `;
      whereClause += `
        OPTIONAL {
          ?site p:${propMeta.id} ?${propKey}Stmt .
          ?${propKey}Stmt psv:${propMeta.id} ?${propKey}Node .
          ?${propKey}Node wikibase:quantityAmount ?${propKey}Val .
          OPTIONAL { 
            ?${propKey}Node wikibase:quantityUnit ?${propKey}UnitItem . 
            ?${propKey}UnitItem rdfs:label ?${propKey}UnitLabel . 
            FILTER(LANG(?${propKey}UnitLabel) = "id") 
          }
          BIND(CONCAT(STR(?${propKey}Val), "|", IF(BOUND(?${propKey}UnitLabel), ?${propKey}UnitLabel, "")) AS ?${propKey}Data)
        }
      `;
    }
    // --- F. TIPE KOMPLEKS KHUSUS ---
    else if (propMeta.tipe === 'khusus_populasi') {
      selectClause += `(SAMPLE(?${propKey}Data) AS ?${propKey}) `;
      whereClause += `
        OPTIONAL {
          ?site p:${propMeta.id} ?${propKey}Stmt . ?${propKey}Stmt ps:${propMeta.id} ?${propKey}Val .
          OPTIONAL { ?${propKey}Stmt pq:P585 ?${propKey}Date . }
          BIND(CONCAT(STR(?${propKey}Val), "|", STR(YEAR(?${propKey}Date))) AS ?${propKey}Data)
        }
      `;
    }
    else if (propMeta.tipe === 'khusus_tokoh_wiki') {
      selectClause += `(SAMPLE(?${propKey}Data) AS ?${propKey}) `;
      whereClause += `
        OPTIONAL {
          ?site p:${propMeta.id} ?${propKey}Stmt . ?${propKey}Stmt ps:${propMeta.id} ?${propKey}Item . 
          ?${propKey}Item rdfs:label ?${propKey}Label . FILTER(LANG(?${propKey}Label) = "id")
          OPTIONAL { ?${propKey}Stmt pq:P580 ?${propKey}Date . }
          OPTIONAL {
            ?${propKey}Wiki schema:about ?${propKey}Item ;
                            schema:isPartOf <https://id.wikipedia.org/> .
          }
          BIND(CONCAT(STR(?${propKey}Label), "|", STR(YEAR(?${propKey}Date)), "|", IF(BOUND(?${propKey}Wiki), STR(?${propKey}Wiki), "kosong")) AS ?${propKey}Data)
        }
      `;
    }
    else if (propMeta.tipe === 'khusus_wikibooks') {
      selectClause += `(SAMPLE(?wikibooksUrl) AS ?wikibooks) `;
      whereClause += `
        OPTIONAL {
          ?wikibooksUrl schema:about ?site ;
                        schema:isPartOf <https://id.wikibooks.org/> .
        }
      `;
    }
  });

  return `${selectClause} WHERE { ${whereClause} BIND (SUBSTR(STR(?site), 32) AS ?siteQid) } GROUP BY ?siteQid`;
}

const ABOUT_SPARQL_QUERY = ``;
