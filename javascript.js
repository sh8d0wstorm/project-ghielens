// ===== STATE =====
let adminMode = false;   // true = admin features enabled
let activePlace = null;  // currently selected place
let markers = [];        // leaflet markers on map
let isAdding = false;    // future: add-mode state
let editingPlace = null; // currently edited place
let places = [];
let fuse; // declare first
// ===== DATA =====
const firebaseConfig = {
  apiKey: "AIzaSyDX-AIGkfhSEfBRDt-SRrJyVWRlmtxs7qE",
  authDomain: "project-ghielens.firebaseapp.com",
  projectId: "project-ghielens",
  storageBucket: "project-ghielens.firebasestorage.app",
  messagingSenderId: "720120279485",
  appId: "1:720120279485:web:96b0791f6206dad21ea2d4"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

function initFuse() {
  fuse = new Fuse(places, {
    keys: ["name", "keywords"],
    threshold: 0.6,
    minMatchCharLength: 2
  });
}

function parseCoord(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(",", ".")
    .replace(/[^0-9.-]/g, ""); // removes weird Excel junk

  const num = Number(cleaned);

  return isNaN(num) ? null : num;
}

function loadPlaces() {
  db.collection("places").get().then(snapshot => {
    places = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
console.log("Loading places...");
    initFuse();          // 🔥 rebuild search index
    renderPlaces(places);
  });
}

// ===== MAP =====
const map = L.map('map').setView([51.2194, 4.4025], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

map.on("click", function(e) {
  if (!adminMode || !isAdding) return;

  document.getElementById("m_lat").value = e.latlng.lat;
  document.getElementById("m_lng").value = e.latlng.lng;

  document.getElementById("addModal").style.display = "block";

  isAdding = false;
});
// ===== UI ELEMENTS =====
const listContainer = document.getElementById("list");
const detailsContainer = document.getElementById("details");
const searchInput = document.getElementById("search");

// ===== FUNCTIONS =====
// ===== PLACE DISPLAY =====
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

  ${adminMode ? '<button id="editBtn">Edit</button>' : ''}
  ${adminMode ? '<button id="deleteBtn">Delete</button>' : ''}
`;
  if (adminMode) {
    document.getElementById("editBtn").addEventListener("click", () => {
      editLocation(place);
    });

    document.getElementById("deleteBtn").addEventListener("click", () => {
      deleteLocation(place);
    });
  }
}

// ===== ADD LOCATION =====
function startAddLocation() {
  if (!adminMode) return;
  const lat = parseCoord(document.getElementById("m_lat").value);
  const lng = parseCoord(document.getElementById("m_lng").value);
  document.getElementById("addModal").style.display = "block";
}
function startMapPick() {
  if (!adminMode) return;

  isAdding = true;
  alert("Click a location on the map.");
}
function confirmAdd() {
  const name = document.getElementById("m_name").value;
  const lat = Number(document.getElementById("m_lat").value);
  const lng = Number(document.getElementById("m_lng").value);
  const desc = document.getElementById("m_desc").value;
  const img = document.getElementById("m_img").value;
  const keywordsInput = document.getElementById("m_keywords").value;

  const newPlace = {
    name,
    lat,
    lng,
    description: desc,
    image: img,
    keywords: keywordsInput
      .split(",")
      .map(k => k.trim())
      .filter(k => k !== "")
  };

  db.collection("places").add(newPlace).then(() => {
  loadPlaces();
});

closeAddModal();

}

function closeAddModal() {
  document.getElementById("addModal").style.display = "none";
}

function clearDetails() {
  detailsContainer.innerHTML = "";
  activePlace = null;
}
// ===== ADMIN EDITING =====
function editLocation(place) {
  editingPlace = place;

  document.getElementById("e_name").value = place.name;
  document.getElementById("e_lat").value = place.lat;
  document.getElementById("e_lng").value = place.lng;
  document.getElementById("e_desc").value = place.description;
  document.getElementById("e_img").value = place.image;
  document.getElementById("e_keywords").value = place.keywords.join(",");
  document.getElementById("editModal").style.display = "block";
  editingPlace.lat = parseCoord(document.getElementById("e_lat").value);
  editingPlace.lng = parseCoord(document.getElementById("e_lng").value);
}
function confirmEdit() {
  if (!editingPlace) return;

  editingPlace.name = document.getElementById("e_name").value;
  editingPlace.lat = parseCoord(document.getElementById("e_lat").value);
  editingPlace.lng = parseCoord(document.getElementById("e_lng").value);
  editingPlace.description = document.getElementById("e_desc").value;
  editingPlace.image = document.getElementById("e_img").value;

  editingPlace.keywords = document
    .getElementById("e_keywords")
    .value
    .split(",")
    .map(k => k.trim())
    .filter(k => k !== "");

  db.collection("places").doc(editingPlace.id).update({
    name: editingPlace.name,
    lat: editingPlace.lat,
    lng: editingPlace.lng,
    description: editingPlace.description,
    image: editingPlace.image,
    keywords: editingPlace.keywords
  }).then(() => {
    loadPlaces();
  });

  closeEditModal();
}
function closeEditModal() {
  document.getElementById("editModal").style.display = "none";
}
function deleteLocation(place) {
  db.collection("places").doc(place.id).delete().then(() => {
    loadPlaces();
  });
}

function updateUI() {
  const addBtn = document.getElementById("addBtn");
  const excelFile = document.getElementById("excelFile");
  const modal = document.getElementById("addModal");
  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("password");

  if (addBtn) addBtn.style.display = adminMode ? "inline-block" : "none";
  if (excelFile) excelFile.style.display = adminMode ? "block" : "none";

  if (loginForm) loginForm.style.display = adminMode ? "none" : "block";
  document.getElementById("logoutBtn").style.display =
    adminMode ? "inline-block" : "none";

  if (!adminMode && modal) {
    modal.style.display = "none"; // 🔥 prevents stuck modal
  }

  if (passwordInput && !adminMode) {
    passwordInput.value = "";
  }

  if (addBtn) addBtn.onclick = startAddLocation;
  
  const pickMapBtn = document.getElementById("pickMapBtn");

  if (pickMapBtn) {
    pickMapBtn.style.display =
      adminMode ? "inline-block" : "none";

    pickMapBtn.onclick = startMapPick;
  }
}

function renderPlaces(list) {
  listContainer.innerHTML = "";

  markers.forEach(m => map.removeLayer(m));
  markers = [];

  list.forEach(place => {
    if (place.lat == null || place.lng == null) {
      console.warn("Skipping bad place:", place);
      return;
    }

    const marker = L.marker([place.lat, place.lng]).addTo(map);
    markers.push(marker);
    marker.on("click", () => showDetails(place));

    const listItem = document.createElement("div");
    listItem.className = "list-item";
    listItem.textContent = place.name;
    listItem.onclick = () => showDetails(place);
    listContainer.appendChild(listItem);
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
  const pw = document.getElementById("password").value;

  if (pw === "ghielens1927") {
    adminMode = true;
    updateUI();
  }
}

function logout() {
  adminMode = false;
  updateUI();
}

  window.addEventListener("load", () => {
  const excelFileInput = document.getElementById("excelFile");

  if (excelFileInput) {
    excelFileInput.addEventListener("change", function (e) {
      if (!adminMode) return;

      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = function (evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);

        json.forEach(row => {
          places.push({
            name: row.name,
            lat: parseCoord(row.lat),
            lng: parseCoord(row.lng),
            description: row.description || "",
            keywords: row.keywords ? row.keywords.split(",") : [],
            image: row.image || ""
          });
        });

        fuse.setCollection(places);
        renderPlaces(places);
      };

      reader.readAsArrayBuffer(file);
    });
  }
});
 
// ===== INIT =====
loadPlaces();
updateUI();

setTimeout(() => {
  map.invalidateSize();
}, 100);