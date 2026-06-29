'use strict';

const BASE_TITLE = 'WikiSurau';

const KUMPULAN_KUERI_0 = {
  'universal': `SELECT DISTINCT ?siteQid ?siteLabel ?provinsiQid ?provinsiLabel ?p131LokasiLabel ?tahunBerdiriMentah ?tahunPresisi
  WHERE {
    VALUES ?jenis { <PLACEHOLDER_JENIS> } 
    
    <PLACEHOLDER_KURUNG_BUKA>
      <PLACEHOLDER_WILAYAH_1>
      ?site wdt:P31 ?jenis ;
            wdt:<PLACEHOLDER_PROP_LOKASI> ?p131Lokasi .
      <PLACEHOLDER_HIERARKI_LOKASI>
    <PLACEHOLDER_KURUNG_TUTUP>
    
    <PLACEHOLDER_UNION_EKSTRA>
    
    OPTIONAL { 
      ?site p:<PLACEHOLDER_PROP_TAHUN> ?inceptionStmt .
      ?inceptionStmt psv:<PLACEHOLDER_PROP_TAHUN> ?inceptionNode .
      ?inceptionNode wikibase:timeValue ?tahunBerdiriMentah ;
                     wikibase:timePrecision ?tahunPresisi .
    }
    
    BIND(SUBSTR(STR(?site), 32) AS ?siteQid) .
    BIND(SUBSTR(STR(?provinsi), 32) AS ?provinsiQid) .
    
    SERVICE wikibase:label { bd:serviceParam wikibase:language "id". }
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


const SPARQL_QUERY_3_TEMPLATE =
`SELECT ?siteQid (SAMPLE(?imgUtama) AS ?image) (SAMPLE(?wikiTitle) AS ?wikipediaUrlTitle) WHERE {
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

function getSparqlQuery5(qid) {
  return `SELECT ?siteQid ?vicinityImage ?vicinityCaption ?pastImage ?pastCaption ?interiorImage ?interiorCaption ?commonsCat WHERE {
    VALUES ?site { wd:${qid} }
    
    # Tarik kategori Commons berbarengan dengan Galeri
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

    # Pemandangan di dalam (interior view / P5775)
    OPTIONAL {
      ?site p:P5775 ?interiorStmt .
      ?interiorStmt ps:P5775 ?interiorImage .
      OPTIONAL {
        ?interiorStmt pq:P2096 ?interiorCaption .
        FILTER(LANG(?interiorCaption) = "id")
      }
    }
    
    BIND (SUBSTR(STR(?site), 32) AS ?siteQid) .
  } LIMIT 1`;
}

function getSparqlQuery6(qid) {
  let klaster = typeof currentNamaKlaster !== 'undefined' ? currentNamaKlaster : 'Objek';

  // 1. Data Universal (Semua Klaster Bisa Punya)
  // Perhatikan ?luasData sekarang berupa gabungan "Angka|Satuan|KeteranganP518"
  let selectClause = `SELECT ?siteQid (SAMPLE(?ketinggianVal) AS ?ketinggian) (SAMPLE(?luasData) AS ?luas) `;
  let whereClause = `
    VALUES ?site { wd:${qid} }
    OPTIONAL { ?site wdt:P2044 ?ketinggianVal . }
    OPTIONAL {
      ?site p:P2046 ?luasStmt .
      ?luasStmt psn:P2046 ?luasNode .
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

  // 2. KLASTER BANGUNAN & FASILITAS
  const klasterBangunan = [
    'Masjid', 'Bangunan bersejarah', 'Gereja & katedral', 'Vihara & kelenteng', 
    'Rumah sakit', 'Universitas & kampus', 'Perpustakaan', 'Istana', 'Bandar udara', 
    'Terminal bus', 'Stadion & lapangan olahraga', 'Kuil & candi', 'Benteng dan bunker', 
    'Pasar dan mall', 'Hotel dan resor', 'Monumen, patung, & memorial', 'Museum', 'Stasiun kereta api'
  ];
  
  if (klasterBangunan.includes(klaster)) {
    selectClause += `(SAMPLE(?kapasitasVal) AS ?kapasitas) (SAMPLE(?kondisiLabel) AS ?kondisi) (SAMPLE(?webVal) AS ?lamanResmi) (SAMPLE(?arsitekLabel) AS ?arsitek) (GROUP_CONCAT(DISTINCT ?fasilitasLabel; separator=", ") AS ?fasilitasList) (GROUP_CONCAT(DISTINCT ?gayaLabel; separator=", ") AS ?gayaList) `;
    whereClause += `
      OPTIONAL { ?site wdt:P1083 ?kapasitasVal . }
      OPTIONAL { ?site wdt:P5817 ?kondisiItem . ?kondisiItem rdfs:label ?kondisiLabel . FILTER(LANG(?kondisiLabel) = "id") }
      OPTIONAL { ?site wdt:P856 ?webVal . }
      OPTIONAL { ?site wdt:P84 ?arsitekItem . ?arsitekItem rdfs:label ?arsitekLabel . FILTER(LANG(?arsitekLabel) = "id") }
      OPTIONAL { ?site wdt:P912 ?fasilitasItem . ?fasilitasItem rdfs:label ?fasilitasLabel . FILTER(LANG(?fasilitasLabel) = "id") }
      OPTIONAL { ?site wdt:P149 ?gayaItem . ?gayaItem rdfs:label ?gayaLabel . FILTER(LANG(?gayaLabel) = "id") }
    `;
  }

  // 3. KONDISI KHUSUS PER KLASTER
  if (klaster === 'Wilayah Administratif') {
    selectClause += `(SAMPLE(?popData) AS ?populasi) (SAMPLE(?govData) AS ?kepalaDaerah) (SAMPLE(?webVal) AS ?lamanResmi) `;
    whereClause += `
      OPTIONAL { ?site wdt:P856 ?webVal . }
      OPTIONAL {
        ?site p:P1082 ?popStmt . ?popStmt ps:P1082 ?popVal .
        OPTIONAL { ?popStmt pq:P585 ?popDate . }
        BIND(CONCAT(STR(?popVal), "|", STR(YEAR(?popDate))) AS ?popData)
      }
      OPTIONAL {
        ?site p:P6 ?govStmt . ?govStmt ps:P6 ?govItem . 
        ?govItem rdfs:label ?govLabel . FILTER(LANG(?govLabel) = "id")
        OPTIONAL { ?govStmt pq:P580 ?govDate . }
        BIND(CONCAT(STR(?govLabel), "|", STR(YEAR(?govDate))) AS ?govData)
      }
    `;
  }
  else if (klaster === 'Stasiun kereta api') {
    selectClause += `(GROUP_CONCAT(DISTINCT ?jalurLabel; separator=", ") AS ?jalurList) `;
    whereClause += `OPTIONAL { ?site wdt:P81 ?jalurItem . ?jalurItem rdfs:label ?jalurLabel . FILTER(LANG(?jalurLabel) = "id") }`;
  }
  else if (klaster === 'Museum') {
    // Koleksi dimodifikasi agar menarik P1436 ke level node dan mengambil satuannya
    selectClause += `(SAMPLE(?koleksiData) AS ?jumlahKoleksi) (GROUP_CONCAT(DISTINCT ?spesialisasiLabel; separator=", ") AS ?spesialisasiList) `;
    whereClause += `
      OPTIONAL {
        ?site p:P1436 ?koleksiStmt .
        ?koleksiStmt psn:P1436 ?koleksiNode .
        ?koleksiNode wikibase:quantityAmount ?koleksiVal .
        OPTIONAL { 
          ?koleksiNode wikibase:quantityUnit ?koleksiUnitItem . 
          ?koleksiUnitItem rdfs:label ?koleksiUnitLabel . 
          FILTER(LANG(?koleksiUnitLabel) = "id") 
        }
        BIND(CONCAT(STR(?koleksiVal), "|", IF(BOUND(?koleksiUnitLabel), ?koleksiUnitLabel, "")) AS ?koleksiData)
      }
      OPTIONAL { ?site wdt:P101 ?spesialisasiItem . ?spesialisasiItem rdfs:label ?spesialisasiLabel . FILTER(LANG(?spesialisasiLabel) = "id") }
    `;
  }
// ==========================================
  // BLOK 1: PENEMUAN ARKEOLOGI
  // ==========================================
  else if (['Prasasti', 'Situs arkeologi', 'Artefak'].includes(klaster)) {
    // Tanggal temu dimodifikasi mengambil node psv: untuk mendeteksi timePrecision
    selectClause += `(SAMPLE(?tglTemuData) AS ?tglTemu) (SAMPLE(?tempatTemuLabel) AS ?tempatTemu) `;
    whereClause += `
      OPTIONAL {
        ?site p:P575 ?tglTemuStmt .
        ?tglTemuStmt psv:P575 ?tglTemuNode .
        ?tglTemuNode wikibase:timeValue ?tglTemuVal ; 
                     wikibase:timePrecision ?tglTemuPrec .
        BIND(CONCAT(STR(?tglTemuVal), "|", STR(?tglTemuPrec)) AS ?tglTemuData)
      }
      OPTIONAL { ?site wdt:P189 ?tempatTemuItem . ?tempatTemuItem rdfs:label ?tempatTemuLabel . FILTER(LANG(?tempatTemuLabel) = "id") }
    `;
  }
  
  // ==========================================
  // BLOK 2: KARYA & LITERATUR (Kolektor dihapus dari sini)
  // ==========================================
  if (['Prasasti', 'Lontar', 'Naskah', 'Media massa', 'Publikasi', 'Latar karya sastra'].includes(klaster)) {
    selectClause += `(GROUP_CONCAT(DISTINCT ?bhsLabel; separator=", ") AS ?bahasaList) (GROUP_CONCAT(DISTINCT ?bentukLabel; separator=", ") AS ?bentukList) (GROUP_CONCAT(DISTINCT ?penulisLabel; separator=", ") AS ?penulisList) (GROUP_CONCAT(DISTINCT ?subjekLabel; separator=", ") AS ?subjekList) `;
    whereClause += `
      OPTIONAL { ?site wdt:P407 ?bhsItem . ?bhsItem rdfs:label ?bhsLabel . FILTER(LANG(?bhsLabel) = "id") }
      OPTIONAL { ?site wdt:P7937 ?bentukItem . ?bentukItem rdfs:label ?bentukLabel . FILTER(LANG(?bentukLabel) = "id") }
      OPTIONAL { ?site wdt:P50 ?penulisItem . ?penulisItem rdfs:label ?penulisLabel . FILTER(LANG(?penulisLabel) = "id") }
      OPTIONAL { ?site wdt:P921 ?subjekItem . ?subjekItem rdfs:label ?subjekLabel . FILTER(LANG(?subjekLabel) = "id") }
    `;
  }

  // ==========================================
  // BLOK 3: KHUSUS KOLEKSI (Berdiri Sendiri)
  // ==========================================
  if (['Prasasti', 'Situs arkeologi', 'Artefak', 'Lontar', 'Naskah', 'Lukisan'].includes(klaster)) {
    selectClause += `(GROUP_CONCAT(DISTINCT ?kolektorLabel; separator=", ") AS ?kolektorList) `;
    whereClause += `
      OPTIONAL { ?site wdt:P195 ?kolektorItem . ?kolektorItem rdfs:label ?kolektorLabel . FILTER(LANG(?kolektorLabel) = "id") }
    `;
  }

  if (klaster === 'Media massa') {
    selectClause += `(GROUP_CONCAT(DISTINCT ?pemredLabel; separator=", ") AS ?pemredList) (GROUP_CONCAT(DISTINCT ?pendiriLabel; separator=", ") AS ?pendiriList) (SAMPLE(?penerbitLabel) AS ?penerbit) `;
    whereClause += `
      OPTIONAL { ?site wdt:P5769 ?pemredItem . ?pemredItem rdfs:label ?pemredLabel . FILTER(LANG(?pemredLabel) = "id") }
      OPTIONAL { ?site wdt:P112 ?pendiriItem . ?pendiriItem rdfs:label ?pendiriLabel . FILTER(LANG(?pendiriLabel) = "id") }
      OPTIONAL { ?site wdt:P123 ?penerbitItem . ?penerbitItem rdfs:label ?penerbitLabel . FILTER(LANG(?penerbitLabel) = "id") }
    `;
  }
  else if (klaster === 'Hidangan') {
    selectClause += `(GROUP_CONCAT(DISTINCT ?bahanLabel; separator=", ") AS ?bahanList) (GROUP_CONCAT(DISTINCT ?caraLabel; separator=", ") AS ?caraList) `;
    whereClause += `
      OPTIONAL { ?site wdt:P186 ?bahanItem . ?bahanItem rdfs:label ?bahanLabel . FILTER(LANG(?bahanLabel) = "id") }
      OPTIONAL { ?site wdt:P2079 ?caraItem . ?caraItem rdfs:label ?caraLabel . FILTER(LANG(?caraLabel) = "id") }
    `;
  }
  else if (klaster === 'Bahasa') {
    selectClause += `(SAMPLE(?penuturData) AS ?penutur) `;
    whereClause += `
      OPTIONAL {
        ?site p:P1098 ?penuturStmt . ?penuturStmt ps:P1098 ?penuturVal .
        OPTIONAL { ?penuturStmt pq:P585 ?penuturDate . }
        BIND(CONCAT(STR(?penuturVal), "|", STR(YEAR(?penuturDate))) AS ?penuturData)
      }
    `;
  }
  else if (klaster === 'Tokoh') {
    // Tanggal wafat dimodifikasi mengambil node psv: untuk presisi
    selectClause += `(SAMPLE(?wafatData) AS ?tglWafat) (GROUP_CONCAT(DISTINCT ?kerjaLabel; separator=", ") AS ?pekerjaanList) (GROUP_CONCAT(DISTINCT ?ahliLabel; separator=", ") AS ?spesialisasiList) `;
    whereClause += `
      OPTIONAL {
        ?site p:P570 ?wafatStmt .
        ?wafatStmt psv:P570 ?wafatNode .
        ?wafatNode wikibase:timeValue ?wafatVal ; 
                   wikibase:timePrecision ?wafatPrec .
        BIND(CONCAT(STR(?wafatVal), "|", STR(?wafatPrec)) AS ?wafatData)
      }
      OPTIONAL { ?site wdt:P106 ?kerjaItem . ?kerjaItem rdfs:label ?kerjaLabel . FILTER(LANG(?kerjaLabel) = "id") }
      OPTIONAL { ?site wdt:P101 ?ahliItem . ?ahliItem rdfs:label ?ahliLabel . FILTER(LANG(?ahliLabel) = "id") }
    `;
  }
  else if (klaster === 'Gunung') {
    selectClause += `(SAMPLE(?gunungLabel) AS ?pegunungan) `;
    whereClause += `OPTIONAL { ?site wdt:P4552 ?gunungItem . ?gunungItem rdfs:label ?gunungLabel . FILTER(LANG(?gunungLabel) = "id") }`;
  }
  else if (['Gempa bumi', 'Bencana lainnya', 'Peristiwa lainnya', 'Perang & konflik'].includes(klaster)) {
    selectClause += `(SAMPLE(?korbanVal) AS ?korban) `;
    whereClause += `OPTIONAL { ?site wdt:P1120 ?korbanVal . }`;
  }

  return `${selectClause} WHERE { ${whereClause} BIND (SUBSTR(STR(?site), 32) AS ?siteQid) } GROUP BY ?siteQid`;
}

const ABOUT_SPARQL_QUERY = ``;
