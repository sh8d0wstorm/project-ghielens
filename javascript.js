// ===== STATE =====
let adminMode = false;
let activePlace = null;
let markers = [];

// ===== DATA =====
const places = [
  { name: "Waterloostraat 11 Antwerpen", lat: 51.2033198, lng: 4.4314819, keywords: ["snijwerk","hout"], image: "images/ghielens.png", description: "Snijwerk in hout." },
  { name: "Cogels-Osylei 4 Antwerpen", lat: 51.2051725, lng: 4.4326872, keywords: ["kunst","gevel"], image: "images/ghielens.png", description: "Kunst aan de gevel." }
];

// ===== SEARCH =====
const fuse = new Fuse(places, {
  keys: ["name", "keywords"],
  threshold: 0.6,
  minMatchCharLength: 2
});

// ===== MAP =====
const map = L.map('map').setView([51.2194, 4.4025], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ===== ELEMENTS =====
const listContainer = document.getElementById("list");
const detailsContainer = document.getElementById("details");
const searchInput = document.getElementById("search");

// ===== FUNCTIONS =====
function showDetails(place) {
  if (activePlace === place) {
    clearDetails();
    return;
  }

  activePlace = place;
  map.setView([place.lat, place.lng], 17);

  detailsContainer.innerHTML = `
    <h3>${place.name}</h3>
    <img src="${place.image}" width="100%">
    <p>${place.description}</p>
  `;
}

function clearDetails() {
  detailsContainer.innerHTML = "";
  activePlace = null;
}

function renderPlaces(list) {
  listContainer.innerHTML = "";

  markers.forEach(m => map.removeLayer(m));
  markers = [];

  list.forEach(place => {
    const marker = L.marker([place.lat, place.lng]).addTo(map);
    
    marker.on("click", () => showDetails(place));

    markers.push(marker);

    const item = document.createElement("div");
    item.textContent = place.name;
    item.onclick = () => showDetails(place);

    listContainer.appendChild(item);
  });
}

// ===== SEARCH =====
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  if (!query) return renderPlaces(places);

  const result = fuse.search(query);
  renderPlaces(result.map(r => r.item));
});

// ===== LOGIN SYSTEM =====
function login() {
  const pw = prompt("Wachtwoord:");

  if (pw === "1234") {
    adminMode = true;

    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const addBtn = document.getElementById("addBtn");

    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (addBtn) addBtn.style.display = "inline-block";

  } else {
    alert("Fout wachtwoord");
  }
}

function logout() {
  adminMode = false;

  document.getElementById("loginBtn").style.display = "inline-block";
  document.getElementById("logoutBtn").style.display = "none";
  document.getElementById("addBtn").style.display = "none";
}
window.addEventListener("load", () => {

  const addBtn = document.getElementById("addBtn");

  addBtn.addEventListener("click", () => {

    console.log("ADD CLICKED"); // 🔥 test

    if (!adminMode) {
      console.log("not admin");
      return;
    }

    const name = prompt("Naam?");
    const lat = Number(prompt("Latitude?"));
    const lng = Number(prompt("Longitude?"));
    const desc = prompt("Beschrijving?");
    const img = prompt("Image?");
    const keywordsInput = prompt("Keywords (komma)");

    const newPlace = {
      name,
      lat,
      lng,
      description: desc,
      image: img,
      keywords: keywordsInput
        ? keywordsInput.split(",").map(k => k.trim())
        : []
    };
    
    places.push(newPlace);
   
  });
// 🔥 rebuild fuse with updated data
fuse.setCollection(places);
   
});
// ===== INIT =====
renderPlaces(places);
  
    setTimeout(() => {
  map.invalidateSize();
}, 100);