const API = "https://pokeapi.co/api/v2";
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const ART = `${SPRITES}/other/official-artwork`;
const GEN_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const TYPE_NAMES = ["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
const TYPE_EMOJI = {
  normal:"○",fire:"◈",water:"≈",electric:"ϟ",grass:"✦",ice:"❄",fighting:"✚",
  poison:"☣",ground:"▱",flying:"⌁",psychic:"◉",bug:"◇",rock:"⬢",ghost:"◌",
  dragon:"♢",dark:"☾",steel:"⬡",fairy:"✿"
};
const STAT_NAMES = {
  hp:"HP",attack:"Attack",defense:"Defense","special-attack":"Sp. Atk","special-defense":"Sp. Def",speed:"Speed"
};
const GENERATION_RANGES = [
  [1,151,1,"kanto"],[152,251,2,"johto"],[252,386,3,"hoenn"],[387,493,4,"sinnoh"],
  [494,649,5,"unova"],[650,721,6,"kalos"],[722,809,7,"alola"],[810,905,8,"galar"],[906,1025,9,"paldea"]
];
const REGION_LABELS = {
  kanto:"Kanto",johto:"Johto",hoenn:"Hoenn",sinnoh:"Sinnoh",unova:"Unova",
  kalos:"Kalos",alola:"Alola",galar:"Galar",paldea:"Paldea"
};

const state = {
  species: [],
  generationBySpecies: new Map(),
  regionByGeneration: new Map(),
  typeBySpecies: new Map(),
  typeMeta: new Map(),
  generationMeta: [],
  cache: new Map(),
  abilityCache: new Map(),
  currentResults: [],
  typeLoading: new Set(),
  query: "",
  generation: "",
  type: "",
  region: "",
  sort: "dex"
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
function typeBadges(types) { return (types || []).map((t) => typeBadge(typeof t === "string" ? t : t.type.name)).join(""); }
function cleanText(text) { return String(text || "").replace(/[\n\f]+/g," ").replace(/\s+/g," ").trim(); }
function englishText(entries,key="flavor_text") {
  const english = (entries || []).filter((entry) => entry.language?.name === "en");
  return english.length ? english[english.length - 1][key] || "" : "";
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
async function cachedJSON(url,key=url) {
  if (state.cache.has(key)) return state.cache.get(key);
  const promise = fetchJSON(url).catch((error) => { state.cache.delete(key); throw error; });
  state.cache.set(key,promise);
  return promise;
}
function fallbackGenerationForId(id) {
  const match = GENERATION_RANGES.find(([min,max]) => id >= min && id <= max);
  return match ? match[2] : 0;
}
function fallbackRegionForGeneration(generation) {
  return GENERATION_RANGES.find(([, ,gen]) => gen === generation)?.[3] || "";
}
function generationNumber(data) { return Number(data?.url?.match(/generation\/(\d+)/)?.[1] || 0); }

function populateFilters() {
  els.generation.innerHTML = '<option value="">All generations</option>' +
    GENERATION_RANGES.map(([, ,gen]) => `<option value="${gen}">Generation ${GEN_ROMAN[gen]}</option>`).join("");
  els.region.innerHTML = '<option value="">All regions</option>' +
    Object.entries(REGION_LABELS).map(([value,label]) => `<option value="${value}">${label}</option>`).join("");
  els.type.innerHTML = '<option value="">All types</option>' +
    TYPE_NAMES.map((type) => `<option value="${type}">${titleCase(type)}</option>`).join("");
}

function getGeneration(item) {
  return state.generationBySpecies.get(item.name) || fallbackGenerationForId(item.id);
}
function getRegion(item) {
  const generation = getGeneration(item);
  return state.regionByGeneration.get(generation) || fallbackRegionForGeneration(generation);
}

function matchesFilters(item) {
  const q = state.query.trim().toLowerCase().replace(/^#/,"");
  const types = state.typeBySpecies.get(item.id) || [];
  if (q && !String(item.id).includes(q) && !item.name.includes(q) && !formatSpeciesName(item.name).toLowerCase().includes(q)) return false;
  if (state.generation && getGeneration(item) !== Number(state.generation)) return false;
  if (state.region && getRegion(item) !== state.region) return false;
  if (state.type && !types.includes(state.type)) return false;
  return true;
}

function renderCatalog() {
  let results = state.species.filter(matchesFilters);
  if (state.sort === "name") results.sort((a,b) => formatSpeciesName(a.name).localeCompare(formatSpeciesName(b.name)));
  else if (state.sort === "nameDesc") results.sort((a,b) => formatSpeciesName(b.name).localeCompare(formatSpeciesName(a.name)));
  else results.sort((a,b) => a.id - b.id);
  state.currentResults = results;
  els.resultCount.textContent = results.length.toLocaleString();
  els.empty.classList.toggle("hidden", results.length !== 0);
  els.catalog.innerHTML = results.map((item) => {
    const gen = getGeneration(item);
    const types = state.typeBySpecies.get(item.id) || [];
    return `
      <button class="pokemon-card" type="button" data-id="${item.id}" aria-label="Open ${formatSpeciesName(item.name)} details">
        <div class="card-top"><span class="dex-no">#${String(item.id).padStart(4,"0")}</span><span class="card-gen">${gen ? `GEN ${GEN_ROMAN[gen] || gen}` : ""}</span></div>
        <div class="card-art"><img loading="lazy" src="${spriteUrl(item.id)}" onerror="this.src='${SPRITES}/${item.id}.png';this.onerror=null" alt="${formatSpeciesName(item.name)}"></div>
        <div class="card-name">${formatSpeciesName(item.name)}</div>
        <div class="type-list" data-types-for="${item.id}">${typeBadges(types) || '<span class="text-chip">Loading type…</span>'}</div>
      </button>`;
  }).join("");
  hydrateVisibleTypes(results);
}

async function hydrateVisibleTypes(results) {
  // Load card typings in small batches so a single failed request cannot blank the catalog.
  const visible = results.slice(0, 80);
  for (let i = 0; i < visible.length; i += 10) {
    const batch = visible.slice(i, i + 10);
    await Promise.allSettled(batch.map(async (item) => {
      if (state.typeBySpecies.has(item.id)) return;
      try {
        const pokemon = await cachedJSON(`${API}/pokemon/${item.id}`,`pokemon:${item.id}`);
        state.typeBySpecies.set(item.id, pokemon.types.map((entry) => entry.type.name));
        const target = els.catalog.querySelector(`[data-types-for="${item.id}"]`);
        if (target) target.innerHTML = typeBadges(pokemon.types);
      } catch {
        const target = els.catalog.querySelector(`[data-types-for="${item.id}"]`);
        if (target) target.innerHTML = '<span class="text-chip">Type unavailable</span>';
      }
    }));
  }
}

async function loadTypeFilter(type) {
  if (!type || state.typeLoading.has(type) || state.typeMeta.has(type)) return;
  state.typeLoading.add(type);
  try {
    const data = await fetchJSON(`${API}/type/${type}`);
    state.typeMeta.set(type,data);
    for (const entry of data.pokemon || []) {
      const id = idFromUrl(entry.pokemon?.url);
      if (!id || id > 1025) continue;
      const current = state.typeBySpecies.get(id) || [];
      if (!current.includes(type)) current.push(type);
      state.typeBySpecies.set(id,current);
    }
  } catch (error) {
    console.warn("Type filter failed:",type,error);
  } finally {
    state.typeLoading.delete(type);
  }
  if (state.type === type) renderCatalog();
}

async function loadOptionalMetadata() {
  const generationTask = fetchJSON(`${API}/generation?limit=100`).catch(() => null);
  const typeTask = fetchJSON(`${API}/type?limit=100`).catch(() => null);
  const [generationIndex,typeIndex] = await Promise.all([generationTask,typeTask]);

  if (generationIndex?.results?.length) {
    const generationResults = await Promise.allSettled(generationIndex.results.map((resource) => fetchJSON(resource.url)));
    for (const result of generationResults) {
      if (result.status !== "fulfilled") continue;
      const data = result.value;
      const id = data.id;
      state.regionByGeneration.set(id,data.main_region?.name || fallbackRegionForGeneration(id));
      for (const species of data.pokemon_species || []) state.generationBySpecies.set(species.name,id);
    }
  }

  // Type metadata is optional. The site can already render without it.
  if (typeIndex?.results?.length) {
    const typeResults = await Promise.allSettled(typeIndex.results.map((resource) => fetchJSON(resource.url)));
    for (const result of typeResults) {
      if (result.status !== "fulfilled") continue;
      const data = result.value;
      if (TYPE_NAMES.includes(data.name) && data.damage_relations) state.typeMeta.set(data.name,data);
    }
  }
  populateFilters();
  renderCatalog();
}

function setStatus(message,tone="success") {
  els.status.textContent = message;
  els.status.style.color = tone === "error" ? "var(--danger)" : tone === "loading" ? "var(--warning)" : "var(--success)";
  els.status.style.background = tone === "error" ? "rgba(251,113,133,.1)" : tone === "loading" ? "rgba(251,191,36,.1)" : "rgba(52,211,153,.1)";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("poke-theme",theme); } catch {}
  els.theme.textContent = theme === "light" ? "☀" : "☾";
}

async function initCatalog() {
  setStatus("Loading catalog…","loading");
  try {
    let index;
    try {
      index = await fetchJSON(`${API}/pokemon-species?limit=2000`);
    } catch {
      index = await fetchJSON(`${API}/pokemon?limit=2000`);
    }

    state.species = (index.results || [])
      .map((item) => ({ name:item.name,id:idFromUrl(item.url),url:item.url }))
      .filter((item) => item.id && item.id <= 1025)
      .sort((a,b) => a.id - b.id);

    if (!state.species.length) throw new Error("The API returned an empty catalog.");

    // Render immediately. Optional metadata must never prevent the catalog from appearing.
    populateFilters();
    renderCatalog();
    setStatus(`${state.species.length.toLocaleString()} Pokémon indexed`);

    // Enrich in the background.
    await loadOptionalMetadata();
    setStatus(`${state.species.length.toLocaleString()} Pokémon indexed`);
    const hashId = Number(location.hash.match(/(?:pokemon|p)=(\d+)/)?.[1] || 0);
    if (hashId) openDetail(hashId);
  } catch (error) {
    console.error(error);
    setStatus("Could not load data","error");
    els.catalog.innerHTML = `<div class="error-box" style="grid-column:1/-1"><strong>PokéAPI could not be reached.</strong><br>Check your connection or try reloading the page.</div>`;
  }
}

function statMarkup(stats) {
  const total = (stats || []).reduce((sum,s) => sum + (s.base_stat || 0),0);
  const rows = (stats || []).map((stat) => {
    const value = stat.base_stat || 0, pct = Math.min(100,(value/255)*100);
    return `<div class="stat-row"><span>${STAT_NAMES[stat.stat.name] || titleCase(stat.stat.name)}</span><span class="stat-num">${value}</span><div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div></div>`;
  }).join("");
  return `<div class="stats-wrap">${rows}<div class="total-stat"><span>Base stat total</span><span>${total}</span></div></div>`;
}
function damageMultiplier(attacker,defenderTypes) {
  let multiplier = 1;
  for (const defender of defenderTypes) {
    const targetData = state.typeMeta.get(defender);
    if (!targetData) continue;
    if ((targetData.damage_relations.double_damage_from || []).some((x) => x.name === attacker)) multiplier *= 2;
    if ((targetData.damage_relations.half_damage_from || []).some((x) => x.name === attacker)) multiplier *= .5;
    if ((targetData.damage_relations.no_damage_from || []).some((x) => x.name === attacker)) multiplier *= 0;
  }
  return multiplier;
}
function effectivenessMarkup(types) {
  if (!TYPE_NAMES.every((type) => state.typeMeta.has(type))) return '<div class="info-card"><span style="color:var(--muted);font-size:.77rem">Type matchup data is still loading. This section will populate shortly.</span></div>';
  const incoming = TYPE_NAMES.map((attacker) => ({attacker,mult:damageMultiplier(attacker,types)}));
  const weak = incoming.filter((x) => x.mult > 1).sort((a,b) => b.mult-a.mult);
  const resist = incoming.filter((x) => x.mult > 0 && x.mult < 1).sort((a,b) => a.mult-b.mult);
  const immune = incoming.filter((x) => x.mult === 0);
  const group = (items) => items.map((x) => `<span class="effect-tag">${titleCase(x.attacker)} · ${x.mult}×</span>`).join("") || "<p>None</p>";
  return `<div class="effect-grid"><div class="effect-card"><h3>Weak to</h3><div class="effect-list">${group(weak)}</div></div><div class="effect-card"><h3>Resists</h3><div class="effect-list">${group(resist)}</div></div><div class="effect-card"><h3>Immune to</h3><div class="effect-list">${group(immune)}</div></div></div>`;
}
async function getAbility(name,url) {
  if (state.abilityCache.has(name)) return state.abilityCache.get(name);
  const promise = fetchJSON(url).catch((error) => { state.abilityCache.delete(name); throw error; });
  state.abilityCache.set(name,promise);
  return promise;
}
function abilityDescription(data) {
  const entry = (data.effect_entries || []).find((x) => x.language?.name === "en");
  return cleanText(entry?.short_effect || entry?.effect || "No English description was provided.");
}
function moveListMarkup(pokemon) {
  const moves = [];
  for (const entry of pokemon.moves || []) for (const detail of entry.version_group_details || []) moves.push({
    name:entry.move.name,method:titleCase(detail.move_learn_method?.name || "other"),
    level:detail.level_learned_at || 0,version:titleCase(detail.version_group?.name || "")
  });
  moves.sort((a,b) => a.name.localeCompare(b.name) || a.method.localeCompare(b.method) || a.level-b.level);
  const unique = new Map();
  for (const move of moves) {
    const key = `${move.name}|${move.method}|${move.level}|${move.version}`;
    if (!unique.has(key)) unique.set(key,move);
  }
  return [...unique.values()].map((move) => `<div class="move-row"><strong>${titleCase(move.name)}</strong><span>${move.method}</span><span>${move.level ? `Lv. ${move.level}` : move.version}</span></div>`).join("");
}
function flattenEvolution(node,out=[],depth=0,parent="") {
  if (!node) return out;
  out.push({species:node.species,depth,parent,details:node.evolution_details || []});
  for (const next of node.evolves_to || []) flattenEvolution(next,out,depth+1,node.species.name);
  return out;
}
function evolutionRequirement(details) {
  if (!details?.length) return "Base form";
  const labels = new Set();
  for (const d of details) {
    if (d.min_level) labels.add(`Level ${d.min_level}+`);
    if (d.item?.name) labels.add(titleCase(d.item.name));
    if (d.held_item?.name) labels.add(`Hold ${titleCase(d.held_item.name)}`);
    if (d.trigger?.name && d.trigger.name !== "level-up") labels.add(titleCase(d.trigger.name));
    if (d.time_of_day) labels.add(titleCase(d.time_of_day));
    if (d.min_happiness) labels.add(`Happiness ${d.min_happiness}+`);
    if (d.min_affection) labels.add(`Affection ${d.min_affection}+`);
    if (d.known_move?.name) labels.add(`Know ${titleCase(d.known_move.name)}`);
    if (d.known_move_type?.name) labels.add(`Know a ${titleCase(d.known_move_type.name)} move`);
    if (d.location?.name) labels.add(`At ${titleCase(d.location.name)}`);
    if (d.gender === 1) labels.add("Female");
    if (d.gender === 2) labels.add("Male");
    if (d.relative_physical_stats === 1) labels.add("Attack > Defense");
    if (d.relative_physical_stats === -1) labels.add("Attack < Defense");
    if (d.turn_upside_down) labels.add("Hold upside down");
  }
  return [...labels].join(" · ") || "Special condition";
}
function evolutionMarkup(chain) {
  const flat = flattenEvolution(chain);
  if (!flat.length) return '<div class="info-card">No evolution chain data.</div>';
  return `<div class="evolution-track">${flat.map((node,index) => {
    const id = idFromUrl(node.species.url);
    return `${index ? '<div class="evo-arrow">→</div>' : ""}<button class="evo-node" data-id="${id}" type="button"><img loading="lazy" src="${spriteUrl(id)}" onerror="this.src='${SPRITES}/${id}.png';this.onerror=null" alt="${formatSpeciesName(node.species.name)}"><strong>${formatSpeciesName(node.species.name)}</strong><small>${index===0 ? "Base" : evolutionRequirement(node.details)}</small></button>`;
  }).join("")}</div>`;
}
function formsMarkup(species) {
  const varieties = species.varieties || [];
  if (!varieties.length) return '<div class="info-card">No alternate varieties recorded.</div>';
  return `<div class="form-grid">${varieties.map((v) => {
    const id = idFromUrl(v.pokemon.url);
    return `<button class="form-card" type="button" data-id="${id}"><img loading="lazy" src="${spriteUrl(id)}" onerror="this.src='${SPRITES}/${id}.png';this.onerror=null" alt="${titleCase(v.pokemon.name)}"><strong>${titleCase(v.pokemon.name)}${v.is_default ? " · default" : ""}</strong></button>`;
  }).join("")}</div>`;
}
function speciesFacts(species,pokemon) {
  const rate = species.gender_rate;
  let gender = "Genderless";
  if (rate >= 0) { const female = (rate/8)*100; gender = `${100-female}% male · ${female}% female`; }
  const classification = species.is_legendary ? "Legendary" : species.is_mythical ? "Mythical" : species.is_baby ? "Baby" : "Standard";
  return `<div class="detail-grid">
    <div class="info-card"><h3>Biology</h3><div class="info-lines">
      <div class="info-line"><span>Genus</span><span>${cleanText(species.genera?.find((x)=>x.language?.name==="en")?.genus || "—")}</span></div>
      <div class="info-line"><span>Color</span><span>${titleCase(species.color?.name || "—")}</span></div>
      <div class="info-line"><span>Shape</span><span>${titleCase(species.shape?.name || "—")}</span></div>
      <div class="info-line"><span>Habitat</span><span>${titleCase(species.habitat?.name || "Unknown")}</span></div>
      <div class="info-line"><span>Classification</span><span>${classification}</span></div>
    </div></div>
    <div class="info-card"><h3>Breeding & catching</h3><div class="info-lines">
      <div class="info-line"><span>Gender</span><span>${gender}</span></div>
      <div class="info-line"><span>Capture rate</span><span>${species.capture_rate ?? "—"} / 255</span></div>
      <div class="info-line"><span>Base happiness</span><span>${species.base_happiness ?? "—"}</span></div>
      <div class="info-line"><span>Hatch cycles</span><span>${species.hatch_counter ?? "—"}</span></div>
      <div class="info-line"><span>Growth rate</span><span>${titleCase(species.growth_rate?.name || "—")}</span></div>
    </div></div>
    <div class="info-card"><h3>Physical</h3><div class="info-lines">
      <div class="info-line"><span>Height</span><span>${(pokemon.height/10).toFixed(1)} m</span></div>
      <div class="info-line"><span>Weight</span><span>${(pokemon.weight/10).toFixed(1)} kg</span></div>
      <div class="info-line"><span>Base experience</span><span>${pokemon.base_experience ?? "—"}</span></div>
      <div class="info-line"><span>Order</span><span>${pokemon.order ?? "—"}</span></div>
    </div></div>
    <div class="info-card"><h3>Egg groups</h3><div class="chip-wrap">${(species.egg_groups||[]).map((g)=>`<span class="text-chip">${titleCase(g.name)}</span>`).join("") || '<span class="text-chip">None</span>'}</div></div>
  </div>`;
}
function pastDataMarkup(pokemon) {
  const sections = [];
  if ((pokemon.past_types||[]).length) sections.push(`<details class="disclosure"><summary>Past typings</summary><div class="chip-wrap" style="padding-bottom:12px">${pokemon.past_types.map((x)=>`<span class="text-chip"><strong>${titleCase(x.generation?.name||"")}</strong> ${typeBadges(x.types||[])}</span>`).join("")}</div></details>`);
  if ((pokemon.past_abilities||[]).length) sections.push(`<details class="disclosure"><summary>Past abilities</summary><div class="chip-wrap" style="padding-bottom:12px">${pokemon.past_abilities.map((x)=>`<span class="text-chip"><strong>${titleCase(x.generation?.name||"")}</strong> ${(x.abilities||[]).map((a)=>titleCase(a.ability?.name||"None")).join(", ")}</span>`).join("")}</div></details>`);
  if ((pokemon.past_stats||[]).length) sections.push(`<details class="disclosure"><summary>Historical base stats</summary><div class="chip-wrap" style="padding-bottom:12px">${pokemon.past_stats.map((x)=>`<span class="text-chip"><strong>${titleCase(x.generation?.name||"")}</strong> ${x.stats?.map((s)=>`${STAT_NAMES[s.stat?.name]||titleCase(s.stat?.name)} ${s.base_stat}`).join(" · ")}</span>`).join("")}</div></details>`);
  return sections.join("");
}
function dexTextMarkup(species) {
  const entries = [...(species.flavor_text_entries||[])].filter((x)=>x.language?.name==="en");
  const unique=[],seen=new Set();
  for (const entry of entries) {
    const text=cleanText(entry.flavor_text); if (!text || seen.has(text)) continue;
    seen.add(text); unique.push({text,version:titleCase(entry.version?.name||"")});
  }
  return `<details class="disclosure" open><summary>Pokédex entries (${unique.length})</summary><div style="display:grid;gap:8px;padding-bottom:12px">${unique.map((x)=>`<div class="text-chip" style="display:block;line-height:1.5"><strong>${x.version}</strong><br>${x.text}</div>`).join("") || '<div class="text-chip">No English entries available.</div>'}</div></details>`;
}
async function loadDetail(id) {
  const pokemon = await cachedJSON(`${API}/pokemon/${id}`,`pokemon:${id}`);
  let species;
  try {
    species = await cachedJSON(`${API}/pokemon-species/${id}`,`species:${id}`);
  } catch {
    species = await cachedJSON(`${API}/pokemon/${id}`,`pokemon:${id}`);
  }
  const evo = species.evolution_chain?.url ? await cachedJSON(species.evolution_chain.url,`evo:${species.evolution_chain.url}`).catch(() => null) : null;
  return {pokemon,species,evo};
}
async function openDetail(id) {
  if (!id) return;
  els.overlay.classList.remove("hidden");els.panel.classList.add("open");els.panel.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";els.detail.innerHTML='<div class="loading"><div><div class="spinner"></div>Loading Pokémon data…</div></div>';
  els.crumb.textContent = `Pokémon #${String(id).padStart(4,"0")}`;
  history.replaceState(null,"",`#pokemon=${id}`);
  try {
    const {pokemon,species,evo} = await loadDetail(id);
    const abilityData = await Promise.all((pokemon.abilities||[]).map((a)=>getAbility(a.ability.name,a.ability.url).catch(()=>null)));
    const types = (pokemon.types||[]).map((t)=>t.type.name);
    const abilities = (pokemon.abilities||[]).map((a,i)=>({name:a.ability.name,hidden:a.is_hidden,description:abilityDescription(abilityData[i]||{})}));
    state.typeBySpecies.set(id,types);
    els.detail.innerHTML = `
      <section class="detail-hero">
        <div class="detail-art"><img src="${spriteUrl(pokemon.id)}" onerror="this.src='${SPRITES}/${pokemon.id}.png';this.onerror=null" alt="${formatSpeciesName(species.name)} official artwork"></div>
        <div class="detail-heading">
          <div class="eyebrow">${generationNumber(species) ? `GENERATION ${GEN_ROMAN[generationNumber(species)] || generationNumber(species)}` : "POKÉMON SPECIES"}</div>
          <h1 id="detailTitle">${formatSpeciesName(species.name)}</h1>
          <div class="dex">National Dex #${String(pokemon.id).padStart(4,"0")}</div>
          <div class="type-list">${typeBadges(pokemon.types)}</div>
          <p class="detail-subtitle">${cleanText(englishText(species.flavor_text_entries)) || "No English Pokédex description is available for this species."}</p>
        </div>
      </section>
      ${speciesFacts(species,pokemon)}
      <section class="section-block"><h2>Base stats</h2>${statMarkup(pokemon.stats)}</section>
      <section class="section-block"><h2>Type matchups</h2>${effectivenessMarkup(types)}</section>
      <section class="section-block"><h2>Abilities</h2><div class="detail-grid">${abilities.map((a)=>`<div class="info-card"><h3>${titleCase(a.name)}${a.hidden ? " · Hidden" : ""}</h3><p style="margin:0;color:var(--muted);font-size:.78rem;line-height:1.55">${a.description}</p></div>`).join("")}</div></section>
      <section class="section-block"><h2>Evolution family</h2>${evolutionMarkup(evo?.chain)}</section>
      <section class="section-block"><h2>Forms & varieties (${species.varieties?.length || 0})</h2>${formsMarkup(species)}</section>
      <section class="section-block"><h2>Moves (${pokemon.moves?.length || 0} move names)</h2><div class="moves-box">${moveListMarkup(pokemon) || '<div class="info-card">No move data available.</div>'}</div></section>
      <section class="section-block"><h2>Held items</h2><div class="chip-wrap">${(pokemon.held_items||[]).map((x)=>`<span class="text-chip">${titleCase(x.item.name)}</span>`).join("") || '<span class="text-chip">None recorded</span>'}</div></section>
      <section class="section-block"><h2>Game data & cries</h2><div class="info-card"><div class="info-lines">
        <div class="info-line"><span>Game index entries</span><span>${pokemon.game_indices?.length || 0}</span></div>
        <div class="info-line"><span>Gender differences</span><span>${species.has_gender_differences ? "Yes" : "No"}</span></div>
        <div class="info-line"><span>Switchable forms</span><span>${species.forms_switchable ? "Yes" : "No"}</span></div>
      </div><div class="audio-row" style="margin-top:12px">${pokemon.cries?.latest ? `<audio controls preload="none" src="${pokemon.cries.latest}"></audio>` : ""}${pokemon.cries?.legacy ? `<audio controls preload="none" src="${pokemon.cries.legacy}"></audio>` : ""}</div></div></section>
      ${dexTextMarkup(species)}
      <section class="section-block"><h2>Historical changes</h2>${pastDataMarkup(pokemon) || '<div class="info-card"><span style="color:var(--muted);font-size:.77rem">No historical type, ability, or stat changes recorded.</span></div>'}</section>
    `;
    els.detail.querySelectorAll("[data-id]").forEach((button)=>button.addEventListener("click",()=>openDetail(Number(button.dataset.id))));
  } catch (error) {
    console.error(error);
    els.detail.innerHTML='<div class="error-box"><strong>Could not load this Pokémon.</strong><br>The detail request failed. Close this panel and try again.</div>';
  }
}
function closeDetail() {
  els.overlay.classList.add("hidden");els.panel.classList.remove("open");els.panel.setAttribute("aria-hidden","true");
  document.body.style.overflow="";history.replaceState(null,"",location.pathname+location.search);
}
function randomPokemon() {
  if (!state.currentResults.length) return;
  const item = state.currentResults[Math.floor(Math.random()*state.currentResults.length)];
  openDetail(item.id);
}
function setupEvents() {
  els.search.addEventListener("input",(e)=>{state.query=e.target.value;renderCatalog();});
  els.generation.addEventListener("change",(e)=>{state.generation=e.target.value;renderCatalog();});
  els.type.addEventListener("change",async(e)=>{state.type=e.target.value;if(state.type && !state.typeBySpecies.size) await loadTypeFilter(state.type);renderCatalog();});
  els.region.addEventListener("change",(e)=>{state.region=e.target.value;renderCatalog();});
  els.sort.addEventListener("change",(e)=>{state.sort=e.target.value;renderCatalog();});
  els.reset.addEventListener("click",()=>{state.query=state.generation=state.type=state.region="";state.sort="dex";els.search.value="";els.generation.value="";els.type.value="";els.region.value="";els.sort.value="dex";renderCatalog();});
  els.random.addEventListener("click",randomPokemon);
  els.catalog.addEventListener("click",(e)=>{const card=e.target.closest("[data-id]");if(card)openDetail(Number(card.dataset.id));});
  els.close.addEventListener("click",closeDetail);els.overlay.addEventListener("click",closeDetail);
  document.addEventListener("keydown",(e)=>{if(e.key==="/"&&document.activeElement!==els.search&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();els.search.focus();}if(e.key==="Escape"&&els.panel.classList.contains("open"))closeDetail();});
  els.theme.addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="light" ? "dark" : "light"));
  window.addEventListener("popstate",()=>{const id=Number(location.hash.match(/(?:pokemon|p)=(\d+)/)?.[1]||0);if(id)openDetail(id);else closeDetail();});
}
setTheme((()=>{try{return localStorage.getItem("poke-theme")||"dark"}catch{return "dark"}})());
setupEvents();
initCatalog();
