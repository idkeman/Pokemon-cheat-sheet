const DATA_ROOTS = [
  "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/",
  "https://github.com/PokeAPI/pokeapi/raw/refs/heads/master/data/v2/csv/"
];
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const ART = `${SPRITES}/other/official-artwork`;
const GEN_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const TYPE_NAMES = ["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
const TYPE_EMOJI = {
  normal:"○",fire:"◈",water:"≈",electric:"ϟ",grass:"✦",ice:"❄",fighting:"✚",
  poison:"☣",ground:"▱",flying:"⌁",psychic:"◉",bug:"◇",rock:"⬢",ghost:"◌",
  dragon:"♢",dark:"☾",steel:"⬡",fairy:"✿"
};
const STAT_NAMES = {hp:"HP",attack:"Attack",defense:"Defense","special-attack":"Sp. Atk","special-defense":"Sp. Def",speed:"Speed"};
const STAT_IDS = {1:"hp",2:"attack",3:"defense",4:"special-attack",5:"special-defense",6:"speed"};
const TYPE_IDS = new Map();
const GENERATION_RANGES = [
  [1,151,1,"kanto"],[152,251,2,"johto"],[252,386,3,"hoenn"],[387,493,4,"sinnoh"],
  [494,649,5,"unova"],[650,721,6,"kalos"],[722,809,7,"alola"],[810,905,8,"galar"],[906,1025,9,"paldea"]
];
const REGION_LABELS = {kanto:"Kanto",johto:"Johto",hoenn:"Hoenn",sinnoh:"Sinnoh",unova:"Unova",kalos:"Kalos",alola:"Alola",galar:"Galar",paldea:"Paldea"};

const state = {
  pokemon: [], speciesRows: [], typesByPokemon: new Map(), statsByPokemon: new Map(), abilitiesByPokemon: new Map(),
  abilities: new Map(), moves: new Map(), evolutionRows: [], typeMeta: new Map(), cache: new Map(),
  currentResults: [], detailLoaded: false, detailLoading: null,
  query:"", generation:"", type:"", region:"", sort:"dex"
};

const $ = (id) => document.getElementById(id);
const els = {
  search:$("searchInput"),generation:$("generationFilter"),type:$("typeFilter"),region:$("regionFilter"),
  sort:$("sortFilter"),reset:$("resetBtn"),random:$("randomBtn"),theme:$("themeBtn"),
  resultCount:$("resultCount"),status:$("catalogStatus"),catalog:$("catalog"),empty:$("emptyState"),
  overlay:$("overlay"),panel:$("detailPanel"),close:$("closeDetail"),detail:$("detailContent"),crumb:$("detailCrumb")
};

function titleCase(value) {
  return String(value || "").split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}
function formatSpeciesName(value) {
  const spaced = String(value || "").replace(/-/g," ");
  return spaced.split(" ").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ")
    .replace(/\bMr Mime\b/i,"Mr. Mime").replace(/\bMime Jr\b/i,"Mime Jr.")
    .replace(/\bFarfetchd\b/i,"Farfetch'd").replace(/\bNidoran F\b/i,"Nidoran ♀").replace(/\bNidoran M\b/i,"Nidoran ♂");
}
function idFromUrl(url) { const match = String(url || "").match(/\/(\d+)\/?$/); return match ? Number(match[1]) : null; }
function spriteUrl(id) { return `${ART}/${id}.png`; }
function typeBadge(type) { return `<span class="type-badge type-${type}">${TYPE_EMOJI[type] || ""} ${titleCase(type)}</span>`; }
function typeBadges(types) { return (types || []).map((t) => typeBadge(typeof t === "string" ? t : t.identifier || t.type?.name)).join(""); }
function cleanText(text) { return String(text || "").replace(/[\n\f]+/g," ").replace(/\s+/g," ").trim(); }
function csvRows(text) {
  const rows = [], row = [], field = [];
  let quoted = false;
  const pushField = () => { row.push(field.join("")); field.length = 0; };
  const pushRow = () => { pushField(); rows.push(row.splice(0)); };
  for (let i=0;i<text.length;i++) {
    const c=text[i], next=text[i+1];
    if (quoted) {
      if (c === '"' && next === '"') { field.push('"'); i++; }
      else if (c === '"') quoted = false;
      else field.push(c);
    } else if (c === '"') quoted = true;
    else if (c === ",") pushField();
    else if (c === "\n") pushRow();
    else if (c !== "\r") field.push(c);
  }
  if (field.length || row.length) pushRow();
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(headers.map((h,i) => [h,r[i] ?? ""])));
}
async function fetchCSV(name) {
  for (const root of DATA_ROOTS) {
    try {
      const response = await fetch(root + name, {cache:"force-cache"});
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      return csvRows(text);
    } catch (error) {
      console.warn("CSV source failed",root,name,error);
    }
  }
  throw new Error(`Could not load ${name} from the PokeAPI GitHub repository`);
}
async function cachedCSV(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  const promise = fetchCSV(name).catch((error) => { state.cache.delete(name); throw error; });
  state.cache.set(name,promise);
  return promise;
}
function generationForId(id) {
  const match = GENERATION_RANGES.find(([min,max]) => id >= min && id <= max);
  return match ? match[2] : 0;
}
function regionForId(id) {
  const match = GENERATION_RANGES.find(([min,max]) => id >= min && id <= max);
  return match ? match[3] : "";
}
function rarityForSpecies(species) {
  const captureRate = Number(species?.capture_rate);
  if (species?.is_mythical === "1") return {key:"mythical",label:"Mythical",detail:"Mythical Pokémon"};
  if (species?.is_legendary === "1") return {key:"legendary",label:"Legendary",detail:"Legendary Pokémon"};
  if (Number.isFinite(captureRate) && captureRate <= 10) return {key:"ultra-rare",label:"Ultra Rare",detail:"Very difficult to capture"};
  if (Number.isFinite(captureRate) && captureRate <= 45) return {key:"rare",label:"Rare",detail:"Difficult to capture"};
  if (Number.isFinite(captureRate) && captureRate <= 120) return {key:"uncommon",label:"Uncommon",detail:"Moderate capture difficulty"};
  return {key:"common",label:"Common",detail:"High capture rate"};
}
function rarityForId(id) {
  const pokemon = state.pokemon.find((p) => p.id === id);
  const species = state.speciesRows.find((s) => Number(s.id) === Number(pokemon?.species_id || id));
  return rarityForSpecies(species);
}
function rarityBadge(rarity) {
  return `<span class="rarity-badge rarity-${rarity.key}" title="${rarity.detail}">${rarity.label}</span>`;
}

function populateFilters() {
  els.generation.innerHTML = '<option value="">All generations</option>' +
    GENERATION_RANGES.map(([, ,gen]) => `<option value="${gen}">Generation ${GEN_ROMAN[gen]}</option>`).join("");
  els.region.innerHTML = '<option value="">All regions</option>' +
    Object.entries(REGION_LABELS).map(([value,label]) => `<option value="${value}">${label}</option>`).join("");
  els.type.innerHTML = '<option value="">All types</option>' +
    TYPE_NAMES.map((type) => `<option value="${type}">${titleCase(type)}</option>`).join("");
}
function matches(item) {
  const q = state.query.trim().toLowerCase().replace(/^#/,"");
  const types = state.typesByPokemon.get(item.id) || [];
  if (q && !String(item.id).includes(q) && !item.identifier.includes(q) && !formatSpeciesName(item.identifier).toLowerCase().includes(q)) return false;
  if (state.generation && generationForId(item.id) !== Number(state.generation)) return false;
  if (state.region && regionForId(item.id) !== state.region) return false;
  if (state.type && !types.includes(state.type)) return false;
  return true;
}
function renderCatalog() {
  let results = state.pokemon.filter(matches);
  if (state.sort === "name") results.sort((a,b) => formatSpeciesName(a.identifier).localeCompare(formatSpeciesName(b.identifier)));
  else if (state.sort === "nameDesc") results.sort((a,b) => formatSpeciesName(b.identifier).localeCompare(formatSpeciesName(a.identifier)));
  else results.sort((a,b) => a.id-b.id);
  state.currentResults = results;
  els.resultCount.textContent = results.length.toLocaleString();
  els.empty.classList.toggle("hidden",results.length > 0);
  els.catalog.innerHTML = results.map((item) => {
    const gen = generationForId(item.id);
    const types = state.typesByPokemon.get(item.id) || [];
    return `<button class="pokemon-card" type="button" data-id="${item.id}">
      <div class="card-top"><span class="dex-no">#${String(item.id).padStart(4,"0")}</span><span class="card-gen">GEN ${GEN_ROMAN[gen]}</span></div>
      <div class="card-rarity">${rarityBadge(rarityForId(item.id))}</div>
      <div class="card-art"><img loading="lazy" src="${spriteUrl(item.id)}" onerror="this.src='${SPRITES}/${item.id}.png';this.onerror=null" alt="${formatSpeciesName(item.identifier)}"></div>
      <div class="card-name">${formatSpeciesName(item.identifier)}</div>
      <div class="type-list">${typeBadges(types) || '<span class="text-chip">Type unavailable</span>'}</div>
    </button>`;
  }).join("");
}
async function loadAbilityData() {
  if (state.abilities.size) return;
  try {
    const [abilities, prose] = await Promise.all([cachedCSV("abilities.csv"),cachedCSV("ability_prose.csv")]);
    const descriptions = new Map(prose.filter((r) => r.local_language_id === "9").map((r) => [Number(r.ability_id),cleanText(r.short_effect || r.effect)]));
    for (const row of abilities) state.abilities.set(Number(row.id),{name:row.identifier,description:descriptions.get(Number(row.id)) || "No English description available."});
  } catch (error) { console.warn("Ability data unavailable",error); }
}
async function loadDetailData() {
  if (state.detailLoaded) return;
  if (state.detailLoading) return state.detailLoading;
  state.detailLoading = (async () => {
    const jobs = [
      ["stats", "pokemon_stats.csv"],
      ["abilities", "pokemon_abilities.csv"],
      ["moves", "moves.csv"],
      ["pokemonMoves", "pokemon_moves.csv"],
      ["evolution", "pokemon_evolution.csv"],
      ["types", "types.csv"],
      ["efficacy", "type_efficacy.csv"],
      ["flavor", "pokemon_species_flavor_text.csv"],
      ["speciesProse", "pokemon_species_prose.csv"]
    ];
    const values = await Promise.all(jobs.map(async ([key,file]) => [key,await cachedCSV(file).catch(() => [])]));
    const data = Object.fromEntries(values);
    if (!state.speciesRows.length) state.speciesRows = await cachedCSV("pokemon_species.csv").catch(() => []);
    state.evolutionRows = data.evolution;
    const flavor = data.flavor.filter((r) => r.language_id === "9");
    const prose = data.speciesProse.filter((r) => r.local_language_id === "9");
    state.speciesRows.forEach((row) => {
      row.englishFlavor = flavor.filter((x) => Number(x.species_id) === Number(row.id));
      row.englishProse = prose.find((x) => Number(x.pokemon_species_id) === Number(row.id)) || null;
    });
    for (const row of data.stats) {
      const list = state.statsByPokemon.get(Number(row.pokemon_id)) || [];
      list.push({id:Number(row.stat_id),base:Number(row.base_stat),effort:Number(row.effort)});
      state.statsByPokemon.set(Number(row.pokemon_id),list);
    }
    for (const row of data.abilities) {
      const list = state.abilitiesByPokemon.get(Number(row.pokemon_id)) || [];
      list.push({id:Number(row.ability_id),hidden:row.is_hidden === "1",slot:Number(row.slot)});
      state.abilitiesByPokemon.set(Number(row.pokemon_id),list);
    }
    for (const row of data.moves) {
      state.moves.set(Number(row.id),{name:row.identifier,generation:Number(row.generation_id),type:Number(row.type_id),power:row.power ? Number(row.power) : null,pp:row.pp ? Number(row.pp) : null,accuracy:row.accuracy ? Number(row.accuracy) : null,priority:Number(row.priority||0)});
    }
    const movesByPokemon = new Map();
    for (const row of data.pokemonMoves) {
      const id = Number(row.pokemon_id);
      const list = movesByPokemon.get(id) || [];
      list.push({moveId:Number(row.move_id),versionGroup:Number(row.version_group_id),method:Number(row.pokemon_move_method_id),level:Number(row.level)});
      movesByPokemon.set(id,list);
    }
    state.movesByPokemon = movesByPokemon;
    for (const row of data.types) TYPE_IDS.set(Number(row.id),row.identifier);
    for (const row of data.efficacy) {
      const attacker = TYPE_IDS.get(Number(row.damage_type_id)), defender = TYPE_IDS.get(Number(row.target_type_id));
      if (!attacker || !defender) continue;
      const map = state.typeMeta.get(attacker) || new Map();
      map.set(defender,Number(row.damage_factor)/100);
      state.typeMeta.set(attacker,map);
    }
    state.detailLoaded = true;
    state.detailLoading = null;
  })().catch((error) => { state.detailLoading = null; throw error; });
  return state.detailLoading;
}
function getSpecies(id) {
  const pokemon = state.pokemon.find((p) => p.id === id);
  const speciesId = Number(pokemon?.species_id || id);
  return state.speciesRows.find((s) => Number(s.id) === speciesId) || null;
}
function effectivenessMarkup(types) {
  if (!state.typeMeta.size) return '<div class="info-card"><span style="color:var(--muted);font-size:.77rem">Type matchup data is unavailable.</span></div>';
  const entries = [];
  for (const attacker of TYPE_NAMES) {
    let mult = 1;
    for (const defender of types) mult *= state.typeMeta.get(attacker)?.get(defender) ?? 1;
    entries.push({attacker,mult});
  }
  const weak = entries.filter((x) => x.mult > 1), resist = entries.filter((x) => x.mult > 0 && x.mult < 1), immune = entries.filter((x) => x.mult === 0);
  const group = (items) => items.map((x) => `<span class="effect-tag">${titleCase(x.attacker)} · ${x.mult}×</span>`).join("") || "<p>None</p>";
  return `<div class="effect-grid"><div class="effect-card"><h3>Weak to</h3><div class="effect-list">${group(weak)}</div></div><div class="effect-card"><h3>Resists</h3><div class="effect-list">${group(resist)}</div></div><div class="effect-card"><h3>Immune to</h3><div class="effect-list">${group(immune)}</div></div></div>`;
}
function statMarkup(pokemonId) {
  const stats = state.statsByPokemon.get(pokemonId) || [];
  const total = stats.reduce((sum,x) => sum+x.base,0);
  const rows = [...stats].sort((a,b) => a.id-b.id).map((x) => {
    const key = STAT_IDS[x.id] || "", value=x.base, pct=Math.min(100,value/255*100);
    return `<div class="stat-row"><span>${STAT_NAMES[key] || titleCase(key)}</span><span class="stat-num">${value}</span><div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div></div>`;
  }).join("");
  return `<div class="stats-wrap">${rows}<div class="total-stat"><span>Base stat total</span><span>${total}</span></div></div>`;
}
function abilityMarkup(pokemonId) {
  const rows = state.abilitiesByPokemon.get(pokemonId) || [];
  return `<div class="detail-grid">${rows.sort((a,b)=>a.slot-b.slot).map((row) => {
    const ability = state.abilities.get(row.id);
    return `<div class="info-card"><h3>${titleCase(ability?.name || `Ability #${row.id}`)}${row.hidden ? " · Hidden" : ""}</h3><p style="margin:0;color:var(--muted);font-size:.78rem;line-height:1.55">${ability?.description || "Description unavailable."}</p></div>`;
  }).join("") || '<div class="info-card">No ability data available.</div>'}</div>`;
}
function evolutionMarkup(speciesId) {
  const outgoing = state.evolutionRows.filter((row) => Number(row.evolved_species_id) && Number(row.evolves_from_species_id || row.evolved_species_id) === Number(row.evolved_species_id));
  const family = [];
  const seen = new Set([speciesId]);
  const queue=[speciesId];
  while(queue.length){
    const current=queue.shift();
    for(const row of state.evolutionRows){
      const to=Number(row.evolved_species_id), from=Number(row.evolves_from_species_id || 0);
      if(from===current && !seen.has(to)){seen.add(to);queue.push(to);}
      if(to===current && from && !seen.has(from)){seen.add(from);queue.push(from);}
    }
  }
  for(const id of [...seen].sort((a,b)=>a-b)){
    const species=state.speciesRows.find((s)=>Number(s.id)===id); if(species) family.push(species);
  }
  if(!family.length) return '<div class="info-card">No evolution data.</div>';
  return `<div class="evolution-track">${family.map((species,index)=>{
    const mon=state.pokemon.find((p)=>Number(p.species_id)===Number(species.id)&&p.is_default);
    if(!mon) return "";
    const reqRows=state.evolutionRows.filter((r)=>Number(r.evolved_species_id)===Number(species.id));
    let req="Base form";
    if(index) {
      const r=reqRows[0];
      const bits=[];
      if(r?.minimum_level) bits.push(`Level ${r.minimum_level}+`);
      if(r?.trigger_item_id) bits.push(`Item #${r.trigger_item_id}`);
      if(r?.held_item_id) bits.push(`Hold item #${r.held_item_id}`);
      if(r?.time_of_day) bits.push(titleCase(r.time_of_day));
      if(r?.minimum_happiness) bits.push(`Happiness ${r.minimum_happiness}+`);
      if(r?.minimum_affection) bits.push(`Affection ${r.minimum_affection}+`);
      if(r?.gender_id) bits.push(r.gender_id === "1" ? "Female" : "Male");
      req=bits.join(" · ") || "Special condition";
    }
    return `${index ? '<div class="evo-arrow">→</div>' : ""}<button class="evo-node" data-id="${mon.id}" type="button"><img loading="lazy" src="${spriteUrl(mon.id)}" alt="${formatSpeciesName(mon.identifier)}"><strong>${formatSpeciesName(mon.identifier)}</strong><small>${req}</small></button>`;
  }).join("")}</div>`;
}
function movesMarkup(pokemonId) {
  const rows = state.movesByPokemon?.get(pokemonId) || [];
  const unique = new Map();
  rows.forEach((row) => {
    const move = state.moves.get(row.moveId); if(!move) return;
    const key=`${move.name}|${row.method}|${row.level}|${row.versionGroup}`;
    if(!unique.has(key)) unique.set(key,{...move,level:row.level,method:row.method,versionGroup:row.versionGroup});
  });
  return `<div class="moves-box">${[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name)).map((move)=>`<div class="move-row"><strong>${titleCase(move.name)}</strong><span>${move.power ? `${move.power} power` : "Status"}</span><span>${move.pp ? `${move.pp} PP` : ""}</span></div>`).join("") || '<div class="info-card">No move data available.</div>'}</div>`;
}
function formsMarkup(speciesId) {
  const forms=state.pokemon.filter((p)=>Number(p.species_id)===Number(speciesId));
  if(!forms.length) return '<div class="info-card">No varieties recorded.</div>';
  return `<div class="form-grid">${forms.map((p)=>`<button class="form-card" type="button" data-id="${p.id}"><img loading="lazy" src="${spriteUrl(p.id)}" onerror="this.src='${SPRITES}/${p.id}.png';this.onerror=null" alt="${formatSpeciesName(p.identifier)}"><strong>${formatSpeciesName(p.identifier)}${p.is_default ? " · default" : ""}</strong></button>`).join("")}</div>`;
}
function speciesInfoMarkup(species,pokemon) {
  const genderRate=Number(species?.gender_rate);
  const gender=genderRate<0 ? "Genderless" : `${100-(genderRate/8)*100}% male · ${(genderRate/8)*100}% female`;
  const classification=species?.is_legendary==="1" ? "Legendary" : species?.is_mythical==="1" ? "Mythical" : species?.is_baby==="1" ? "Baby" : "Standard";
  const region=regionForId(pokemon.id);
  return `<div class="detail-grid">
    <div class="info-card"><h3>Biology</h3><div class="info-lines">
      <div class="info-line"><span>Rarity</span><span>${rarity.label}</span></div>
      <div class="info-line"><span>Region</span><span>${titleCase(region)}</span></div>
      <div class="info-line"><span>Classification</span><span>${classification}</span></div>
      <div class="info-line"><span>Color ID</span><span>${species?.color_id || "—"}</span></div>
      <div class="info-line"><span>Shape ID</span><span>${species?.shape_id || "—"}</span></div>
      <div class="info-line"><span>Habitat ID</span><span>${species?.habitat_id || "—"}</span></div>
    </div></div>
    <div class="info-card"><h3>Breeding & catching</h3><div class="info-lines">
      <div class="info-line"><span>Gender</span><span>${gender}</span></div>
      <div class="info-line"><span>Capture rate</span><span>${species?.capture_rate || "—"} / 255</span></div>
      <div class="info-line"><span>Base happiness</span><span>${species?.base_happiness || "—"}</span></div>
      <div class="info-line"><span>Hatch cycles</span><span>${species?.hatch_counter || "—"}</span></div>
      <div class="info-line"><span>Growth rate ID</span><span>${species?.growth_rate_id || "—"}</span></div>
    </div></div>
    <div class="info-card"><h3>Physical</h3><div class="info-lines">
      <div class="info-line"><span>Height</span><span>${(Number(pokemon.height)/10).toFixed(1)} m</span></div>
      <div class="info-line"><span>Weight</span><span>${(Number(pokemon.weight)/10).toFixed(1)} kg</span></div>
      <div class="info-line"><span>Base experience</span><span>${pokemon.base_experience || "—"}</span></div>
      <div class="info-line"><span>Default form</span><span>${pokemon.is_default === "1" ? "Yes" : "No"}</span></div>
    </div></div>
    <div class="info-card"><h3>Egg groups / flags</h3><div class="info-lines">
      <div class="info-line"><span>Gender differences</span><span>${species?.has_gender_differences==="1" ? "Yes" : "No"}</span></div>
      <div class="info-line"><span>Forms switchable</span><span>${species?.forms_switchable==="1" ? "Yes" : "No"}</span></div>
      <div class="info-line"><span>Evolution chain ID</span><span>${species?.evolution_chain_id || "—"}</span></div>
    </div></div>
  </div>`;
}
function flavorMarkup(species) {
  const entries=(species?.englishFlavor||[]).slice(-30);
  const unique=[],seen=new Set();
  for(const row of entries){const text=cleanText(row.flavor_text);if(!text||seen.has(text))continue;seen.add(text);unique.push({text,version:row.version_id});}
  return `<details class="disclosure" open><summary>Pokédex entries (${unique.length})</summary><div style="display:grid;gap:8px;padding-bottom:12px">${unique.map((x)=>`<div class="text-chip" style="display:block;line-height:1.5"><strong>Version #${x.version}</strong><br>${x.text}</div>`).join("") || '<div class="text-chip">No English entries available in the repository data.</div>'}</div></details>`;
}
async function openDetail(id) {
  if(!id)return;
  els.overlay.classList.remove("hidden");els.panel.classList.add("open");els.panel.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";els.detail.innerHTML='<div class="loading"><div><div class="spinner"></div>Loading repository data…</div></div>';
  els.crumb.textContent=`Pokémon #${String(id).padStart(4,"0")}`;
  history.replaceState(null,"",`#pokemon=${id}`);
  try {
    await loadDetailData(); await loadAbilityData();
    const pokemon=state.pokemon.find((p)=>p.id===id), species=getSpecies(id);
    const rarity=rarityForSpecies(species);
    if(!pokemon||!species) throw new Error("Pokemon was not found in repository data");
    const types=state.typesByPokemon.get(id)||[];
    const flavor=cleanText(species.englishFlavor?.at(-1)?.flavor_text||"");
    els.detail.innerHTML=`
      <section class="detail-hero">
        <div class="detail-art"><img src="${spriteUrl(pokemon.id)}" onerror="this.src='${SPRITES}/${pokemon.id}.png';this.onerror=null" alt="${formatSpeciesName(pokemon.identifier)} official artwork"></div>
        <div class="detail-heading">
          <div class="eyebrow">GENERATION ${GEN_ROMAN[generationForId(pokemon.id)] || generationForId(pokemon.id)}</div>
          <h1 id="detailTitle">${formatSpeciesName(species.identifier)}</h1>
          <div class="dex">National Dex #${String(pokemon.id).padStart(4,"0")}</div>
          <div class="type-list">${rarityBadge(rarity)}</div>
          <div class="type-list">${typeBadges(types)}</div>
          <p class="detail-subtitle">${flavor || "No English Pokédex entry was available."}</p>
        </div>
      </section>
      ${speciesInfoMarkup(species,pokemon)}
      <section class="section-block"><h2>Base stats</h2>${statMarkup(pokemon.id)}</section>
      <section class="section-block"><h2>Type matchups</h2>${effectivenessMarkup(types)}</section>
      <section class="section-block"><h2>Abilities</h2>${abilityMarkup(pokemon.id)}</section>
      <section class="section-block"><h2>Evolution family</h2>${evolutionMarkup(Number(species.id))}</section>
      <section class="section-block"><h2>Forms & varieties</h2>${formsMarkup(Number(species.id))}</section>
      <section class="section-block"><h2>Moves (${(state.movesByPokemon?.get(pokemon.id)||[]).length})</h2>${movesMarkup(pokemon.id)}</section>
      ${flavorMarkup(species)}
      <section class="section-block"><h2>Source</h2><div class="info-card"><span style="color:var(--muted);font-size:.77rem;line-height:1.5">This profile is assembled from the CSV database in the public <strong>PokeAPI/pokeapi</strong> GitHub repository. The site does not depend on the hosted pokeapi.co service.</span></div></section>`;
    els.detail.querySelectorAll("[data-id]").forEach((button)=>button.addEventListener("click",()=>openDetail(Number(button.dataset.id))));
  } catch(error) {
    console.error(error);
    els.detail.innerHTML='<div class="error-box"><strong>Repository data could not be loaded.</strong><br>GitHub was reachable but one or more PokeAPI CSV files could not be downloaded. Reload and try again.</div>';
  }
}
function closeDetail(){
  els.overlay.classList.add("hidden");els.panel.classList.remove("open");els.panel.setAttribute("aria-hidden","true");
  document.body.style.overflow="";history.replaceState(null,"",location.pathname+location.search);
}
function setStatus(message,tone="success"){
  els.status.textContent=message;
  els.status.style.color=tone==="error"?"var(--danger)":tone==="loading"?"var(--warning)":"var(--success)";
  els.status.style.background=tone==="error"?"rgba(251,113,133,.1)":tone==="loading"?"rgba(251,191,36,.1)":"rgba(52,211,153,.1)";
}
function setTheme(theme){
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem("poke-theme",theme)}catch{}
  els.theme.textContent=theme==="light"?"☀":"☾";
}
async function initCatalog(){
  setStatus("Loading Pokémon database from GitHub…","loading");
  try{
    const [pokemonRows,typeRows,speciesRows]=await Promise.all([
      cachedCSV("pokemon.csv"),
      cachedCSV("pokemon_types.csv"),
      cachedCSV("pokemon_species.csv").catch(() => [])
    ]);
    state.speciesRows = speciesRows;
    state.pokemon=pokemonRows.filter((row)=>row.is_default==="1" && Number(row.id)<=1025).map((row)=>({...row,id:Number(row.id)}));
    for(const row of typeRows){
      const id=Number(row.pokemon_id);
      if(id>1025)continue;
      const list=state.typesByPokemon.get(id)||[];
      // type IDs are resolved after types.csv loads; keep the numeric ID for now.
      list.push(`#${row.type_id}`);
      state.typesByPokemon.set(id,list);
    }
    // Resolve type IDs without contacting an API.
    const types=await cachedCSV("types.csv").catch(()=>[]);
    const typeMap=new Map(types.map((r)=>[`#${r.id}`,r.identifier]));
    for(const [id,list] of state.typesByPokemon) state.typesByPokemon.set(id,list.map((x)=>typeMap.get(x)).filter(Boolean));
    populateFilters();renderCatalog();setStatus(`${state.pokemon.length.toLocaleString()} Pokémon indexed from GitHub`);
    const hashId=Number(location.hash.match(/(?:pokemon|p)=(\d+)/)?.[1]||0);if(hashId)openDetail(hashId);
  }catch(error){
    console.error(error);setStatus("Could not load GitHub data","error");
    els.catalog.innerHTML='<div class="error-box" style="grid-column:1/-1"><strong>The PokeAPI GitHub database could not be reached.</strong><br>Check that GitHub is accessible on this network, then reload.</div>';
  }
}
function randomPokemon(){
  if(!state.currentResults.length)return;
  const item=state.currentResults[Math.floor(Math.random()*state.currentResults.length)];
  openDetail(item.id);
}
els.search.addEventListener("input",(e)=>{state.query=e.target.value;renderCatalog()});
els.generation.addEventListener("change",(e)=>{state.generation=e.target.value;renderCatalog()});
els.type.addEventListener("change",(e)=>{state.type=e.target.value;renderCatalog()});
els.region.addEventListener("change",(e)=>{state.region=e.target.value;renderCatalog()});
els.sort.addEventListener("change",(e)=>{state.sort=e.target.value;renderCatalog()});
els.reset.addEventListener("click",()=>{state.query=state.generation=state.type=state.region="";state.sort="dex";els.search.value="";els.generation.value="";els.type.value="";els.region.value="";els.sort.value="dex";renderCatalog()});
els.random.addEventListener("click",randomPokemon);els.close.addEventListener("click",closeDetail);els.overlay.addEventListener("click",closeDetail);
els.catalog.addEventListener("click",(e)=>{const card=e.target.closest("[data-id]");if(card)openDetail(Number(card.dataset.id))});
els.theme.addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="light"?"dark":"light"));
document.addEventListener("keydown",(e)=>{if(e.key==="/"&&document.activeElement!==els.search&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();els.search.focus()}if(e.key==="Escape"&&els.panel.classList.contains("open"))closeDetail()});
window.addEventListener("popstate",()=>{const id=Number(location.hash.match(/(?:pokemon|p)=(\d+)/)?.[1]||0);if(id)openDetail(id);else closeDetail()});
setTheme((()=>{try{return localStorage.getItem("poke-theme")||"dark"}catch{return "dark"}})());
initCatalog();
