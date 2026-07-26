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
console.log(firebase.app().options.projectId);
function initFuse() {
  fuse = new Fuse(places, {
    keys: ["name", "keyword"],
    threshold: 0.4,
    minMatchCharLength: 2
  });
}

function parseCoord(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value)
    .trim()
    .replace(",", ".")
    .replace(/[^0-9.-]/g, ""); // removes weird Excel junk

  const num = Number(cleaned);

  return Number.isFinite(num) ? num : null;
}

function getCoordinates(data) {
  const lat = parseCoord(data?.lat ?? data?.latitude ?? data?.y);
  const ing = parseCoord(data?.ing ?? data?.Ing ?? data?.lng ?? data?.lon ?? data?.longitude ?? data?.long ?? data?.x);

  return { lat, ing };
}

function loadPlaces() {
  console.log("Loading places...");

  db.collection("places").get().then(snapshot => {
    console.log("Snapshot size:", snapshot.size);

    places = snapshot.docs.map(doc => {
      const data = doc.data();
      const { lat, ing } = getCoordinates(data);

      return {
        id: doc.id,
        name: data.name || "Untitled",
        lat,
        ing,
        description: data.description || "",
        image: data.image || "",
        keyword: data.keyword || data.keywords || []
      };
    });

    initFuse();
    renderPlaces(places);
  }).catch(err => {
    console.error("Firebase error:", err);
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
  document.getElementById("m_ing").value = e.latlng.lng;

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

  // Only center map if coordinates exist
  if (place.lat != null && place.ing != null) {
    map.setView([place.lat, place.ing], 17);
  }

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
  const ing = parseCoord(document.getElementById("m_ing").value);
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
  const ing = Number(document.getElementById("m_ing").value);
  const desc = document.getElementById("m_desc").value;
  const img = document.getElementById("m_img").value;
  const keywordInput = document.getElementById("m_keywords").value;

  const newPlace = {
    name,
    lat,
    ing,
    description: desc,
    image: img,
    keyword: keywordInput
      .split(",")
      .map(k => k.trim())
      .filter(k => k !== "")
  };

 db.collection("places").add(newPlace).then(docRef => {
  newPlace.id = docRef.id;

  places.push(newPlace);
  fuse.setCollection(places);
  renderPlaces(places);
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
  document.getElementById("e_lat").value = place.lat ?? "";
  document.getElementById("e_ing").value = place.ing ?? "";
  document.getElementById("e_desc").value = place.description;
  document.getElementById("e_img").value = place.image;
  document.getElementById("e_keywords").value = (place.keyword || []).join(",");
  document.getElementById("editModal").style.display = "block";

  editingPlace.lat = parseCoord(document.getElementById("e_lat").value);
  editingPlace.ing = parseCoord(document.getElementById("e_ing").value);
}
function confirmEdit() {
  if (!editingPlace) return;

  editingPlace.name = document.getElementById("e_name").value;
  editingPlace.lat = parseCoord(document.getElementById("e_lat").value);
  editingPlace.ing = parseCoord(document.getElementById("e_ing").value);
  editingPlace.description = document.getElementById("e_desc").value;
  editingPlace.image = document.getElementById("e_img").value;

  editingPlace.keyword = document
    .getElementById("e_keywords")
    .value
    .split(",")
    .map(k => k.trim())
    .filter(k => k !== "");

  db.collection("places").doc(editingPlace.id).update({
    name: editingPlace.name,
    lat: editingPlace.lat,
    ing: editingPlace.ing,
    description: editingPlace.description,
    image: editingPlace.image,
    keyword: editingPlace.keyword
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

    // Add to list first
    const item = document.createElement("div");
    item.textContent = place.name;
    item.onclick = () => showDetails(place);
    listContainer.appendChild(item);

    // Only skip marker creation if coordinates are missing
    const lat = parseCoord(place.lat);
    const ing = parseCoord(place.ing);

    if (Number.isNaN(lat) || Number.isNaN(ing)) {
  console.warn("No coordinates yet:", place.name);
  return;
}

    const marker = L.marker([lat, ing]).addTo(map);
    marker.on("click", () => showDetails(place));

    markers.push(marker);
  });
}

// ===== SEARCH =====
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  if (!query) return renderPlaces(places);
  if (!fuse) {
    initFuse();
  }

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
            ing: parseCoord(row.ing ?? row.Ing),
            description: row.description || "",
            keyword: row.keyword ? row.keyword.split(",") : (row.keywords ? row.keywords.split(",") : []),
            image: row.image || ""
          });
        });

        if (!fuse) {
  initFuse();
} else {
  fuse.setCollection(places);
}
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