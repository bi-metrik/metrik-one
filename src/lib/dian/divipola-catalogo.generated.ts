// GENERADO POR scripts/generar-divipola.ts — NO EDITAR A MANO.
// Fuente: DANE (DIVIPOLA) vía datos.gov.co, dataset gdxc-w37w.
// Municipios: 1122. Nombres que se repiten entre departamentos: 67.
//
// Para actualizar: npx tsx scripts/generar-divipola.ts

/** Nombre de departamento normalizado -> código DANE de 2 dígitos. */
export const DEPARTAMENTOS_DANE: Record<string, string> = {
  "antioquia": "05",
  "atlantico": "08",
  "bogota": "11",
  "bolivar": "13",
  "boyaca": "15",
  "caldas": "17",
  "caqueta": "18",
  "cauca": "19",
  "cesar": "20",
  "cordoba": "23",
  "cundinamarca": "25",
  "choco": "27",
  "huila": "41",
  "la guajira": "44",
  "magdalena": "47",
  "meta": "50",
  "narino": "52",
  "norte de santander": "54",
  "quindio": "63",
  "risaralda": "66",
  "santander": "68",
  "sucre": "70",
  "tolima": "73",
  "valle del cauca": "76",
  "arauca": "81",
  "casanare": "85",
  "putumayo": "86",
  "archipielago de san andres providencia y santa catalina": "88",
  "amazonas": "91",
  "guainia": "94",
  "guaviare": "95",
  "vaupes": "97",
  "vichada": "99"
}

/** Código de departamento -> { nombre de municipio normalizado -> código de 3 dígitos }. */
export const MUNICIPIOS_POR_DEPTO: Record<string, Record<string, string>> = {
  "11": {
    "bogota": "001"
  },
  "13": {
    "cartagena de indias": "001",
    "achi": "006",
    "altos del rosario": "030",
    "arenal": "042",
    "arjona": "052",
    "arroyohondo": "062",
    "barranco de loba": "074",
    "calamar": "140",
    "cantagallo": "160",
    "cicuco": "188",
    "cordoba": "212",
    "clemencia": "222",
    "el carmen de bolivar": "244",
    "el guamo": "248",
    "el penon": "268",
    "hatillo de loba": "300",
    "magangue": "430",
    "mahates": "433",
    "margarita": "440",
    "maria la baja": "442",
    "montecristo": "458",
    "santa cruz de mompox": "468",
    "morales": "473",
    "norosi": "490",
    "pinillos": "549",
    "regidor": "580",
    "rio viejo": "600",
    "san cristobal": "620",
    "san estanislao": "647",
    "san fernando": "650",
    "san jacinto": "654",
    "san jacinto del cauca": "655",
    "san juan nepomuceno": "657",
    "san martin de loba": "667",
    "san pablo": "670",
    "santa catalina": "673",
    "santa rosa": "683",
    "santa rosa del sur": "688",
    "simiti": "744",
    "soplaviento": "760",
    "talaigua nuevo": "780",
    "tiquisio": "810",
    "turbaco": "836",
    "turbana": "838",
    "villanueva": "873",
    "zambrano": "894"
  },
  "15": {
    "tunja": "001",
    "almeida": "022",
    "aquitania": "047",
    "arcabuco": "051",
    "belen": "087",
    "berbeo": "090",
    "beteitiva": "092",
    "boavita": "097",
    "boyaca": "104",
    "briceno": "106",
    "buenavista": "109",
    "busbanza": "114",
    "caldas": "131",
    "campohermoso": "135",
    "cerinza": "162",
    "chinavita": "172",
    "chiquinquira": "176",
    "chiscas": "180",
    "chita": "183",
    "chitaraque": "185",
    "chivata": "187",
    "cienega": "189",
    "combita": "204",
    "coper": "212",
    "corrales": "215",
    "covarachia": "218",
    "cubara": "223",
    "cucaita": "224",
    "cuitiva": "226",
    "chiquiza": "232",
    "chivor": "236",
    "duitama": "238",
    "el cocuy": "244",
    "el espino": "248",
    "firavitoba": "272",
    "floresta": "276",
    "gachantiva": "293",
    "gameza": "296",
    "garagoa": "299",
    "guacamayas": "317",
    "guateque": "322",
    "guayata": "325",
    "guican de la sierra": "332",
    "iza": "362",
    "jenesano": "367",
    "jerico": "368",
    "labranzagrande": "377",
    "la capilla": "380",
    "la victoria": "401",
    "la uvita": "403",
    "villa de leyva": "407",
    "macanal": "425",
    "maripi": "442",
    "miraflores": "455",
    "mongua": "464",
    "mongui": "466",
    "moniquira": "469",
    "motavita": "476",
    "muzo": "480",
    "nobsa": "491",
    "nuevo colon": "494",
    "oicata": "500",
    "otanche": "507",
    "pachavita": "511",
    "paez": "514",
    "paipa": "516",
    "pajarito": "518",
    "panqueba": "522",
    "pauna": "531",
    "paya": "533",
    "paz de rio": "537",
    "pesca": "542",
    "pisba": "550",
    "puerto boyaca": "572",
    "quipama": "580",
    "ramiriqui": "599",
    "raquira": "600",
    "rondon": "621",
    "saboya": "632",
    "sachica": "638",
    "samaca": "646",
    "san eduardo": "660",
    "san jose de pare": "664",
    "san luis de gaceno": "667",
    "san mateo": "673",
    "san miguel de sema": "676",
    "san pablo de borbur": "681",
    "santana": "686",
    "santa maria": "690",
    "santa rosa de viterbo": "693",
    "santa sofia": "696",
    "sativanorte": "720",
    "sativasur": "723",
    "siachoque": "740",
    "soata": "753",
    "socota": "755",
    "socha": "757",
    "sogamoso": "759",
    "somondoco": "761",
    "sora": "762",
    "sotaquira": "763",
    "soraca": "764",
    "susacon": "774",
    "sutamarchan": "776",
    "sutatenza": "778",
    "tasco": "790",
    "tenza": "798",
    "tibana": "804",
    "tibasosa": "806",
    "tinjaca": "808",
    "tipacoque": "810",
    "toca": "814",
    "togui": "816",
    "topaga": "820",
    "tota": "822",
    "tunungua": "832",
    "turmeque": "835",
    "tuta": "837",
    "tutaza": "839",
    "umbita": "842",
    "ventaquemada": "861",
    "viracacha": "879",
    "zetaquira": "897"
  },
  "17": {
    "manizales": "001",
    "aguadas": "013",
    "anserma": "042",
    "aranzazu": "050",
    "belalcazar": "088",
    "chinchina": "174",
    "filadelfia": "272",
    "la dorada": "380",
    "la merced": "388",
    "manzanares": "433",
    "marmato": "442",
    "marquetalia": "444",
    "marulanda": "446",
    "neira": "486",
    "norcasia": "495",
    "pacora": "513",
    "palestina": "524",
    "pensilvania": "541",
    "riosucio": "614",
    "risaralda": "616",
    "salamina": "653",
    "samana": "662",
    "san jose": "665",
    "supia": "777",
    "victoria": "867",
    "villamaria": "873",
    "viterbo": "877"
  },
  "18": {
    "florencia": "001",
    "albania": "029",
    "belen de los andaquies": "094",
    "cartagena del chaira": "150",
    "curillo": "205",
    "el doncello": "247",
    "el paujil": "256",
    "la montanita": "410",
    "milan": "460",
    "morelia": "479",
    "puerto rico": "592",
    "san jose del fragua": "610",
    "san vicente del caguan": "753",
    "solano": "756",
    "solita": "785",
    "valparaiso": "860"
  },
  "19": {
    "popayan": "001",
    "almaguer": "022",
    "argelia": "050",
    "balboa": "075",
    "bolivar": "100",
    "buenos aires": "110",
    "cajibio": "130",
    "caldono": "137",
    "caloto": "142",
    "corinto": "212",
    "el tambo": "256",
    "florencia": "290",
    "guachene": "300",
    "guapi": "318",
    "inza": "355",
    "jambalo": "364",
    "la sierra": "392",
    "la vega": "397",
    "lopez de micay": "418",
    "mercaderes": "450",
    "miranda": "455",
    "morales": "473",
    "padilla": "513",
    "paez": "517",
    "patia": "532",
    "piamonte": "533",
    "piendamo tunia": "548",
    "puerto tejada": "573",
    "purace": "585",
    "rosas": "622",
    "san sebastian": "693",
    "santander de quilichao": "698",
    "santa rosa": "701",
    "silvia": "743",
    "sotara paispamba": "760",
    "suarez": "780",
    "sucre": "785",
    "timbio": "807",
    "timbiqui": "809",
    "toribio": "821",
    "totoro": "824",
    "villa rica": "845"
  },
  "20": {
    "valledupar": "001",
    "aguachica": "011",
    "agustin codazzi": "013",
    "astrea": "032",
    "becerril": "045",
    "bosconia": "060",
    "chimichagua": "175",
    "chiriguana": "178",
    "curumani": "228",
    "el copey": "238",
    "el paso": "250",
    "gamarra": "295",
    "gonzalez": "310",
    "la gloria": "383",
    "la jagua de ibirico": "400",
    "manaure balcon del cesar": "443",
    "pailitas": "517",
    "pelaya": "550",
    "pueblo bello": "570",
    "rio de oro": "614",
    "la paz": "621",
    "san alberto": "710",
    "san diego": "750",
    "san martin": "770",
    "tamalameque": "787"
  },
  "23": {
    "monteria": "001",
    "ayapel": "068",
    "buenavista": "079",
    "canalete": "090",
    "cerete": "162",
    "chima": "168",
    "chinu": "182",
    "cienaga de oro": "189",
    "cotorra": "300",
    "la apartada": "350",
    "lorica": "417",
    "los cordobas": "419",
    "momil": "464",
    "montelibano": "466",
    "monitos": "500",
    "planeta rica": "555",
    "pueblo nuevo": "570",
    "puerto escondido": "574",
    "puerto libertador": "580",
    "purisima de la concepcion": "586",
    "sahagun": "660",
    "san andres de sotavento": "670",
    "san antero": "672",
    "san bernardo del viento": "675",
    "san carlos": "678",
    "san jose de ure": "682",
    "san pelayo": "686",
    "tierralta": "807",
    "tuchin": "815",
    "valencia": "855"
  },
  "25": {
    "agua de dios": "001",
    "alban": "019",
    "anapoima": "035",
    "anolaima": "040",
    "arbelaez": "053",
    "beltran": "086",
    "bituima": "095",
    "bojaca": "099",
    "cabrera": "120",
    "cachipay": "123",
    "cajica": "126",
    "caparrapi": "148",
    "caqueza": "151",
    "carmen de carupa": "154",
    "chaguani": "168",
    "chia": "175",
    "chipaque": "178",
    "choachi": "181",
    "choconta": "183",
    "cogua": "200",
    "cota": "214",
    "cucunuba": "224",
    "el colegio": "245",
    "el penon": "258",
    "el rosal": "260",
    "facatativa": "269",
    "fomeque": "279",
    "fosca": "281",
    "funza": "286",
    "fuquene": "288",
    "fusagasuga": "290",
    "gachala": "293",
    "gachancipa": "295",
    "gacheta": "297",
    "gama": "299",
    "girardot": "307",
    "granada": "312",
    "guacheta": "317",
    "guaduas": "320",
    "guasca": "322",
    "guataqui": "324",
    "guatavita": "326",
    "guayabal de siquima": "328",
    "guayabetal": "335",
    "gutierrez": "339",
    "jerusalen": "368",
    "junin": "372",
    "la calera": "377",
    "la mesa": "386",
    "la palma": "394",
    "la pena": "398",
    "la vega": "402",
    "lenguazaque": "407",
    "macheta": "426",
    "madrid": "430",
    "manta": "436",
    "medina": "438",
    "mosquera": "473",
    "narino": "483",
    "nemocon": "486",
    "nilo": "488",
    "nimaima": "489",
    "nocaima": "491",
    "venecia": "506",
    "pacho": "513",
    "paime": "518",
    "pandi": "524",
    "paratebueno": "530",
    "pasca": "535",
    "puerto salgar": "572",
    "puli": "580",
    "quebradanegra": "592",
    "quetame": "594",
    "quipile": "596",
    "apulo": "599",
    "ricaurte": "612",
    "san antonio del tequendama": "645",
    "san bernardo": "649",
    "san cayetano": "653",
    "san francisco": "658",
    "san juan de rioseco": "662",
    "sasaima": "718",
    "sesquile": "736",
    "sibate": "740",
    "silvania": "743",
    "simijaca": "745",
    "soacha": "754",
    "sopo": "758",
    "subachoque": "769",
    "suesca": "772",
    "supata": "777",
    "susa": "779",
    "sutatausa": "781",
    "tabio": "785",
    "tausa": "793",
    "tena": "797",
    "tenjo": "799",
    "tibacuy": "805",
    "tibirita": "807",
    "tocaima": "815",
    "tocancipa": "817",
    "topaipi": "823",
    "ubala": "839",
    "ubaque": "841",
    "villa de san diego de ubate": "843",
    "une": "845",
    "utica": "851",
    "vergara": "862",
    "viani": "867",
    "villagomez": "871",
    "villapinzon": "873",
    "villeta": "875",
    "viota": "878",
    "yacopi": "885",
    "zipacon": "898",
    "zipaquira": "899"
  },
  "27": {
    "quibdo": "001",
    "acandi": "006",
    "alto baudo": "025",
    "atrato": "050",
    "bagado": "073",
    "bahia solano": "075",
    "bajo baudo": "077",
    "bojaya": "099",
    "el canton del san pablo": "135",
    "carmen del darien": "150",
    "certegui": "160",
    "condoto": "205",
    "el carmen de atrato": "245",
    "el litoral del san juan": "250",
    "istmina": "361",
    "jurado": "372",
    "lloro": "413",
    "medio atrato": "425",
    "medio baudo": "430",
    "medio san juan": "450",
    "novita": "491",
    "nuevo belen de bajira": "493",
    "nuqui": "495",
    "rio iro": "580",
    "rio quito": "600",
    "riosucio": "615",
    "san jose del palmar": "660",
    "sipi": "745",
    "tado": "787",
    "unguia": "800",
    "union panamericana": "810"
  },
  "41": {
    "neiva": "001",
    "acevedo": "006",
    "agrado": "013",
    "aipe": "016",
    "algeciras": "020",
    "altamira": "026",
    "baraya": "078",
    "campoalegre": "132",
    "colombia": "206",
    "elias": "244",
    "garzon": "298",
    "gigante": "306",
    "guadalupe": "319",
    "hobo": "349",
    "iquira": "357",
    "isnos": "359",
    "la argentina": "378",
    "la plata": "396",
    "nataga": "483",
    "oporapa": "503",
    "paicol": "518",
    "palermo": "524",
    "palestina": "530",
    "pital": "548",
    "pitalito": "551",
    "rivera": "615",
    "saladoblanco": "660",
    "san agustin": "668",
    "santa maria": "676",
    "suaza": "770",
    "tarqui": "791",
    "tesalia": "797",
    "tello": "799",
    "teruel": "801",
    "timana": "807",
    "villavieja": "872",
    "yaguara": "885"
  },
  "44": {
    "riohacha": "001",
    "albania": "035",
    "barrancas": "078",
    "dibulla": "090",
    "distraccion": "098",
    "el molino": "110",
    "fonseca": "279",
    "hatonuevo": "378",
    "la jagua del pilar": "420",
    "maicao": "430",
    "manaure": "560",
    "san juan del cesar": "650",
    "uribia": "847",
    "urumita": "855",
    "villanueva": "874"
  },
  "47": {
    "santa marta": "001",
    "algarrobo": "030",
    "aracataca": "053",
    "ariguani": "058",
    "cerro de san antonio": "161",
    "chivolo": "170",
    "cienaga": "189",
    "concordia": "205",
    "el banco": "245",
    "el pinon": "258",
    "el reten": "268",
    "fundacion": "288",
    "guamal": "318",
    "nueva granada": "460",
    "pedraza": "541",
    "pijino del carmen": "545",
    "pivijay": "551",
    "plato": "555",
    "puebloviejo": "570",
    "remolino": "605",
    "sabanas de san angel": "660",
    "salamina": "675",
    "san sebastian de buenavista": "692",
    "san zenon": "703",
    "santa ana": "707",
    "santa barbara de pinto": "720",
    "sitionuevo": "745",
    "tenerife": "798",
    "zapayan": "960",
    "zona bananera": "980"
  },
  "50": {
    "villavicencio": "001",
    "acacias": "006",
    "barranca de upia": "110",
    "cabuyaro": "124",
    "castilla la nueva": "150",
    "cubarral": "223",
    "cumaral": "226",
    "el calvario": "245",
    "el castillo": "251",
    "el dorado": "270",
    "fuente de oro": "287",
    "granada": "313",
    "guamal": "318",
    "mapiripan": "325",
    "mesetas": "330",
    "la macarena": "350",
    "uribe": "370",
    "lejanias": "400",
    "puerto concordia": "450",
    "puerto gaitan": "568",
    "puerto lopez": "573",
    "puerto lleras": "577",
    "puerto rico": "590",
    "restrepo": "606",
    "san carlos de guaroa": "680",
    "san juan de arama": "683",
    "san juanito": "686",
    "san martin": "689",
    "vistahermosa": "711"
  },
  "52": {
    "pasto": "001",
    "alban": "019",
    "aldana": "022",
    "ancuya": "036",
    "arboleda": "051",
    "barbacoas": "079",
    "belen": "083",
    "buesaco": "110",
    "colon": "203",
    "consaca": "207",
    "contadero": "210",
    "cordoba": "215",
    "cuaspud carlosama": "224",
    "cumbal": "227",
    "cumbitara": "233",
    "chachagui": "240",
    "el charco": "250",
    "el penol": "254",
    "el rosario": "256",
    "el tablon de gomez": "258",
    "el tambo": "260",
    "funes": "287",
    "guachucal": "317",
    "guaitarilla": "320",
    "gualmatan": "323",
    "iles": "352",
    "imues": "354",
    "ipiales": "356",
    "la cruz": "378",
    "la florida": "381",
    "la llanada": "385",
    "la tola": "390",
    "la union": "399",
    "leiva": "405",
    "linares": "411",
    "los andes": "418",
    "magui": "427",
    "mallama": "435",
    "mosquera": "473",
    "narino": "480",
    "olaya herrera": "490",
    "ospina": "506",
    "francisco pizarro": "520",
    "policarpa": "540",
    "potosi": "560",
    "providencia": "565",
    "puerres": "573",
    "pupiales": "585",
    "ricaurte": "612",
    "roberto payan": "621",
    "samaniego": "678",
    "sandona": "683",
    "san bernardo": "685",
    "san lorenzo": "687",
    "san pablo": "693",
    "san pedro de cartago": "694",
    "santa barbara": "696",
    "santacruz": "699",
    "sapuyes": "720",
    "taminango": "786",
    "tangua": "788",
    "san andres de tumaco": "835",
    "tuquerres": "838",
    "yacuanquer": "885"
  },
  "54": {
    "san jose de cucuta": "001",
    "abrego": "003",
    "arboledas": "051",
    "bochalema": "099",
    "bucarasica": "109",
    "cacota": "125",
    "cachira": "128",
    "chinacota": "172",
    "chitaga": "174",
    "convencion": "206",
    "cucutilla": "223",
    "durania": "239",
    "el carmen": "245",
    "el tarra": "250",
    "el zulia": "261",
    "gramalote": "313",
    "hacari": "344",
    "herran": "347",
    "labateca": "377",
    "la esperanza": "385",
    "la playa": "398",
    "los patios": "405",
    "lourdes": "418",
    "mutiscua": "480",
    "ocana": "498",
    "pamplona": "518",
    "pamplonita": "520",
    "puerto santander": "553",
    "ragonvalia": "599",
    "salazar": "660",
    "san calixto": "670",
    "san cayetano": "673",
    "santiago": "680",
    "sardinata": "720",
    "silos": "743",
    "teorama": "800",
    "tibu": "810",
    "toledo": "820",
    "villa caro": "871",
    "villa del rosario": "874"
  },
  "63": {
    "armenia": "001",
    "buenavista": "111",
    "calarca": "130",
    "circasia": "190",
    "cordoba": "212",
    "filandia": "272",
    "genova": "302",
    "la tebaida": "401",
    "montenegro": "470",
    "pijao": "548",
    "quimbaya": "594",
    "salento": "690"
  },
  "66": {
    "pereira": "001",
    "apia": "045",
    "balboa": "075",
    "belen de umbria": "088",
    "dosquebradas": "170",
    "guatica": "318",
    "la celia": "383",
    "la virginia": "400",
    "marsella": "440",
    "mistrato": "456",
    "pueblo rico": "572",
    "quinchia": "594",
    "santa rosa de cabal": "682",
    "santuario": "687"
  },
  "68": {
    "bucaramanga": "001",
    "aguada": "013",
    "albania": "020",
    "aratoca": "051",
    "barbosa": "077",
    "barichara": "079",
    "barrancabermeja": "081",
    "betulia": "092",
    "bolivar": "101",
    "cabrera": "121",
    "california": "132",
    "capitanejo": "147",
    "carcasi": "152",
    "cepita": "160",
    "cerrito": "162",
    "charala": "167",
    "charta": "169",
    "chima": "176",
    "chipata": "179",
    "cimitarra": "190",
    "concepcion": "207",
    "confines": "209",
    "contratacion": "211",
    "coromoro": "217",
    "curiti": "229",
    "el carmen de chucuri": "235",
    "el guacamayo": "245",
    "el penon": "250",
    "el playon": "255",
    "encino": "264",
    "enciso": "266",
    "florian": "271",
    "floridablanca": "276",
    "galan": "296",
    "gambita": "298",
    "giron": "307",
    "guaca": "318",
    "guadalupe": "320",
    "guapota": "322",
    "guavata": "324",
    "guepsa": "327",
    "hato": "344",
    "jesus maria": "368",
    "jordan": "370",
    "la belleza": "377",
    "landazuri": "385",
    "la paz": "397",
    "lebrija": "406",
    "los santos": "418",
    "macaravita": "425",
    "malaga": "432",
    "matanza": "444",
    "mogotes": "464",
    "molagavita": "468",
    "ocamonte": "498",
    "oiba": "500",
    "onzaga": "502",
    "palmar": "522",
    "palmas del socorro": "524",
    "paramo": "533",
    "piedecuesta": "547",
    "pinchote": "549",
    "puente nacional": "572",
    "puerto parra": "573",
    "puerto wilches": "575",
    "rionegro": "615",
    "sabana de torres": "655",
    "san andres": "669",
    "san benito": "673",
    "san gil": "679",
    "san joaquin": "682",
    "san jose de miranda": "684",
    "san miguel": "686",
    "san vicente de chucuri": "689",
    "santa barbara": "705",
    "santa helena del opon": "720",
    "simacota": "745",
    "socorro": "755",
    "suaita": "770",
    "sucre": "773",
    "surata": "780",
    "tona": "820",
    "valle de san jose": "855",
    "velez": "861",
    "vetas": "867",
    "villanueva": "872",
    "zapatoca": "895"
  },
  "70": {
    "sincelejo": "001",
    "buenavista": "110",
    "caimito": "124",
    "coloso": "204",
    "corozal": "215",
    "covenas": "221",
    "chalan": "230",
    "el roble": "233",
    "galeras": "235",
    "guaranda": "265",
    "la union": "400",
    "los palmitos": "418",
    "majagual": "429",
    "morroa": "473",
    "ovejas": "508",
    "palmito": "523",
    "sampues": "670",
    "san benito abad": "678",
    "san juan de betulia": "702",
    "san marcos": "708",
    "san onofre": "713",
    "san pedro": "717",
    "san luis de since": "742",
    "sucre": "771",
    "santiago de tolu": "820",
    "san jose de toluviejo": "823"
  },
  "73": {
    "ibague": "001",
    "alpujarra": "024",
    "alvarado": "026",
    "ambalema": "030",
    "anzoategui": "043",
    "armero": "055",
    "ataco": "067",
    "cajamarca": "124",
    "carmen de apicala": "148",
    "casabianca": "152",
    "chaparral": "168",
    "coello": "200",
    "coyaima": "217",
    "cunday": "226",
    "dolores": "236",
    "espinal": "268",
    "falan": "270",
    "flandes": "275",
    "fresno": "283",
    "guamo": "319",
    "herveo": "347",
    "honda": "349",
    "icononzo": "352",
    "lerida": "408",
    "libano": "411",
    "san sebastian de mariquita": "443",
    "melgar": "449",
    "murillo": "461",
    "natagaima": "483",
    "ortega": "504",
    "palocabildo": "520",
    "piedras": "547",
    "planadas": "555",
    "prado": "563",
    "purificacion": "585",
    "rioblanco": "616",
    "roncesvalles": "622",
    "rovira": "624",
    "saldana": "671",
    "san antonio": "675",
    "san luis": "678",
    "santa isabel": "686",
    "suarez": "770",
    "valle de san juan": "854",
    "venadillo": "861",
    "villahermosa": "870",
    "villarrica": "873"
  },
  "76": {
    "santiago de cali": "001",
    "alcala": "020",
    "andalucia": "036",
    "ansermanuevo": "041",
    "argelia": "054",
    "bolivar": "100",
    "buenaventura": "109",
    "guadalajara de buga": "111",
    "bugalagrande": "113",
    "caicedonia": "122",
    "calima": "126",
    "candelaria": "130",
    "cartago": "147",
    "dagua": "233",
    "el aguila": "243",
    "el cairo": "246",
    "el cerrito": "248",
    "el dovio": "250",
    "florida": "275",
    "ginebra": "306",
    "guacari": "318",
    "jamundi": "364",
    "la cumbre": "377",
    "la union": "400",
    "la victoria": "403",
    "obando": "497",
    "palmira": "520",
    "pradera": "563",
    "restrepo": "606",
    "riofrio": "616",
    "roldanillo": "622",
    "san pedro": "670",
    "sevilla": "736",
    "toro": "823",
    "trujillo": "828",
    "tulua": "834",
    "ulloa": "845",
    "versalles": "863",
    "vijes": "869",
    "yotoco": "890",
    "yumbo": "892",
    "zarzal": "895"
  },
  "81": {
    "arauca": "001",
    "arauquita": "065",
    "cravo norte": "220",
    "fortul": "300",
    "puerto rondon": "591",
    "saravena": "736",
    "tame": "794"
  },
  "85": {
    "yopal": "001",
    "aguazul": "010",
    "chameza": "015",
    "hato corozal": "125",
    "la salina": "136",
    "mani": "139",
    "monterrey": "162",
    "nunchia": "225",
    "orocue": "230",
    "paz de ariporo": "250",
    "pore": "263",
    "recetor": "279",
    "sabanalarga": "300",
    "sacama": "315",
    "san luis de palenque": "325",
    "tamara": "400",
    "tauramena": "410",
    "trinidad": "430",
    "villanueva": "440"
  },
  "86": {
    "mocoa": "001",
    "colon": "219",
    "orito": "320",
    "puerto asis": "568",
    "puerto caicedo": "569",
    "puerto guzman": "571",
    "puerto leguizamo": "573",
    "sibundoy": "749",
    "san francisco": "755",
    "san miguel": "757",
    "santiago": "760",
    "valle del guamuez": "865",
    "villagarzon": "885"
  },
  "88": {
    "san andres": "001",
    "providencia": "564"
  },
  "91": {
    "leticia": "001",
    "el encanto": "263",
    "la chorrera": "405",
    "la pedrera": "407",
    "la victoria": "430",
    "miriti parana": "460",
    "puerto alegria": "530",
    "puerto arica": "536",
    "puerto narino": "540",
    "puerto santander": "669",
    "tarapaca": "798"
  },
  "94": {
    "inirida": "001",
    "barrancominas": "343",
    "san felipe": "883",
    "puerto colombia": "884",
    "la guadalupe": "885",
    "cacahual": "886",
    "pana pana": "887",
    "morichal": "888"
  },
  "95": {
    "san jose del guaviare": "001",
    "calamar": "015",
    "el retorno": "025",
    "miraflores": "200"
  },
  "97": {
    "mitu": "001",
    "caruru": "161",
    "pacoa": "511",
    "taraira": "666",
    "papunahua": "777",
    "yavarate": "889"
  },
  "99": {
    "puerto carreno": "001",
    "la primavera": "524",
    "santa rosalia": "624",
    "cumaribo": "773"
  },
  "05": {
    "medellin": "001",
    "abejorral": "002",
    "abriaqui": "004",
    "alejandria": "021",
    "amaga": "030",
    "amalfi": "031",
    "andes": "034",
    "angelopolis": "036",
    "angostura": "038",
    "anori": "040",
    "santa fe de antioquia": "042",
    "anza": "044",
    "apartado": "045",
    "arboletes": "051",
    "argelia": "055",
    "armenia": "059",
    "barbosa": "079",
    "belmira": "086",
    "bello": "088",
    "betania": "091",
    "betulia": "093",
    "ciudad bolivar": "101",
    "briceno": "107",
    "buritica": "113",
    "caceres": "120",
    "caicedo": "125",
    "caldas": "129",
    "campamento": "134",
    "canasgordas": "138",
    "caracoli": "142",
    "caramanta": "145",
    "carepa": "147",
    "el carmen de viboral": "148",
    "carolina": "150",
    "caucasia": "154",
    "chigorodo": "172",
    "cisneros": "190",
    "cocorna": "197",
    "concepcion": "206",
    "concordia": "209",
    "copacabana": "212",
    "dabeiba": "234",
    "donmatias": "237",
    "ebejico": "240",
    "el bagre": "250",
    "entrerrios": "264",
    "envigado": "266",
    "fredonia": "282",
    "frontino": "284",
    "giraldo": "306",
    "girardota": "308",
    "gomez plata": "310",
    "granada": "313",
    "guadalupe": "315",
    "guarne": "318",
    "guatape": "321",
    "heliconia": "347",
    "hispania": "353",
    "itagui": "360",
    "ituango": "361",
    "jardin": "364",
    "jerico": "368",
    "la ceja": "376",
    "la estrella": "380",
    "la pintada": "390",
    "la union": "400",
    "liborina": "411",
    "maceo": "425",
    "marinilla": "440",
    "montebello": "467",
    "murindo": "475",
    "mutata": "480",
    "narino": "483",
    "necocli": "490",
    "nechi": "495",
    "olaya": "501",
    "penol": "541",
    "peque": "543",
    "pueblorrico": "576",
    "puerto berrio": "579",
    "puerto nare": "585",
    "puerto triunfo": "591",
    "remedios": "604",
    "retiro": "607",
    "rionegro": "615",
    "sabanalarga": "628",
    "sabaneta": "631",
    "salgar": "642",
    "san andres de cuerquia": "647",
    "san carlos": "649",
    "san francisco": "652",
    "san jeronimo": "656",
    "san jose de la montana": "658",
    "san juan de uraba": "659",
    "san luis": "660",
    "san pedro de los milagros": "664",
    "san pedro de uraba": "665",
    "san rafael": "667",
    "san roque": "670",
    "san vicente ferrer": "674",
    "santa barbara": "679",
    "santa rosa de osos": "686",
    "santo domingo": "690",
    "el santuario": "697",
    "segovia": "736",
    "sonson": "756",
    "sopetran": "761",
    "tamesis": "789",
    "taraza": "790",
    "tarso": "792",
    "titiribi": "809",
    "toledo": "819",
    "turbo": "837",
    "uramita": "842",
    "urrao": "847",
    "valdivia": "854",
    "valparaiso": "856",
    "vegachi": "858",
    "venecia": "861",
    "vigia del fuerte": "873",
    "yali": "885",
    "yarumal": "887",
    "yolombo": "890",
    "yondo": "893",
    "zaragoza": "895"
  },
  "08": {
    "barranquilla": "001",
    "baranoa": "078",
    "campo de la cruz": "137",
    "candelaria": "141",
    "galapa": "296",
    "juan de acosta": "372",
    "luruaco": "421",
    "malambo": "433",
    "manati": "436",
    "palmar de varela": "520",
    "piojo": "549",
    "polonuevo": "558",
    "ponedera": "560",
    "puerto colombia": "573",
    "repelon": "606",
    "sabanagrande": "634",
    "sabanalarga": "638",
    "santa lucia": "675",
    "santo tomas": "685",
    "soledad": "758",
    "suan": "770",
    "tubara": "832",
    "usiacuri": "849"
  }
}

/**
 * Municipios cuyo nombre es único en todo el país. Solo estos se pueden resolver
 * sin conocer el departamento; los homónimos quedan fuera a propósito.
 */
export const MUNICIPIOS_UNICOS: Record<string, { dep: string; mun: string }> = {
  "medellin": {
    "dep": "05",
    "mun": "001"
  },
  "abejorral": {
    "dep": "05",
    "mun": "002"
  },
  "abriaqui": {
    "dep": "05",
    "mun": "004"
  },
  "alejandria": {
    "dep": "05",
    "mun": "021"
  },
  "amaga": {
    "dep": "05",
    "mun": "030"
  },
  "amalfi": {
    "dep": "05",
    "mun": "031"
  },
  "andes": {
    "dep": "05",
    "mun": "034"
  },
  "angelopolis": {
    "dep": "05",
    "mun": "036"
  },
  "angostura": {
    "dep": "05",
    "mun": "038"
  },
  "anori": {
    "dep": "05",
    "mun": "040"
  },
  "santa fe de antioquia": {
    "dep": "05",
    "mun": "042"
  },
  "anza": {
    "dep": "05",
    "mun": "044"
  },
  "apartado": {
    "dep": "05",
    "mun": "045"
  },
  "arboletes": {
    "dep": "05",
    "mun": "051"
  },
  "belmira": {
    "dep": "05",
    "mun": "086"
  },
  "bello": {
    "dep": "05",
    "mun": "088"
  },
  "betania": {
    "dep": "05",
    "mun": "091"
  },
  "ciudad bolivar": {
    "dep": "05",
    "mun": "101"
  },
  "buritica": {
    "dep": "05",
    "mun": "113"
  },
  "caceres": {
    "dep": "05",
    "mun": "120"
  },
  "caicedo": {
    "dep": "05",
    "mun": "125"
  },
  "campamento": {
    "dep": "05",
    "mun": "134"
  },
  "canasgordas": {
    "dep": "05",
    "mun": "138"
  },
  "caracoli": {
    "dep": "05",
    "mun": "142"
  },
  "caramanta": {
    "dep": "05",
    "mun": "145"
  },
  "carepa": {
    "dep": "05",
    "mun": "147"
  },
  "el carmen de viboral": {
    "dep": "05",
    "mun": "148"
  },
  "carolina": {
    "dep": "05",
    "mun": "150"
  },
  "caucasia": {
    "dep": "05",
    "mun": "154"
  },
  "chigorodo": {
    "dep": "05",
    "mun": "172"
  },
  "cisneros": {
    "dep": "05",
    "mun": "190"
  },
  "cocorna": {
    "dep": "05",
    "mun": "197"
  },
  "copacabana": {
    "dep": "05",
    "mun": "212"
  },
  "dabeiba": {
    "dep": "05",
    "mun": "234"
  },
  "donmatias": {
    "dep": "05",
    "mun": "237"
  },
  "ebejico": {
    "dep": "05",
    "mun": "240"
  },
  "el bagre": {
    "dep": "05",
    "mun": "250"
  },
  "entrerrios": {
    "dep": "05",
    "mun": "264"
  },
  "envigado": {
    "dep": "05",
    "mun": "266"
  },
  "fredonia": {
    "dep": "05",
    "mun": "282"
  },
  "frontino": {
    "dep": "05",
    "mun": "284"
  },
  "giraldo": {
    "dep": "05",
    "mun": "306"
  },
  "girardota": {
    "dep": "05",
    "mun": "308"
  },
  "gomez plata": {
    "dep": "05",
    "mun": "310"
  },
  "guarne": {
    "dep": "05",
    "mun": "318"
  },
  "guatape": {
    "dep": "05",
    "mun": "321"
  },
  "heliconia": {
    "dep": "05",
    "mun": "347"
  },
  "hispania": {
    "dep": "05",
    "mun": "353"
  },
  "itagui": {
    "dep": "05",
    "mun": "360"
  },
  "ituango": {
    "dep": "05",
    "mun": "361"
  },
  "jardin": {
    "dep": "05",
    "mun": "364"
  },
  "la ceja": {
    "dep": "05",
    "mun": "376"
  },
  "la estrella": {
    "dep": "05",
    "mun": "380"
  },
  "la pintada": {
    "dep": "05",
    "mun": "390"
  },
  "liborina": {
    "dep": "05",
    "mun": "411"
  },
  "maceo": {
    "dep": "05",
    "mun": "425"
  },
  "marinilla": {
    "dep": "05",
    "mun": "440"
  },
  "montebello": {
    "dep": "05",
    "mun": "467"
  },
  "murindo": {
    "dep": "05",
    "mun": "475"
  },
  "mutata": {
    "dep": "05",
    "mun": "480"
  },
  "necocli": {
    "dep": "05",
    "mun": "490"
  },
  "nechi": {
    "dep": "05",
    "mun": "495"
  },
  "olaya": {
    "dep": "05",
    "mun": "501"
  },
  "penol": {
    "dep": "05",
    "mun": "541"
  },
  "peque": {
    "dep": "05",
    "mun": "543"
  },
  "pueblorrico": {
    "dep": "05",
    "mun": "576"
  },
  "puerto berrio": {
    "dep": "05",
    "mun": "579"
  },
  "puerto nare": {
    "dep": "05",
    "mun": "585"
  },
  "puerto triunfo": {
    "dep": "05",
    "mun": "591"
  },
  "remedios": {
    "dep": "05",
    "mun": "604"
  },
  "retiro": {
    "dep": "05",
    "mun": "607"
  },
  "sabaneta": {
    "dep": "05",
    "mun": "631"
  },
  "salgar": {
    "dep": "05",
    "mun": "642"
  },
  "san andres de cuerquia": {
    "dep": "05",
    "mun": "647"
  },
  "san jeronimo": {
    "dep": "05",
    "mun": "656"
  },
  "san jose de la montana": {
    "dep": "05",
    "mun": "658"
  },
  "san juan de uraba": {
    "dep": "05",
    "mun": "659"
  },
  "san pedro de los milagros": {
    "dep": "05",
    "mun": "664"
  },
  "san pedro de uraba": {
    "dep": "05",
    "mun": "665"
  },
  "san rafael": {
    "dep": "05",
    "mun": "667"
  },
  "san roque": {
    "dep": "05",
    "mun": "670"
  },
  "san vicente ferrer": {
    "dep": "05",
    "mun": "674"
  },
  "santa rosa de osos": {
    "dep": "05",
    "mun": "686"
  },
  "santo domingo": {
    "dep": "05",
    "mun": "690"
  },
  "el santuario": {
    "dep": "05",
    "mun": "697"
  },
  "segovia": {
    "dep": "05",
    "mun": "736"
  },
  "sonson": {
    "dep": "05",
    "mun": "756"
  },
  "sopetran": {
    "dep": "05",
    "mun": "761"
  },
  "tamesis": {
    "dep": "05",
    "mun": "789"
  },
  "taraza": {
    "dep": "05",
    "mun": "790"
  },
  "tarso": {
    "dep": "05",
    "mun": "792"
  },
  "titiribi": {
    "dep": "05",
    "mun": "809"
  },
  "turbo": {
    "dep": "05",
    "mun": "837"
  },
  "uramita": {
    "dep": "05",
    "mun": "842"
  },
  "urrao": {
    "dep": "05",
    "mun": "847"
  },
  "valdivia": {
    "dep": "05",
    "mun": "854"
  },
  "vegachi": {
    "dep": "05",
    "mun": "858"
  },
  "vigia del fuerte": {
    "dep": "05",
    "mun": "873"
  },
  "yali": {
    "dep": "05",
    "mun": "885"
  },
  "yarumal": {
    "dep": "05",
    "mun": "887"
  },
  "yolombo": {
    "dep": "05",
    "mun": "890"
  },
  "yondo": {
    "dep": "05",
    "mun": "893"
  },
  "zaragoza": {
    "dep": "05",
    "mun": "895"
  },
  "barranquilla": {
    "dep": "08",
    "mun": "001"
  },
  "baranoa": {
    "dep": "08",
    "mun": "078"
  },
  "campo de la cruz": {
    "dep": "08",
    "mun": "137"
  },
  "galapa": {
    "dep": "08",
    "mun": "296"
  },
  "juan de acosta": {
    "dep": "08",
    "mun": "372"
  },
  "luruaco": {
    "dep": "08",
    "mun": "421"
  },
  "malambo": {
    "dep": "08",
    "mun": "433"
  },
  "manati": {
    "dep": "08",
    "mun": "436"
  },
  "palmar de varela": {
    "dep": "08",
    "mun": "520"
  },
  "piojo": {
    "dep": "08",
    "mun": "549"
  },
  "polonuevo": {
    "dep": "08",
    "mun": "558"
  },
  "ponedera": {
    "dep": "08",
    "mun": "560"
  },
  "repelon": {
    "dep": "08",
    "mun": "606"
  },
  "sabanagrande": {
    "dep": "08",
    "mun": "634"
  },
  "santa lucia": {
    "dep": "08",
    "mun": "675"
  },
  "santo tomas": {
    "dep": "08",
    "mun": "685"
  },
  "soledad": {
    "dep": "08",
    "mun": "758"
  },
  "suan": {
    "dep": "08",
    "mun": "770"
  },
  "tubara": {
    "dep": "08",
    "mun": "832"
  },
  "usiacuri": {
    "dep": "08",
    "mun": "849"
  },
  "bogota": {
    "dep": "11",
    "mun": "001"
  },
  "cartagena de indias": {
    "dep": "13",
    "mun": "001"
  },
  "achi": {
    "dep": "13",
    "mun": "006"
  },
  "altos del rosario": {
    "dep": "13",
    "mun": "030"
  },
  "arenal": {
    "dep": "13",
    "mun": "042"
  },
  "arjona": {
    "dep": "13",
    "mun": "052"
  },
  "arroyohondo": {
    "dep": "13",
    "mun": "062"
  },
  "barranco de loba": {
    "dep": "13",
    "mun": "074"
  },
  "cantagallo": {
    "dep": "13",
    "mun": "160"
  },
  "cicuco": {
    "dep": "13",
    "mun": "188"
  },
  "clemencia": {
    "dep": "13",
    "mun": "222"
  },
  "el carmen de bolivar": {
    "dep": "13",
    "mun": "244"
  },
  "el guamo": {
    "dep": "13",
    "mun": "248"
  },
  "hatillo de loba": {
    "dep": "13",
    "mun": "300"
  },
  "magangue": {
    "dep": "13",
    "mun": "430"
  },
  "mahates": {
    "dep": "13",
    "mun": "433"
  },
  "margarita": {
    "dep": "13",
    "mun": "440"
  },
  "maria la baja": {
    "dep": "13",
    "mun": "442"
  },
  "montecristo": {
    "dep": "13",
    "mun": "458"
  },
  "santa cruz de mompox": {
    "dep": "13",
    "mun": "468"
  },
  "norosi": {
    "dep": "13",
    "mun": "490"
  },
  "pinillos": {
    "dep": "13",
    "mun": "549"
  },
  "regidor": {
    "dep": "13",
    "mun": "580"
  },
  "rio viejo": {
    "dep": "13",
    "mun": "600"
  },
  "san cristobal": {
    "dep": "13",
    "mun": "620"
  },
  "san estanislao": {
    "dep": "13",
    "mun": "647"
  },
  "san fernando": {
    "dep": "13",
    "mun": "650"
  },
  "san jacinto": {
    "dep": "13",
    "mun": "654"
  },
  "san jacinto del cauca": {
    "dep": "13",
    "mun": "655"
  },
  "san juan nepomuceno": {
    "dep": "13",
    "mun": "657"
  },
  "san martin de loba": {
    "dep": "13",
    "mun": "667"
  },
  "santa catalina": {
    "dep": "13",
    "mun": "673"
  },
  "santa rosa del sur": {
    "dep": "13",
    "mun": "688"
  },
  "simiti": {
    "dep": "13",
    "mun": "744"
  },
  "soplaviento": {
    "dep": "13",
    "mun": "760"
  },
  "talaigua nuevo": {
    "dep": "13",
    "mun": "780"
  },
  "tiquisio": {
    "dep": "13",
    "mun": "810"
  },
  "turbaco": {
    "dep": "13",
    "mun": "836"
  },
  "turbana": {
    "dep": "13",
    "mun": "838"
  },
  "zambrano": {
    "dep": "13",
    "mun": "894"
  },
  "tunja": {
    "dep": "15",
    "mun": "001"
  },
  "almeida": {
    "dep": "15",
    "mun": "022"
  },
  "aquitania": {
    "dep": "15",
    "mun": "047"
  },
  "arcabuco": {
    "dep": "15",
    "mun": "051"
  },
  "berbeo": {
    "dep": "15",
    "mun": "090"
  },
  "beteitiva": {
    "dep": "15",
    "mun": "092"
  },
  "boavita": {
    "dep": "15",
    "mun": "097"
  },
  "boyaca": {
    "dep": "15",
    "mun": "104"
  },
  "busbanza": {
    "dep": "15",
    "mun": "114"
  },
  "campohermoso": {
    "dep": "15",
    "mun": "135"
  },
  "cerinza": {
    "dep": "15",
    "mun": "162"
  },
  "chinavita": {
    "dep": "15",
    "mun": "172"
  },
  "chiquinquira": {
    "dep": "15",
    "mun": "176"
  },
  "chiscas": {
    "dep": "15",
    "mun": "180"
  },
  "chita": {
    "dep": "15",
    "mun": "183"
  },
  "chitaraque": {
    "dep": "15",
    "mun": "185"
  },
  "chivata": {
    "dep": "15",
    "mun": "187"
  },
  "cienega": {
    "dep": "15",
    "mun": "189"
  },
  "combita": {
    "dep": "15",
    "mun": "204"
  },
  "coper": {
    "dep": "15",
    "mun": "212"
  },
  "corrales": {
    "dep": "15",
    "mun": "215"
  },
  "covarachia": {
    "dep": "15",
    "mun": "218"
  },
  "cubara": {
    "dep": "15",
    "mun": "223"
  },
  "cucaita": {
    "dep": "15",
    "mun": "224"
  },
  "cuitiva": {
    "dep": "15",
    "mun": "226"
  },
  "chiquiza": {
    "dep": "15",
    "mun": "232"
  },
  "chivor": {
    "dep": "15",
    "mun": "236"
  },
  "duitama": {
    "dep": "15",
    "mun": "238"
  },
  "el cocuy": {
    "dep": "15",
    "mun": "244"
  },
  "el espino": {
    "dep": "15",
    "mun": "248"
  },
  "firavitoba": {
    "dep": "15",
    "mun": "272"
  },
  "floresta": {
    "dep": "15",
    "mun": "276"
  },
  "gachantiva": {
    "dep": "15",
    "mun": "293"
  },
  "gameza": {
    "dep": "15",
    "mun": "296"
  },
  "garagoa": {
    "dep": "15",
    "mun": "299"
  },
  "guacamayas": {
    "dep": "15",
    "mun": "317"
  },
  "guateque": {
    "dep": "15",
    "mun": "322"
  },
  "guayata": {
    "dep": "15",
    "mun": "325"
  },
  "guican de la sierra": {
    "dep": "15",
    "mun": "332"
  },
  "iza": {
    "dep": "15",
    "mun": "362"
  },
  "jenesano": {
    "dep": "15",
    "mun": "367"
  },
  "labranzagrande": {
    "dep": "15",
    "mun": "377"
  },
  "la capilla": {
    "dep": "15",
    "mun": "380"
  },
  "la uvita": {
    "dep": "15",
    "mun": "403"
  },
  "villa de leyva": {
    "dep": "15",
    "mun": "407"
  },
  "macanal": {
    "dep": "15",
    "mun": "425"
  },
  "maripi": {
    "dep": "15",
    "mun": "442"
  },
  "mongua": {
    "dep": "15",
    "mun": "464"
  },
  "mongui": {
    "dep": "15",
    "mun": "466"
  },
  "moniquira": {
    "dep": "15",
    "mun": "469"
  },
  "motavita": {
    "dep": "15",
    "mun": "476"
  },
  "muzo": {
    "dep": "15",
    "mun": "480"
  },
  "nobsa": {
    "dep": "15",
    "mun": "491"
  },
  "nuevo colon": {
    "dep": "15",
    "mun": "494"
  },
  "oicata": {
    "dep": "15",
    "mun": "500"
  },
  "otanche": {
    "dep": "15",
    "mun": "507"
  },
  "pachavita": {
    "dep": "15",
    "mun": "511"
  },
  "paipa": {
    "dep": "15",
    "mun": "516"
  },
  "pajarito": {
    "dep": "15",
    "mun": "518"
  },
  "panqueba": {
    "dep": "15",
    "mun": "522"
  },
  "pauna": {
    "dep": "15",
    "mun": "531"
  },
  "paya": {
    "dep": "15",
    "mun": "533"
  },
  "paz de rio": {
    "dep": "15",
    "mun": "537"
  },
  "pesca": {
    "dep": "15",
    "mun": "542"
  },
  "pisba": {
    "dep": "15",
    "mun": "550"
  },
  "puerto boyaca": {
    "dep": "15",
    "mun": "572"
  },
  "quipama": {
    "dep": "15",
    "mun": "580"
  },
  "ramiriqui": {
    "dep": "15",
    "mun": "599"
  },
  "raquira": {
    "dep": "15",
    "mun": "600"
  },
  "rondon": {
    "dep": "15",
    "mun": "621"
  },
  "saboya": {
    "dep": "15",
    "mun": "632"
  },
  "sachica": {
    "dep": "15",
    "mun": "638"
  },
  "samaca": {
    "dep": "15",
    "mun": "646"
  },
  "san eduardo": {
    "dep": "15",
    "mun": "660"
  },
  "san jose de pare": {
    "dep": "15",
    "mun": "664"
  },
  "san luis de gaceno": {
    "dep": "15",
    "mun": "667"
  },
  "san mateo": {
    "dep": "15",
    "mun": "673"
  },
  "san miguel de sema": {
    "dep": "15",
    "mun": "676"
  },
  "san pablo de borbur": {
    "dep": "15",
    "mun": "681"
  },
  "santana": {
    "dep": "15",
    "mun": "686"
  },
  "santa rosa de viterbo": {
    "dep": "15",
    "mun": "693"
  },
  "santa sofia": {
    "dep": "15",
    "mun": "696"
  },
  "sativanorte": {
    "dep": "15",
    "mun": "720"
  },
  "sativasur": {
    "dep": "15",
    "mun": "723"
  },
  "siachoque": {
    "dep": "15",
    "mun": "740"
  },
  "soata": {
    "dep": "15",
    "mun": "753"
  },
  "socota": {
    "dep": "15",
    "mun": "755"
  },
  "socha": {
    "dep": "15",
    "mun": "757"
  },
  "sogamoso": {
    "dep": "15",
    "mun": "759"
  },
  "somondoco": {
    "dep": "15",
    "mun": "761"
  },
  "sora": {
    "dep": "15",
    "mun": "762"
  },
  "sotaquira": {
    "dep": "15",
    "mun": "763"
  },
  "soraca": {
    "dep": "15",
    "mun": "764"
  },
  "susacon": {
    "dep": "15",
    "mun": "774"
  },
  "sutamarchan": {
    "dep": "15",
    "mun": "776"
  },
  "sutatenza": {
    "dep": "15",
    "mun": "778"
  },
  "tasco": {
    "dep": "15",
    "mun": "790"
  },
  "tenza": {
    "dep": "15",
    "mun": "798"
  },
  "tibana": {
    "dep": "15",
    "mun": "804"
  },
  "tibasosa": {
    "dep": "15",
    "mun": "806"
  },
  "tinjaca": {
    "dep": "15",
    "mun": "808"
  },
  "tipacoque": {
    "dep": "15",
    "mun": "810"
  },
  "toca": {
    "dep": "15",
    "mun": "814"
  },
  "togui": {
    "dep": "15",
    "mun": "816"
  },
  "topaga": {
    "dep": "15",
    "mun": "820"
  },
  "tota": {
    "dep": "15",
    "mun": "822"
  },
  "tunungua": {
    "dep": "15",
    "mun": "832"
  },
  "turmeque": {
    "dep": "15",
    "mun": "835"
  },
  "tuta": {
    "dep": "15",
    "mun": "837"
  },
  "tutaza": {
    "dep": "15",
    "mun": "839"
  },
  "umbita": {
    "dep": "15",
    "mun": "842"
  },
  "ventaquemada": {
    "dep": "15",
    "mun": "861"
  },
  "viracacha": {
    "dep": "15",
    "mun": "879"
  },
  "zetaquira": {
    "dep": "15",
    "mun": "897"
  },
  "manizales": {
    "dep": "17",
    "mun": "001"
  },
  "aguadas": {
    "dep": "17",
    "mun": "013"
  },
  "anserma": {
    "dep": "17",
    "mun": "042"
  },
  "aranzazu": {
    "dep": "17",
    "mun": "050"
  },
  "belalcazar": {
    "dep": "17",
    "mun": "088"
  },
  "chinchina": {
    "dep": "17",
    "mun": "174"
  },
  "filadelfia": {
    "dep": "17",
    "mun": "272"
  },
  "la dorada": {
    "dep": "17",
    "mun": "380"
  },
  "la merced": {
    "dep": "17",
    "mun": "388"
  },
  "manzanares": {
    "dep": "17",
    "mun": "433"
  },
  "marmato": {
    "dep": "17",
    "mun": "442"
  },
  "marquetalia": {
    "dep": "17",
    "mun": "444"
  },
  "marulanda": {
    "dep": "17",
    "mun": "446"
  },
  "neira": {
    "dep": "17",
    "mun": "486"
  },
  "norcasia": {
    "dep": "17",
    "mun": "495"
  },
  "pacora": {
    "dep": "17",
    "mun": "513"
  },
  "pensilvania": {
    "dep": "17",
    "mun": "541"
  },
  "risaralda": {
    "dep": "17",
    "mun": "616"
  },
  "samana": {
    "dep": "17",
    "mun": "662"
  },
  "san jose": {
    "dep": "17",
    "mun": "665"
  },
  "supia": {
    "dep": "17",
    "mun": "777"
  },
  "victoria": {
    "dep": "17",
    "mun": "867"
  },
  "villamaria": {
    "dep": "17",
    "mun": "873"
  },
  "viterbo": {
    "dep": "17",
    "mun": "877"
  },
  "belen de los andaquies": {
    "dep": "18",
    "mun": "094"
  },
  "cartagena del chaira": {
    "dep": "18",
    "mun": "150"
  },
  "curillo": {
    "dep": "18",
    "mun": "205"
  },
  "el doncello": {
    "dep": "18",
    "mun": "247"
  },
  "el paujil": {
    "dep": "18",
    "mun": "256"
  },
  "la montanita": {
    "dep": "18",
    "mun": "410"
  },
  "milan": {
    "dep": "18",
    "mun": "460"
  },
  "morelia": {
    "dep": "18",
    "mun": "479"
  },
  "san jose del fragua": {
    "dep": "18",
    "mun": "610"
  },
  "san vicente del caguan": {
    "dep": "18",
    "mun": "753"
  },
  "solano": {
    "dep": "18",
    "mun": "756"
  },
  "solita": {
    "dep": "18",
    "mun": "785"
  },
  "popayan": {
    "dep": "19",
    "mun": "001"
  },
  "almaguer": {
    "dep": "19",
    "mun": "022"
  },
  "buenos aires": {
    "dep": "19",
    "mun": "110"
  },
  "cajibio": {
    "dep": "19",
    "mun": "130"
  },
  "caldono": {
    "dep": "19",
    "mun": "137"
  },
  "caloto": {
    "dep": "19",
    "mun": "142"
  },
  "corinto": {
    "dep": "19",
    "mun": "212"
  },
  "guachene": {
    "dep": "19",
    "mun": "300"
  },
  "guapi": {
    "dep": "19",
    "mun": "318"
  },
  "inza": {
    "dep": "19",
    "mun": "355"
  },
  "jambalo": {
    "dep": "19",
    "mun": "364"
  },
  "la sierra": {
    "dep": "19",
    "mun": "392"
  },
  "lopez de micay": {
    "dep": "19",
    "mun": "418"
  },
  "mercaderes": {
    "dep": "19",
    "mun": "450"
  },
  "miranda": {
    "dep": "19",
    "mun": "455"
  },
  "padilla": {
    "dep": "19",
    "mun": "513"
  },
  "patia": {
    "dep": "19",
    "mun": "532"
  },
  "piamonte": {
    "dep": "19",
    "mun": "533"
  },
  "piendamo tunia": {
    "dep": "19",
    "mun": "548"
  },
  "puerto tejada": {
    "dep": "19",
    "mun": "573"
  },
  "purace": {
    "dep": "19",
    "mun": "585"
  },
  "rosas": {
    "dep": "19",
    "mun": "622"
  },
  "san sebastian": {
    "dep": "19",
    "mun": "693"
  },
  "santander de quilichao": {
    "dep": "19",
    "mun": "698"
  },
  "silvia": {
    "dep": "19",
    "mun": "743"
  },
  "sotara paispamba": {
    "dep": "19",
    "mun": "760"
  },
  "timbio": {
    "dep": "19",
    "mun": "807"
  },
  "timbiqui": {
    "dep": "19",
    "mun": "809"
  },
  "toribio": {
    "dep": "19",
    "mun": "821"
  },
  "totoro": {
    "dep": "19",
    "mun": "824"
  },
  "villa rica": {
    "dep": "19",
    "mun": "845"
  },
  "valledupar": {
    "dep": "20",
    "mun": "001"
  },
  "aguachica": {
    "dep": "20",
    "mun": "011"
  },
  "agustin codazzi": {
    "dep": "20",
    "mun": "013"
  },
  "astrea": {
    "dep": "20",
    "mun": "032"
  },
  "becerril": {
    "dep": "20",
    "mun": "045"
  },
  "bosconia": {
    "dep": "20",
    "mun": "060"
  },
  "chimichagua": {
    "dep": "20",
    "mun": "175"
  },
  "chiriguana": {
    "dep": "20",
    "mun": "178"
  },
  "curumani": {
    "dep": "20",
    "mun": "228"
  },
  "el copey": {
    "dep": "20",
    "mun": "238"
  },
  "el paso": {
    "dep": "20",
    "mun": "250"
  },
  "gamarra": {
    "dep": "20",
    "mun": "295"
  },
  "gonzalez": {
    "dep": "20",
    "mun": "310"
  },
  "la gloria": {
    "dep": "20",
    "mun": "383"
  },
  "la jagua de ibirico": {
    "dep": "20",
    "mun": "400"
  },
  "manaure balcon del cesar": {
    "dep": "20",
    "mun": "443"
  },
  "pailitas": {
    "dep": "20",
    "mun": "517"
  },
  "pelaya": {
    "dep": "20",
    "mun": "550"
  },
  "pueblo bello": {
    "dep": "20",
    "mun": "570"
  },
  "rio de oro": {
    "dep": "20",
    "mun": "614"
  },
  "san alberto": {
    "dep": "20",
    "mun": "710"
  },
  "san diego": {
    "dep": "20",
    "mun": "750"
  },
  "tamalameque": {
    "dep": "20",
    "mun": "787"
  },
  "monteria": {
    "dep": "23",
    "mun": "001"
  },
  "ayapel": {
    "dep": "23",
    "mun": "068"
  },
  "canalete": {
    "dep": "23",
    "mun": "090"
  },
  "cerete": {
    "dep": "23",
    "mun": "162"
  },
  "chinu": {
    "dep": "23",
    "mun": "182"
  },
  "cienaga de oro": {
    "dep": "23",
    "mun": "189"
  },
  "cotorra": {
    "dep": "23",
    "mun": "300"
  },
  "la apartada": {
    "dep": "23",
    "mun": "350"
  },
  "lorica": {
    "dep": "23",
    "mun": "417"
  },
  "los cordobas": {
    "dep": "23",
    "mun": "419"
  },
  "momil": {
    "dep": "23",
    "mun": "464"
  },
  "montelibano": {
    "dep": "23",
    "mun": "466"
  },
  "monitos": {
    "dep": "23",
    "mun": "500"
  },
  "planeta rica": {
    "dep": "23",
    "mun": "555"
  },
  "pueblo nuevo": {
    "dep": "23",
    "mun": "570"
  },
  "puerto escondido": {
    "dep": "23",
    "mun": "574"
  },
  "puerto libertador": {
    "dep": "23",
    "mun": "580"
  },
  "purisima de la concepcion": {
    "dep": "23",
    "mun": "586"
  },
  "sahagun": {
    "dep": "23",
    "mun": "660"
  },
  "san andres de sotavento": {
    "dep": "23",
    "mun": "670"
  },
  "san antero": {
    "dep": "23",
    "mun": "672"
  },
  "san bernardo del viento": {
    "dep": "23",
    "mun": "675"
  },
  "san jose de ure": {
    "dep": "23",
    "mun": "682"
  },
  "san pelayo": {
    "dep": "23",
    "mun": "686"
  },
  "tierralta": {
    "dep": "23",
    "mun": "807"
  },
  "tuchin": {
    "dep": "23",
    "mun": "815"
  },
  "valencia": {
    "dep": "23",
    "mun": "855"
  },
  "agua de dios": {
    "dep": "25",
    "mun": "001"
  },
  "anapoima": {
    "dep": "25",
    "mun": "035"
  },
  "anolaima": {
    "dep": "25",
    "mun": "040"
  },
  "arbelaez": {
    "dep": "25",
    "mun": "053"
  },
  "beltran": {
    "dep": "25",
    "mun": "086"
  },
  "bituima": {
    "dep": "25",
    "mun": "095"
  },
  "bojaca": {
    "dep": "25",
    "mun": "099"
  },
  "cachipay": {
    "dep": "25",
    "mun": "123"
  },
  "cajica": {
    "dep": "25",
    "mun": "126"
  },
  "caparrapi": {
    "dep": "25",
    "mun": "148"
  },
  "caqueza": {
    "dep": "25",
    "mun": "151"
  },
  "carmen de carupa": {
    "dep": "25",
    "mun": "154"
  },
  "chaguani": {
    "dep": "25",
    "mun": "168"
  },
  "chia": {
    "dep": "25",
    "mun": "175"
  },
  "chipaque": {
    "dep": "25",
    "mun": "178"
  },
  "choachi": {
    "dep": "25",
    "mun": "181"
  },
  "choconta": {
    "dep": "25",
    "mun": "183"
  },
  "cogua": {
    "dep": "25",
    "mun": "200"
  },
  "cota": {
    "dep": "25",
    "mun": "214"
  },
  "cucunuba": {
    "dep": "25",
    "mun": "224"
  },
  "el colegio": {
    "dep": "25",
    "mun": "245"
  },
  "el rosal": {
    "dep": "25",
    "mun": "260"
  },
  "facatativa": {
    "dep": "25",
    "mun": "269"
  },
  "fomeque": {
    "dep": "25",
    "mun": "279"
  },
  "fosca": {
    "dep": "25",
    "mun": "281"
  },
  "funza": {
    "dep": "25",
    "mun": "286"
  },
  "fuquene": {
    "dep": "25",
    "mun": "288"
  },
  "fusagasuga": {
    "dep": "25",
    "mun": "290"
  },
  "gachala": {
    "dep": "25",
    "mun": "293"
  },
  "gachancipa": {
    "dep": "25",
    "mun": "295"
  },
  "gacheta": {
    "dep": "25",
    "mun": "297"
  },
  "gama": {
    "dep": "25",
    "mun": "299"
  },
  "girardot": {
    "dep": "25",
    "mun": "307"
  },
  "guacheta": {
    "dep": "25",
    "mun": "317"
  },
  "guaduas": {
    "dep": "25",
    "mun": "320"
  },
  "guasca": {
    "dep": "25",
    "mun": "322"
  },
  "guataqui": {
    "dep": "25",
    "mun": "324"
  },
  "guatavita": {
    "dep": "25",
    "mun": "326"
  },
  "guayabal de siquima": {
    "dep": "25",
    "mun": "328"
  },
  "guayabetal": {
    "dep": "25",
    "mun": "335"
  },
  "gutierrez": {
    "dep": "25",
    "mun": "339"
  },
  "jerusalen": {
    "dep": "25",
    "mun": "368"
  },
  "junin": {
    "dep": "25",
    "mun": "372"
  },
  "la calera": {
    "dep": "25",
    "mun": "377"
  },
  "la mesa": {
    "dep": "25",
    "mun": "386"
  },
  "la palma": {
    "dep": "25",
    "mun": "394"
  },
  "la pena": {
    "dep": "25",
    "mun": "398"
  },
  "lenguazaque": {
    "dep": "25",
    "mun": "407"
  },
  "macheta": {
    "dep": "25",
    "mun": "426"
  },
  "madrid": {
    "dep": "25",
    "mun": "430"
  },
  "manta": {
    "dep": "25",
    "mun": "436"
  },
  "medina": {
    "dep": "25",
    "mun": "438"
  },
  "nemocon": {
    "dep": "25",
    "mun": "486"
  },
  "nilo": {
    "dep": "25",
    "mun": "488"
  },
  "nimaima": {
    "dep": "25",
    "mun": "489"
  },
  "nocaima": {
    "dep": "25",
    "mun": "491"
  },
  "pacho": {
    "dep": "25",
    "mun": "513"
  },
  "paime": {
    "dep": "25",
    "mun": "518"
  },
  "pandi": {
    "dep": "25",
    "mun": "524"
  },
  "paratebueno": {
    "dep": "25",
    "mun": "530"
  },
  "pasca": {
    "dep": "25",
    "mun": "535"
  },
  "puerto salgar": {
    "dep": "25",
    "mun": "572"
  },
  "puli": {
    "dep": "25",
    "mun": "580"
  },
  "quebradanegra": {
    "dep": "25",
    "mun": "592"
  },
  "quetame": {
    "dep": "25",
    "mun": "594"
  },
  "quipile": {
    "dep": "25",
    "mun": "596"
  },
  "apulo": {
    "dep": "25",
    "mun": "599"
  },
  "san antonio del tequendama": {
    "dep": "25",
    "mun": "645"
  },
  "san juan de rioseco": {
    "dep": "25",
    "mun": "662"
  },
  "sasaima": {
    "dep": "25",
    "mun": "718"
  },
  "sesquile": {
    "dep": "25",
    "mun": "736"
  },
  "sibate": {
    "dep": "25",
    "mun": "740"
  },
  "silvania": {
    "dep": "25",
    "mun": "743"
  },
  "simijaca": {
    "dep": "25",
    "mun": "745"
  },
  "soacha": {
    "dep": "25",
    "mun": "754"
  },
  "sopo": {
    "dep": "25",
    "mun": "758"
  },
  "subachoque": {
    "dep": "25",
    "mun": "769"
  },
  "suesca": {
    "dep": "25",
    "mun": "772"
  },
  "supata": {
    "dep": "25",
    "mun": "777"
  },
  "susa": {
    "dep": "25",
    "mun": "779"
  },
  "sutatausa": {
    "dep": "25",
    "mun": "781"
  },
  "tabio": {
    "dep": "25",
    "mun": "785"
  },
  "tausa": {
    "dep": "25",
    "mun": "793"
  },
  "tena": {
    "dep": "25",
    "mun": "797"
  },
  "tenjo": {
    "dep": "25",
    "mun": "799"
  },
  "tibacuy": {
    "dep": "25",
    "mun": "805"
  },
  "tibirita": {
    "dep": "25",
    "mun": "807"
  },
  "tocaima": {
    "dep": "25",
    "mun": "815"
  },
  "tocancipa": {
    "dep": "25",
    "mun": "817"
  },
  "topaipi": {
    "dep": "25",
    "mun": "823"
  },
  "ubala": {
    "dep": "25",
    "mun": "839"
  },
  "ubaque": {
    "dep": "25",
    "mun": "841"
  },
  "villa de san diego de ubate": {
    "dep": "25",
    "mun": "843"
  },
  "une": {
    "dep": "25",
    "mun": "845"
  },
  "utica": {
    "dep": "25",
    "mun": "851"
  },
  "vergara": {
    "dep": "25",
    "mun": "862"
  },
  "viani": {
    "dep": "25",
    "mun": "867"
  },
  "villagomez": {
    "dep": "25",
    "mun": "871"
  },
  "villapinzon": {
    "dep": "25",
    "mun": "873"
  },
  "villeta": {
    "dep": "25",
    "mun": "875"
  },
  "viota": {
    "dep": "25",
    "mun": "878"
  },
  "yacopi": {
    "dep": "25",
    "mun": "885"
  },
  "zipacon": {
    "dep": "25",
    "mun": "898"
  },
  "zipaquira": {
    "dep": "25",
    "mun": "899"
  },
  "quibdo": {
    "dep": "27",
    "mun": "001"
  },
  "acandi": {
    "dep": "27",
    "mun": "006"
  },
  "alto baudo": {
    "dep": "27",
    "mun": "025"
  },
  "atrato": {
    "dep": "27",
    "mun": "050"
  },
  "bagado": {
    "dep": "27",
    "mun": "073"
  },
  "bahia solano": {
    "dep": "27",
    "mun": "075"
  },
  "bajo baudo": {
    "dep": "27",
    "mun": "077"
  },
  "bojaya": {
    "dep": "27",
    "mun": "099"
  },
  "el canton del san pablo": {
    "dep": "27",
    "mun": "135"
  },
  "carmen del darien": {
    "dep": "27",
    "mun": "150"
  },
  "certegui": {
    "dep": "27",
    "mun": "160"
  },
  "condoto": {
    "dep": "27",
    "mun": "205"
  },
  "el carmen de atrato": {
    "dep": "27",
    "mun": "245"
  },
  "el litoral del san juan": {
    "dep": "27",
    "mun": "250"
  },
  "istmina": {
    "dep": "27",
    "mun": "361"
  },
  "jurado": {
    "dep": "27",
    "mun": "372"
  },
  "lloro": {
    "dep": "27",
    "mun": "413"
  },
  "medio atrato": {
    "dep": "27",
    "mun": "425"
  },
  "medio baudo": {
    "dep": "27",
    "mun": "430"
  },
  "medio san juan": {
    "dep": "27",
    "mun": "450"
  },
  "novita": {
    "dep": "27",
    "mun": "491"
  },
  "nuevo belen de bajira": {
    "dep": "27",
    "mun": "493"
  },
  "nuqui": {
    "dep": "27",
    "mun": "495"
  },
  "rio iro": {
    "dep": "27",
    "mun": "580"
  },
  "rio quito": {
    "dep": "27",
    "mun": "600"
  },
  "san jose del palmar": {
    "dep": "27",
    "mun": "660"
  },
  "sipi": {
    "dep": "27",
    "mun": "745"
  },
  "tado": {
    "dep": "27",
    "mun": "787"
  },
  "unguia": {
    "dep": "27",
    "mun": "800"
  },
  "union panamericana": {
    "dep": "27",
    "mun": "810"
  },
  "neiva": {
    "dep": "41",
    "mun": "001"
  },
  "acevedo": {
    "dep": "41",
    "mun": "006"
  },
  "agrado": {
    "dep": "41",
    "mun": "013"
  },
  "aipe": {
    "dep": "41",
    "mun": "016"
  },
  "algeciras": {
    "dep": "41",
    "mun": "020"
  },
  "altamira": {
    "dep": "41",
    "mun": "026"
  },
  "baraya": {
    "dep": "41",
    "mun": "078"
  },
  "campoalegre": {
    "dep": "41",
    "mun": "132"
  },
  "colombia": {
    "dep": "41",
    "mun": "206"
  },
  "elias": {
    "dep": "41",
    "mun": "244"
  },
  "garzon": {
    "dep": "41",
    "mun": "298"
  },
  "gigante": {
    "dep": "41",
    "mun": "306"
  },
  "hobo": {
    "dep": "41",
    "mun": "349"
  },
  "iquira": {
    "dep": "41",
    "mun": "357"
  },
  "isnos": {
    "dep": "41",
    "mun": "359"
  },
  "la argentina": {
    "dep": "41",
    "mun": "378"
  },
  "la plata": {
    "dep": "41",
    "mun": "396"
  },
  "nataga": {
    "dep": "41",
    "mun": "483"
  },
  "oporapa": {
    "dep": "41",
    "mun": "503"
  },
  "paicol": {
    "dep": "41",
    "mun": "518"
  },
  "palermo": {
    "dep": "41",
    "mun": "524"
  },
  "pital": {
    "dep": "41",
    "mun": "548"
  },
  "pitalito": {
    "dep": "41",
    "mun": "551"
  },
  "rivera": {
    "dep": "41",
    "mun": "615"
  },
  "saladoblanco": {
    "dep": "41",
    "mun": "660"
  },
  "san agustin": {
    "dep": "41",
    "mun": "668"
  },
  "suaza": {
    "dep": "41",
    "mun": "770"
  },
  "tarqui": {
    "dep": "41",
    "mun": "791"
  },
  "tesalia": {
    "dep": "41",
    "mun": "797"
  },
  "tello": {
    "dep": "41",
    "mun": "799"
  },
  "teruel": {
    "dep": "41",
    "mun": "801"
  },
  "timana": {
    "dep": "41",
    "mun": "807"
  },
  "villavieja": {
    "dep": "41",
    "mun": "872"
  },
  "yaguara": {
    "dep": "41",
    "mun": "885"
  },
  "riohacha": {
    "dep": "44",
    "mun": "001"
  },
  "barrancas": {
    "dep": "44",
    "mun": "078"
  },
  "dibulla": {
    "dep": "44",
    "mun": "090"
  },
  "distraccion": {
    "dep": "44",
    "mun": "098"
  },
  "el molino": {
    "dep": "44",
    "mun": "110"
  },
  "fonseca": {
    "dep": "44",
    "mun": "279"
  },
  "hatonuevo": {
    "dep": "44",
    "mun": "378"
  },
  "la jagua del pilar": {
    "dep": "44",
    "mun": "420"
  },
  "maicao": {
    "dep": "44",
    "mun": "430"
  },
  "manaure": {
    "dep": "44",
    "mun": "560"
  },
  "san juan del cesar": {
    "dep": "44",
    "mun": "650"
  },
  "uribia": {
    "dep": "44",
    "mun": "847"
  },
  "urumita": {
    "dep": "44",
    "mun": "855"
  },
  "santa marta": {
    "dep": "47",
    "mun": "001"
  },
  "algarrobo": {
    "dep": "47",
    "mun": "030"
  },
  "aracataca": {
    "dep": "47",
    "mun": "053"
  },
  "ariguani": {
    "dep": "47",
    "mun": "058"
  },
  "cerro de san antonio": {
    "dep": "47",
    "mun": "161"
  },
  "chivolo": {
    "dep": "47",
    "mun": "170"
  },
  "cienaga": {
    "dep": "47",
    "mun": "189"
  },
  "el banco": {
    "dep": "47",
    "mun": "245"
  },
  "el pinon": {
    "dep": "47",
    "mun": "258"
  },
  "el reten": {
    "dep": "47",
    "mun": "268"
  },
  "fundacion": {
    "dep": "47",
    "mun": "288"
  },
  "nueva granada": {
    "dep": "47",
    "mun": "460"
  },
  "pedraza": {
    "dep": "47",
    "mun": "541"
  },
  "pijino del carmen": {
    "dep": "47",
    "mun": "545"
  },
  "pivijay": {
    "dep": "47",
    "mun": "551"
  },
  "plato": {
    "dep": "47",
    "mun": "555"
  },
  "puebloviejo": {
    "dep": "47",
    "mun": "570"
  },
  "remolino": {
    "dep": "47",
    "mun": "605"
  },
  "sabanas de san angel": {
    "dep": "47",
    "mun": "660"
  },
  "san sebastian de buenavista": {
    "dep": "47",
    "mun": "692"
  },
  "san zenon": {
    "dep": "47",
    "mun": "703"
  },
  "santa ana": {
    "dep": "47",
    "mun": "707"
  },
  "santa barbara de pinto": {
    "dep": "47",
    "mun": "720"
  },
  "sitionuevo": {
    "dep": "47",
    "mun": "745"
  },
  "tenerife": {
    "dep": "47",
    "mun": "798"
  },
  "zapayan": {
    "dep": "47",
    "mun": "960"
  },
  "zona bananera": {
    "dep": "47",
    "mun": "980"
  },
  "villavicencio": {
    "dep": "50",
    "mun": "001"
  },
  "acacias": {
    "dep": "50",
    "mun": "006"
  },
  "barranca de upia": {
    "dep": "50",
    "mun": "110"
  },
  "cabuyaro": {
    "dep": "50",
    "mun": "124"
  },
  "castilla la nueva": {
    "dep": "50",
    "mun": "150"
  },
  "cubarral": {
    "dep": "50",
    "mun": "223"
  },
  "cumaral": {
    "dep": "50",
    "mun": "226"
  },
  "el calvario": {
    "dep": "50",
    "mun": "245"
  },
  "el castillo": {
    "dep": "50",
    "mun": "251"
  },
  "el dorado": {
    "dep": "50",
    "mun": "270"
  },
  "fuente de oro": {
    "dep": "50",
    "mun": "287"
  },
  "mapiripan": {
    "dep": "50",
    "mun": "325"
  },
  "mesetas": {
    "dep": "50",
    "mun": "330"
  },
  "la macarena": {
    "dep": "50",
    "mun": "350"
  },
  "uribe": {
    "dep": "50",
    "mun": "370"
  },
  "lejanias": {
    "dep": "50",
    "mun": "400"
  },
  "puerto concordia": {
    "dep": "50",
    "mun": "450"
  },
  "puerto gaitan": {
    "dep": "50",
    "mun": "568"
  },
  "puerto lopez": {
    "dep": "50",
    "mun": "573"
  },
  "puerto lleras": {
    "dep": "50",
    "mun": "577"
  },
  "san carlos de guaroa": {
    "dep": "50",
    "mun": "680"
  },
  "san juan de arama": {
    "dep": "50",
    "mun": "683"
  },
  "san juanito": {
    "dep": "50",
    "mun": "686"
  },
  "vistahermosa": {
    "dep": "50",
    "mun": "711"
  },
  "pasto": {
    "dep": "52",
    "mun": "001"
  },
  "aldana": {
    "dep": "52",
    "mun": "022"
  },
  "ancuya": {
    "dep": "52",
    "mun": "036"
  },
  "arboleda": {
    "dep": "52",
    "mun": "051"
  },
  "barbacoas": {
    "dep": "52",
    "mun": "079"
  },
  "buesaco": {
    "dep": "52",
    "mun": "110"
  },
  "consaca": {
    "dep": "52",
    "mun": "207"
  },
  "contadero": {
    "dep": "52",
    "mun": "210"
  },
  "cuaspud carlosama": {
    "dep": "52",
    "mun": "224"
  },
  "cumbal": {
    "dep": "52",
    "mun": "227"
  },
  "cumbitara": {
    "dep": "52",
    "mun": "233"
  },
  "chachagui": {
    "dep": "52",
    "mun": "240"
  },
  "el charco": {
    "dep": "52",
    "mun": "250"
  },
  "el penol": {
    "dep": "52",
    "mun": "254"
  },
  "el rosario": {
    "dep": "52",
    "mun": "256"
  },
  "el tablon de gomez": {
    "dep": "52",
    "mun": "258"
  },
  "funes": {
    "dep": "52",
    "mun": "287"
  },
  "guachucal": {
    "dep": "52",
    "mun": "317"
  },
  "guaitarilla": {
    "dep": "52",
    "mun": "320"
  },
  "gualmatan": {
    "dep": "52",
    "mun": "323"
  },
  "iles": {
    "dep": "52",
    "mun": "352"
  },
  "imues": {
    "dep": "52",
    "mun": "354"
  },
  "ipiales": {
    "dep": "52",
    "mun": "356"
  },
  "la cruz": {
    "dep": "52",
    "mun": "378"
  },
  "la florida": {
    "dep": "52",
    "mun": "381"
  },
  "la llanada": {
    "dep": "52",
    "mun": "385"
  },
  "la tola": {
    "dep": "52",
    "mun": "390"
  },
  "leiva": {
    "dep": "52",
    "mun": "405"
  },
  "linares": {
    "dep": "52",
    "mun": "411"
  },
  "los andes": {
    "dep": "52",
    "mun": "418"
  },
  "magui": {
    "dep": "52",
    "mun": "427"
  },
  "mallama": {
    "dep": "52",
    "mun": "435"
  },
  "olaya herrera": {
    "dep": "52",
    "mun": "490"
  },
  "ospina": {
    "dep": "52",
    "mun": "506"
  },
  "francisco pizarro": {
    "dep": "52",
    "mun": "520"
  },
  "policarpa": {
    "dep": "52",
    "mun": "540"
  },
  "potosi": {
    "dep": "52",
    "mun": "560"
  },
  "puerres": {
    "dep": "52",
    "mun": "573"
  },
  "pupiales": {
    "dep": "52",
    "mun": "585"
  },
  "roberto payan": {
    "dep": "52",
    "mun": "621"
  },
  "samaniego": {
    "dep": "52",
    "mun": "678"
  },
  "sandona": {
    "dep": "52",
    "mun": "683"
  },
  "san lorenzo": {
    "dep": "52",
    "mun": "687"
  },
  "san pedro de cartago": {
    "dep": "52",
    "mun": "694"
  },
  "santacruz": {
    "dep": "52",
    "mun": "699"
  },
  "sapuyes": {
    "dep": "52",
    "mun": "720"
  },
  "taminango": {
    "dep": "52",
    "mun": "786"
  },
  "tangua": {
    "dep": "52",
    "mun": "788"
  },
  "san andres de tumaco": {
    "dep": "52",
    "mun": "835"
  },
  "tuquerres": {
    "dep": "52",
    "mun": "838"
  },
  "yacuanquer": {
    "dep": "52",
    "mun": "885"
  },
  "san jose de cucuta": {
    "dep": "54",
    "mun": "001"
  },
  "abrego": {
    "dep": "54",
    "mun": "003"
  },
  "arboledas": {
    "dep": "54",
    "mun": "051"
  },
  "bochalema": {
    "dep": "54",
    "mun": "099"
  },
  "bucarasica": {
    "dep": "54",
    "mun": "109"
  },
  "cacota": {
    "dep": "54",
    "mun": "125"
  },
  "cachira": {
    "dep": "54",
    "mun": "128"
  },
  "chinacota": {
    "dep": "54",
    "mun": "172"
  },
  "chitaga": {
    "dep": "54",
    "mun": "174"
  },
  "convencion": {
    "dep": "54",
    "mun": "206"
  },
  "cucutilla": {
    "dep": "54",
    "mun": "223"
  },
  "durania": {
    "dep": "54",
    "mun": "239"
  },
  "el carmen": {
    "dep": "54",
    "mun": "245"
  },
  "el tarra": {
    "dep": "54",
    "mun": "250"
  },
  "el zulia": {
    "dep": "54",
    "mun": "261"
  },
  "gramalote": {
    "dep": "54",
    "mun": "313"
  },
  "hacari": {
    "dep": "54",
    "mun": "344"
  },
  "herran": {
    "dep": "54",
    "mun": "347"
  },
  "labateca": {
    "dep": "54",
    "mun": "377"
  },
  "la esperanza": {
    "dep": "54",
    "mun": "385"
  },
  "la playa": {
    "dep": "54",
    "mun": "398"
  },
  "los patios": {
    "dep": "54",
    "mun": "405"
  },
  "lourdes": {
    "dep": "54",
    "mun": "418"
  },
  "mutiscua": {
    "dep": "54",
    "mun": "480"
  },
  "ocana": {
    "dep": "54",
    "mun": "498"
  },
  "pamplona": {
    "dep": "54",
    "mun": "518"
  },
  "pamplonita": {
    "dep": "54",
    "mun": "520"
  },
  "ragonvalia": {
    "dep": "54",
    "mun": "599"
  },
  "salazar": {
    "dep": "54",
    "mun": "660"
  },
  "san calixto": {
    "dep": "54",
    "mun": "670"
  },
  "sardinata": {
    "dep": "54",
    "mun": "720"
  },
  "silos": {
    "dep": "54",
    "mun": "743"
  },
  "teorama": {
    "dep": "54",
    "mun": "800"
  },
  "tibu": {
    "dep": "54",
    "mun": "810"
  },
  "villa caro": {
    "dep": "54",
    "mun": "871"
  },
  "villa del rosario": {
    "dep": "54",
    "mun": "874"
  },
  "calarca": {
    "dep": "63",
    "mun": "130"
  },
  "circasia": {
    "dep": "63",
    "mun": "190"
  },
  "filandia": {
    "dep": "63",
    "mun": "272"
  },
  "genova": {
    "dep": "63",
    "mun": "302"
  },
  "la tebaida": {
    "dep": "63",
    "mun": "401"
  },
  "montenegro": {
    "dep": "63",
    "mun": "470"
  },
  "pijao": {
    "dep": "63",
    "mun": "548"
  },
  "quimbaya": {
    "dep": "63",
    "mun": "594"
  },
  "salento": {
    "dep": "63",
    "mun": "690"
  },
  "pereira": {
    "dep": "66",
    "mun": "001"
  },
  "apia": {
    "dep": "66",
    "mun": "045"
  },
  "belen de umbria": {
    "dep": "66",
    "mun": "088"
  },
  "dosquebradas": {
    "dep": "66",
    "mun": "170"
  },
  "guatica": {
    "dep": "66",
    "mun": "318"
  },
  "la celia": {
    "dep": "66",
    "mun": "383"
  },
  "la virginia": {
    "dep": "66",
    "mun": "400"
  },
  "marsella": {
    "dep": "66",
    "mun": "440"
  },
  "mistrato": {
    "dep": "66",
    "mun": "456"
  },
  "pueblo rico": {
    "dep": "66",
    "mun": "572"
  },
  "quinchia": {
    "dep": "66",
    "mun": "594"
  },
  "santa rosa de cabal": {
    "dep": "66",
    "mun": "682"
  },
  "santuario": {
    "dep": "66",
    "mun": "687"
  },
  "bucaramanga": {
    "dep": "68",
    "mun": "001"
  },
  "aguada": {
    "dep": "68",
    "mun": "013"
  },
  "aratoca": {
    "dep": "68",
    "mun": "051"
  },
  "barichara": {
    "dep": "68",
    "mun": "079"
  },
  "barrancabermeja": {
    "dep": "68",
    "mun": "081"
  },
  "california": {
    "dep": "68",
    "mun": "132"
  },
  "capitanejo": {
    "dep": "68",
    "mun": "147"
  },
  "carcasi": {
    "dep": "68",
    "mun": "152"
  },
  "cepita": {
    "dep": "68",
    "mun": "160"
  },
  "cerrito": {
    "dep": "68",
    "mun": "162"
  },
  "charala": {
    "dep": "68",
    "mun": "167"
  },
  "charta": {
    "dep": "68",
    "mun": "169"
  },
  "chipata": {
    "dep": "68",
    "mun": "179"
  },
  "cimitarra": {
    "dep": "68",
    "mun": "190"
  },
  "confines": {
    "dep": "68",
    "mun": "209"
  },
  "contratacion": {
    "dep": "68",
    "mun": "211"
  },
  "coromoro": {
    "dep": "68",
    "mun": "217"
  },
  "curiti": {
    "dep": "68",
    "mun": "229"
  },
  "el carmen de chucuri": {
    "dep": "68",
    "mun": "235"
  },
  "el guacamayo": {
    "dep": "68",
    "mun": "245"
  },
  "el playon": {
    "dep": "68",
    "mun": "255"
  },
  "encino": {
    "dep": "68",
    "mun": "264"
  },
  "enciso": {
    "dep": "68",
    "mun": "266"
  },
  "florian": {
    "dep": "68",
    "mun": "271"
  },
  "floridablanca": {
    "dep": "68",
    "mun": "276"
  },
  "galan": {
    "dep": "68",
    "mun": "296"
  },
  "gambita": {
    "dep": "68",
    "mun": "298"
  },
  "giron": {
    "dep": "68",
    "mun": "307"
  },
  "guaca": {
    "dep": "68",
    "mun": "318"
  },
  "guapota": {
    "dep": "68",
    "mun": "322"
  },
  "guavata": {
    "dep": "68",
    "mun": "324"
  },
  "guepsa": {
    "dep": "68",
    "mun": "327"
  },
  "hato": {
    "dep": "68",
    "mun": "344"
  },
  "jesus maria": {
    "dep": "68",
    "mun": "368"
  },
  "jordan": {
    "dep": "68",
    "mun": "370"
  },
  "la belleza": {
    "dep": "68",
    "mun": "377"
  },
  "landazuri": {
    "dep": "68",
    "mun": "385"
  },
  "lebrija": {
    "dep": "68",
    "mun": "406"
  },
  "los santos": {
    "dep": "68",
    "mun": "418"
  },
  "macaravita": {
    "dep": "68",
    "mun": "425"
  },
  "malaga": {
    "dep": "68",
    "mun": "432"
  },
  "matanza": {
    "dep": "68",
    "mun": "444"
  },
  "mogotes": {
    "dep": "68",
    "mun": "464"
  },
  "molagavita": {
    "dep": "68",
    "mun": "468"
  },
  "ocamonte": {
    "dep": "68",
    "mun": "498"
  },
  "oiba": {
    "dep": "68",
    "mun": "500"
  },
  "onzaga": {
    "dep": "68",
    "mun": "502"
  },
  "palmar": {
    "dep": "68",
    "mun": "522"
  },
  "palmas del socorro": {
    "dep": "68",
    "mun": "524"
  },
  "paramo": {
    "dep": "68",
    "mun": "533"
  },
  "piedecuesta": {
    "dep": "68",
    "mun": "547"
  },
  "pinchote": {
    "dep": "68",
    "mun": "549"
  },
  "puente nacional": {
    "dep": "68",
    "mun": "572"
  },
  "puerto parra": {
    "dep": "68",
    "mun": "573"
  },
  "puerto wilches": {
    "dep": "68",
    "mun": "575"
  },
  "sabana de torres": {
    "dep": "68",
    "mun": "655"
  },
  "san benito": {
    "dep": "68",
    "mun": "673"
  },
  "san gil": {
    "dep": "68",
    "mun": "679"
  },
  "san joaquin": {
    "dep": "68",
    "mun": "682"
  },
  "san jose de miranda": {
    "dep": "68",
    "mun": "684"
  },
  "san vicente de chucuri": {
    "dep": "68",
    "mun": "689"
  },
  "santa helena del opon": {
    "dep": "68",
    "mun": "720"
  },
  "simacota": {
    "dep": "68",
    "mun": "745"
  },
  "socorro": {
    "dep": "68",
    "mun": "755"
  },
  "suaita": {
    "dep": "68",
    "mun": "770"
  },
  "surata": {
    "dep": "68",
    "mun": "780"
  },
  "tona": {
    "dep": "68",
    "mun": "820"
  },
  "valle de san jose": {
    "dep": "68",
    "mun": "855"
  },
  "velez": {
    "dep": "68",
    "mun": "861"
  },
  "vetas": {
    "dep": "68",
    "mun": "867"
  },
  "zapatoca": {
    "dep": "68",
    "mun": "895"
  },
  "sincelejo": {
    "dep": "70",
    "mun": "001"
  },
  "caimito": {
    "dep": "70",
    "mun": "124"
  },
  "coloso": {
    "dep": "70",
    "mun": "204"
  },
  "corozal": {
    "dep": "70",
    "mun": "215"
  },
  "covenas": {
    "dep": "70",
    "mun": "221"
  },
  "chalan": {
    "dep": "70",
    "mun": "230"
  },
  "el roble": {
    "dep": "70",
    "mun": "233"
  },
  "galeras": {
    "dep": "70",
    "mun": "235"
  },
  "guaranda": {
    "dep": "70",
    "mun": "265"
  },
  "los palmitos": {
    "dep": "70",
    "mun": "418"
  },
  "majagual": {
    "dep": "70",
    "mun": "429"
  },
  "morroa": {
    "dep": "70",
    "mun": "473"
  },
  "ovejas": {
    "dep": "70",
    "mun": "508"
  },
  "palmito": {
    "dep": "70",
    "mun": "523"
  },
  "sampues": {
    "dep": "70",
    "mun": "670"
  },
  "san benito abad": {
    "dep": "70",
    "mun": "678"
  },
  "san juan de betulia": {
    "dep": "70",
    "mun": "702"
  },
  "san marcos": {
    "dep": "70",
    "mun": "708"
  },
  "san onofre": {
    "dep": "70",
    "mun": "713"
  },
  "san luis de since": {
    "dep": "70",
    "mun": "742"
  },
  "santiago de tolu": {
    "dep": "70",
    "mun": "820"
  },
  "san jose de toluviejo": {
    "dep": "70",
    "mun": "823"
  },
  "ibague": {
    "dep": "73",
    "mun": "001"
  },
  "alpujarra": {
    "dep": "73",
    "mun": "024"
  },
  "alvarado": {
    "dep": "73",
    "mun": "026"
  },
  "ambalema": {
    "dep": "73",
    "mun": "030"
  },
  "anzoategui": {
    "dep": "73",
    "mun": "043"
  },
  "armero": {
    "dep": "73",
    "mun": "055"
  },
  "ataco": {
    "dep": "73",
    "mun": "067"
  },
  "cajamarca": {
    "dep": "73",
    "mun": "124"
  },
  "carmen de apicala": {
    "dep": "73",
    "mun": "148"
  },
  "casabianca": {
    "dep": "73",
    "mun": "152"
  },
  "chaparral": {
    "dep": "73",
    "mun": "168"
  },
  "coello": {
    "dep": "73",
    "mun": "200"
  },
  "coyaima": {
    "dep": "73",
    "mun": "217"
  },
  "cunday": {
    "dep": "73",
    "mun": "226"
  },
  "dolores": {
    "dep": "73",
    "mun": "236"
  },
  "espinal": {
    "dep": "73",
    "mun": "268"
  },
  "falan": {
    "dep": "73",
    "mun": "270"
  },
  "flandes": {
    "dep": "73",
    "mun": "275"
  },
  "fresno": {
    "dep": "73",
    "mun": "283"
  },
  "guamo": {
    "dep": "73",
    "mun": "319"
  },
  "herveo": {
    "dep": "73",
    "mun": "347"
  },
  "honda": {
    "dep": "73",
    "mun": "349"
  },
  "icononzo": {
    "dep": "73",
    "mun": "352"
  },
  "lerida": {
    "dep": "73",
    "mun": "408"
  },
  "libano": {
    "dep": "73",
    "mun": "411"
  },
  "san sebastian de mariquita": {
    "dep": "73",
    "mun": "443"
  },
  "melgar": {
    "dep": "73",
    "mun": "449"
  },
  "murillo": {
    "dep": "73",
    "mun": "461"
  },
  "natagaima": {
    "dep": "73",
    "mun": "483"
  },
  "ortega": {
    "dep": "73",
    "mun": "504"
  },
  "palocabildo": {
    "dep": "73",
    "mun": "520"
  },
  "piedras": {
    "dep": "73",
    "mun": "547"
  },
  "planadas": {
    "dep": "73",
    "mun": "555"
  },
  "prado": {
    "dep": "73",
    "mun": "563"
  },
  "purificacion": {
    "dep": "73",
    "mun": "585"
  },
  "rioblanco": {
    "dep": "73",
    "mun": "616"
  },
  "roncesvalles": {
    "dep": "73",
    "mun": "622"
  },
  "rovira": {
    "dep": "73",
    "mun": "624"
  },
  "saldana": {
    "dep": "73",
    "mun": "671"
  },
  "san antonio": {
    "dep": "73",
    "mun": "675"
  },
  "santa isabel": {
    "dep": "73",
    "mun": "686"
  },
  "valle de san juan": {
    "dep": "73",
    "mun": "854"
  },
  "venadillo": {
    "dep": "73",
    "mun": "861"
  },
  "villahermosa": {
    "dep": "73",
    "mun": "870"
  },
  "villarrica": {
    "dep": "73",
    "mun": "873"
  },
  "santiago de cali": {
    "dep": "76",
    "mun": "001"
  },
  "alcala": {
    "dep": "76",
    "mun": "020"
  },
  "andalucia": {
    "dep": "76",
    "mun": "036"
  },
  "ansermanuevo": {
    "dep": "76",
    "mun": "041"
  },
  "buenaventura": {
    "dep": "76",
    "mun": "109"
  },
  "guadalajara de buga": {
    "dep": "76",
    "mun": "111"
  },
  "bugalagrande": {
    "dep": "76",
    "mun": "113"
  },
  "caicedonia": {
    "dep": "76",
    "mun": "122"
  },
  "calima": {
    "dep": "76",
    "mun": "126"
  },
  "cartago": {
    "dep": "76",
    "mun": "147"
  },
  "dagua": {
    "dep": "76",
    "mun": "233"
  },
  "el aguila": {
    "dep": "76",
    "mun": "243"
  },
  "el cairo": {
    "dep": "76",
    "mun": "246"
  },
  "el cerrito": {
    "dep": "76",
    "mun": "248"
  },
  "el dovio": {
    "dep": "76",
    "mun": "250"
  },
  "florida": {
    "dep": "76",
    "mun": "275"
  },
  "ginebra": {
    "dep": "76",
    "mun": "306"
  },
  "guacari": {
    "dep": "76",
    "mun": "318"
  },
  "jamundi": {
    "dep": "76",
    "mun": "364"
  },
  "la cumbre": {
    "dep": "76",
    "mun": "377"
  },
  "obando": {
    "dep": "76",
    "mun": "497"
  },
  "palmira": {
    "dep": "76",
    "mun": "520"
  },
  "pradera": {
    "dep": "76",
    "mun": "563"
  },
  "riofrio": {
    "dep": "76",
    "mun": "616"
  },
  "roldanillo": {
    "dep": "76",
    "mun": "622"
  },
  "sevilla": {
    "dep": "76",
    "mun": "736"
  },
  "toro": {
    "dep": "76",
    "mun": "823"
  },
  "trujillo": {
    "dep": "76",
    "mun": "828"
  },
  "tulua": {
    "dep": "76",
    "mun": "834"
  },
  "ulloa": {
    "dep": "76",
    "mun": "845"
  },
  "versalles": {
    "dep": "76",
    "mun": "863"
  },
  "vijes": {
    "dep": "76",
    "mun": "869"
  },
  "yotoco": {
    "dep": "76",
    "mun": "890"
  },
  "yumbo": {
    "dep": "76",
    "mun": "892"
  },
  "zarzal": {
    "dep": "76",
    "mun": "895"
  },
  "arauca": {
    "dep": "81",
    "mun": "001"
  },
  "arauquita": {
    "dep": "81",
    "mun": "065"
  },
  "cravo norte": {
    "dep": "81",
    "mun": "220"
  },
  "fortul": {
    "dep": "81",
    "mun": "300"
  },
  "puerto rondon": {
    "dep": "81",
    "mun": "591"
  },
  "saravena": {
    "dep": "81",
    "mun": "736"
  },
  "tame": {
    "dep": "81",
    "mun": "794"
  },
  "yopal": {
    "dep": "85",
    "mun": "001"
  },
  "aguazul": {
    "dep": "85",
    "mun": "010"
  },
  "chameza": {
    "dep": "85",
    "mun": "015"
  },
  "hato corozal": {
    "dep": "85",
    "mun": "125"
  },
  "la salina": {
    "dep": "85",
    "mun": "136"
  },
  "mani": {
    "dep": "85",
    "mun": "139"
  },
  "monterrey": {
    "dep": "85",
    "mun": "162"
  },
  "nunchia": {
    "dep": "85",
    "mun": "225"
  },
  "orocue": {
    "dep": "85",
    "mun": "230"
  },
  "paz de ariporo": {
    "dep": "85",
    "mun": "250"
  },
  "pore": {
    "dep": "85",
    "mun": "263"
  },
  "recetor": {
    "dep": "85",
    "mun": "279"
  },
  "sacama": {
    "dep": "85",
    "mun": "315"
  },
  "san luis de palenque": {
    "dep": "85",
    "mun": "325"
  },
  "tamara": {
    "dep": "85",
    "mun": "400"
  },
  "tauramena": {
    "dep": "85",
    "mun": "410"
  },
  "trinidad": {
    "dep": "85",
    "mun": "430"
  },
  "mocoa": {
    "dep": "86",
    "mun": "001"
  },
  "orito": {
    "dep": "86",
    "mun": "320"
  },
  "puerto asis": {
    "dep": "86",
    "mun": "568"
  },
  "puerto caicedo": {
    "dep": "86",
    "mun": "569"
  },
  "puerto guzman": {
    "dep": "86",
    "mun": "571"
  },
  "puerto leguizamo": {
    "dep": "86",
    "mun": "573"
  },
  "sibundoy": {
    "dep": "86",
    "mun": "749"
  },
  "valle del guamuez": {
    "dep": "86",
    "mun": "865"
  },
  "villagarzon": {
    "dep": "86",
    "mun": "885"
  },
  "leticia": {
    "dep": "91",
    "mun": "001"
  },
  "el encanto": {
    "dep": "91",
    "mun": "263"
  },
  "la chorrera": {
    "dep": "91",
    "mun": "405"
  },
  "la pedrera": {
    "dep": "91",
    "mun": "407"
  },
  "miriti parana": {
    "dep": "91",
    "mun": "460"
  },
  "puerto alegria": {
    "dep": "91",
    "mun": "530"
  },
  "puerto arica": {
    "dep": "91",
    "mun": "536"
  },
  "puerto narino": {
    "dep": "91",
    "mun": "540"
  },
  "tarapaca": {
    "dep": "91",
    "mun": "798"
  },
  "inirida": {
    "dep": "94",
    "mun": "001"
  },
  "barrancominas": {
    "dep": "94",
    "mun": "343"
  },
  "san felipe": {
    "dep": "94",
    "mun": "883"
  },
  "la guadalupe": {
    "dep": "94",
    "mun": "885"
  },
  "cacahual": {
    "dep": "94",
    "mun": "886"
  },
  "pana pana": {
    "dep": "94",
    "mun": "887"
  },
  "morichal": {
    "dep": "94",
    "mun": "888"
  },
  "san jose del guaviare": {
    "dep": "95",
    "mun": "001"
  },
  "el retorno": {
    "dep": "95",
    "mun": "025"
  },
  "mitu": {
    "dep": "97",
    "mun": "001"
  },
  "caruru": {
    "dep": "97",
    "mun": "161"
  },
  "pacoa": {
    "dep": "97",
    "mun": "511"
  },
  "taraira": {
    "dep": "97",
    "mun": "666"
  },
  "papunahua": {
    "dep": "97",
    "mun": "777"
  },
  "yavarate": {
    "dep": "97",
    "mun": "889"
  },
  "puerto carreno": {
    "dep": "99",
    "mun": "001"
  },
  "la primavera": {
    "dep": "99",
    "mun": "524"
  },
  "santa rosalia": {
    "dep": "99",
    "mun": "624"
  },
  "cumaribo": {
    "dep": "99",
    "mun": "773"
  }
}

/** Nombres de municipio que existen en más de un departamento. */
export const MUNICIPIOS_AMBIGUOS: readonly string[] = [
  "alban",
  "albania",
  "argelia",
  "armenia",
  "balboa",
  "barbosa",
  "belen",
  "betulia",
  "bolivar",
  "briceno",
  "buenavista",
  "cabrera",
  "calamar",
  "caldas",
  "candelaria",
  "chima",
  "colon",
  "concepcion",
  "concordia",
  "cordoba",
  "el penon",
  "el tambo",
  "florencia",
  "granada",
  "guadalupe",
  "guamal",
  "jerico",
  "la paz",
  "la union",
  "la vega",
  "la victoria",
  "miraflores",
  "morales",
  "mosquera",
  "narino",
  "paez",
  "palestina",
  "providencia",
  "puerto colombia",
  "puerto rico",
  "puerto santander",
  "restrepo",
  "ricaurte",
  "rionegro",
  "riosucio",
  "sabanalarga",
  "salamina",
  "san andres",
  "san bernardo",
  "san carlos",
  "san cayetano",
  "san francisco",
  "san luis",
  "san martin",
  "san miguel",
  "san pablo",
  "san pedro",
  "santa barbara",
  "santa maria",
  "santa rosa",
  "santiago",
  "suarez",
  "sucre",
  "toledo",
  "valparaiso",
  "venecia",
  "villanueva"
]
