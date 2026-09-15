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
    keys: ["name", "keyword", "latString", "ingString"],
    threshold: 0.4,
    minMatchCharLength: 2
  });
}

function normalizePlaceCoordinates(place) {
  place.lat = parseCoord(place.lat);
  place.ing = parseCoord(place.ing);
  place.latString = place.lat != null ? String(place.lat) : "";
  place.ingString = place.ing != null ? String(place.ing) : "";
  return place;
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
  const lat = parseCoord(
    data?.lat ?? data?.Lat ?? data?.latitude ?? data?.Latitude ?? data?.y ?? data?.Y
  );
  const ing = parseCoord(
    data?.ing ?? data?.Ing ?? data?.lng ?? data?.Lng ?? data?.lon ?? data?.Lon ??
      data?.longitude ?? data?.Longitude ?? data?.long ?? data?.Long ?? data?.x ?? data?.X
  );

  return { lat, ing };
}

function parseLatLngFromString(value) {

  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  const match =
    text.match(/(-?\d+(?:[.,]\d+)?)\s*[,;/]\s*(-?\d+(?:[.,]\d+)?)/)
    ||
    text.match(/(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)/);

  if (!match) return null;

  const lat = parseFloat(match[1].replace(",", "."));
  const ing = parseFloat(match[2].replace(",", "."));

  // Reject values that cannot realistically be Belgian coordinates.
  // This prevents house numbers such as "4, 78" from being treated
  // as latitude/longitude.
  if (lat < 49 || lat > 52 || ing < 2 || ing > 7) {
    return null;
  }

  return {
    lat,
    ing
  };
}

function extractLatLngFromRow(row) {
  const lat = row?.lat ?? row?.Lat ?? row?.latitude ?? row?.Latitude ?? row?.y ?? row?.Y;
  const ing = row?.ing ?? row?.Ing ?? row?.lng ?? row?.Lng ?? row?.lon ?? row?.Lon ??
    row?.longitude ?? row?.Longitude ?? row?.long ?? row?.Long ?? row?.x ?? row?.X;

  if (lat != null && ing != null) {
    return { lat, ing };
  }

  const combined = row?.coordinates ?? row?.Coordinates ?? row?.coordinate ?? row?.Coordinate ??
    row?.latlng ?? row?.LatLng ?? row?.["Lat/Lng"] ?? row?.location ?? row?.Location ??
    row?.geo ?? row?.Geo ?? row?.coords ?? row?.Coords;

  const parsed = parseLatLngFromString(combined);
  if (parsed) {
    return parsed;
  }

  for (const key in row) {
    if (typeof row[key] === "string") {
      const parsedField = parseLatLngFromString(row[key]);
      if (parsedField) {
        return parsedField;
      }
    }
  }

  return { lat: null, ing: null };
}

function loadPlaces() {
  console.log("Loading places...");
  console.log("🔥 loadPlaces() CALLED");
  // FIX: Collection changed from "locations" to "places" to match your add/edit methods
  db.collection("places").onSnapshot((snapshot) => {
    console.log("Snapshot size:", snapshot ? snapshot.size : 0);

      if (!snapshot || snapshot.size === 0) {
        console.warn("No documents found in Firebase path! Check your collection name.");
        initFuse();
        renderPlaces(places);
        return;
      }

      // Clear old markers only when we have new snapshot data
      markers.forEach(marker => map.removeLayer(marker));
      markers = [];

      // Build firebasePlaces from snapshot
      const firebasePlaces = snapshot.docs.map(doc => {
      const data = doc.data();
      
      // Pull coordinates using your custom structural fallback function
      const { lat, ing } = getCoordinates(data);

      console.log("Firebase doc coordinates:", {
        id: doc.id,
        raw: data,
        lat,
        ing
      });

      const place = normalizePlaceCoordinates({
        id: doc.id,
        name: data.name || "Untitled",
        lat,
        ing,
        description: data.description || "",
        image: data.image || "",
        keyword: data.keyword || data.keywords || []
      });

      // Render Leaflet marker safely if coordinate data evaluates successfully
      if (place.lat !== null && place.ing !== null) {
          // Leaflet expects [latitude, longitude]
         const marker = L.marker([place.lat, place.ing])
  .addTo(map);

place.marker = marker;

marker.on("click", () => {
  showDetails(place);
});

markers.push(marker);
      } else {
          console.warn(`Place ID ${doc.id} skipped: Invalid coordinates`, data);
      }

      return place;
    });

    // Merge firebasePlaces into existing `places` (which may contain Excel imports)
    firebasePlaces.forEach(fp => {
      if (fp.id) {
        const existingIndex = places.findIndex(p => p.id === fp.id);
        if (existingIndex !== -1) {
          // Replace existing Firebase entry with latest
          places[existingIndex] = fp;
          return;
        }
      }

      // No matching id found — append as new
      places.push(fp);
    });

    console.log("Merged Firebase places. Total places:", places.length);

    if (!fuse) initFuse(); else fuse.setCollection(places);
    renderPlaces(places);
  }, (err) => {
    console.error("Firebase subscription error:", err);
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
function getImageForPlace(place) {
  if (!place) return "";

  const imageValue = place.image || place.img || "";

  if (!imageValue) {
    if (!place.name) return "";
    const cleanName = String(place.name).trim();
    return `images/${encodeURI(cleanName)}.jpg`;
  }

  if (/^(https?:)?\/\//i.test(imageValue) || imageValue.startsWith("data:")) {
    return imageValue;
  }

  if (imageValue.startsWith("images/") || imageValue.startsWith("./") || imageValue.startsWith("/")) {
    return imageValue;
  }

  return `images/${encodeURI(imageValue)}`;
}

console.log("getImageForPlace() function defined. Example image path:", getImageForPlace({ name: "ExamplePlace" }));
// ===== PLACE DISPLAY =====
function showDetails(place) {
  if (activePlace === place) {
    activePlace = null;

    if (place.marker) {
      place.marker.closePopup();
    }

    return;
  }

  activePlace = place;
  const imageUrl = getImageForPlace(place);

  if (place.marker) {
    // Keep the marker centered when opening details
    if (place.lat != null && place.ing != null) {
      map.setView([place.lat, place.ing], 17);
    }

    const popupContent = `
      <div class="location-popup">
        <h3>${place.name}</h3>

        ${imageUrl ? `
  <img src="${imageUrl}" class="popup-image" onerror="this.style.display='none'">
` : ""}

        <p>${place.description || ""}</p>

        ${adminMode ? `
          <button class="popup-edit-btn">Edit</button>
          <button class="popup-delete-btn">Delete</button>
        ` : ""}
      </div>
    `;

    place.marker
      .bindPopup(popupContent)
      .openPopup();

    place.marker.once("popupopen", () => {
      const popup = place.marker.getPopup().getElement();

      if (!popup) return;

      const editBtn = popup.querySelector(".popup-edit-btn");
      const deleteBtn = popup.querySelector(".popup-delete-btn");

      if (editBtn) {
        editBtn.addEventListener("click", () => {
          editLocation(place);
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
          deleteLocation(place);
        });
      }
    });
  }

  detailsContainer.innerHTML = `
    <h3>${place.name}</h3>

    ${imageUrl ? `
<img src="${imageUrl}" width="100%" onerror="this.style.display='none'">
    ` : ""}

    <p>${place.description || ""}</p>

    ${adminMode ? '<button id="editBtn">Edit</button>' : ''}
    ${adminMode ? '<button id="deleteBtn">Delete</button>' : ''}
  `;

  if (adminMode) {
    document.getElementById("editBtn")?.addEventListener("click", () => {
      editLocation(place);
    });

    document.getElementById("deleteBtn")?.addEventListener("click", () => {
      deleteLocation(place);
    });
  }
}
// ===== ADD LOCATION =====
function startAddLocation() {
  if (!adminMode) return;
  document.getElementById("addModal").style.display = "block";
}
function startMapPick() {
  if (!adminMode) return;

  isAdding = true;
  alert("Click a location on the map.");
}
function confirmAdd() {
  const name = document.getElementById("m_name").value;
  const lat = parseCoord(document.getElementById("m_lat").value);
  const ing = parseCoord(document.getElementById("m_ing").value);
  const desc = document.getElementById("m_desc").value;
  const img = document.getElementById("m_img").value;
  const keywordInput = document.getElementById("m_keywords").value;

  const newPlace = normalizePlaceCoordinates({
    name,
    lat,
    ing,
    description: desc,
    image: img,
    keyword: keywordInput
      .split(",")
      .map(k => k.trim())
      .filter(k => k !== "")
  });

 db.collection("places").add(newPlace).then(docRef => {

  newPlace.id = docRef.id;

  places.push(newPlace);

  if (!fuse) initFuse();
  else fuse.setCollection(places);

  renderPlaces(places);

});

// clear add modal fields for next use
document.getElementById("m_name").value = "";
document.getElementById("m_lat").value = "";
document.getElementById("m_ing").value = "";
document.getElementById("m_desc").value = "";
document.getElementById("m_img").value = "";
document.getElementById("m_keywords").value = "";

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
  editingPlace.latString = editingPlace.lat != null ? String(editingPlace.lat) : "";
  editingPlace.ingString = editingPlace.ing != null ? String(editingPlace.ing) : "";
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
  console.log("🟢 renderPlaces called with:", Array.isArray(list) ? list.length : typeof list, "places");
  console.log("📋 places currently contains:", places.length);
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

    if (!Number.isFinite(lat) || !Number.isFinite(ing)) {
      console.warn("Skipping invalid marker coordinates:", place.name, {
        lat: place.lat,
        ing: place.ing,
        parsedLat: lat,
        parsedIng: ing
      });
      return;
    }

    const marker = L.marker([lat, ing]).addTo(map);
    place.marker = marker;
    marker.on("click", () => showDetails(place));

    markers.push(marker);
  });
}

// ===== SEARCH =====
function searchPlaces(query) {
  const text = query.trim();
  if (!text) {
    return renderPlaces(places);
  }

  const coordinateMatch = text.match(/^(-?\d+(?:[.,]\d+)?)\s*[ ,]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (coordinateMatch) {
    const lat = parseCoord(coordinateMatch[1]);
    const ing = parseCoord(coordinateMatch[2]);

    if (lat != null && ing != null) {
      const exactMatches = places.filter(place => {
        const plat = parseCoord(place.lat);
        const ping = parseCoord(place.ing);
        return plat != null && ping != null && Math.abs(plat - lat) < 0.000001 && Math.abs(ping - ing) < 0.000001;
      });

      if (exactMatches.length) {
        return renderPlaces(exactMatches);
      }

      let closest = null;
      let minDistance = Infinity;
      places.forEach(place => {
        const plat = parseCoord(place.lat);
        const ping = parseCoord(place.ing);
        if (plat == null || ping == null) return;
        const distance = (plat - lat) ** 2 + (ping - ing) ** 2;
        if (distance < minDistance) {
          minDistance = distance;
          closest = place;
        }
      });

      if (closest) {
        return renderPlaces([closest]);
      }
    }
  }

  if (!fuse) {
    initFuse();
  }

  const result = fuse.search(text);
  renderPlaces(result.map(r => r.item));
}

searchInput.addEventListener("input", () => {
  searchPlaces(searchInput.value);
});
// ===== LOGIN SYSTEM =====
function login() {
  const pw = document.getElementById("password").value;
  console.log("login() called, password entered:", pw);

  if (pw === "ghielens1927") {
    console.log("login successful");
    adminMode = true;
    updateUI();
  } else {
    console.log("login failed: incorrect password");
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

      reader.onload = async function (evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);

        // Import every Excel row
        for (const row of json) {
          let coordinates = extractLatLngFromRow(row);

          // If Excel has no coordinates, geocode the address
          if (coordinates.lat == null || coordinates.ing == null) {
            const address = row.name || row.Name;

            if (address) {
              console.log("🌍 Geocoding:", address);

              const geocoded = await geocodeAddress(address);

              if (geocoded) {
                coordinates = geocoded;
              }
            }
          }

          const place = normalizePlaceCoordinates({
            name: row.name || row.Name || "Untitled",
            lat: coordinates.lat,
            ing: coordinates.ing,
            description: row.description || row.Description || "",
            keyword: row.keyword
              ? row.keyword.split(",")
              : (row.keywords ? row.keywords.split(",") : []),
            image: row.image || row.Image || ""
          });

          console.log("Excel import place:", {
            raw: row,
            coordinates,
            parsedLat: place.lat,
            parsedIng: place.ing,
            name: place.name
          });

          places.push(place);

          // Small pause between Nominatim requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Update search
        if (!fuse) {
          initFuse();
        } else {
          fuse.setCollection(places);
        }

        // Display locations
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

// ===== EXCEL GEOCODING IMPORT (moved from app.js into javascript.js)
// Uses the existing `excelFile` input and the same Leaflet `map` instance.
let excelMarkers = [];
let excelBounds = L.latLngBounds();

function clearExcelMarkers() {
  excelMarkers.forEach(m => map.removeLayer(m));
  excelMarkers = [];
  excelBounds = L.latLngBounds();
}

async function geocodeAddress(address) {
  const searchAddress = address;
  const encodedAddress = encodeURIComponent(searchAddress);

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodedAddress}&countrycodes=be&limit=1`;
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geocoding request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.length === 0) {
      console.warn("No coordinates found for:", address);
      return null;
    }
console.log("🗺️ Nominatim RAW:", data[0].lat, data[0].lon);
console.log("🗺️ Nominatim PARSED:", parseFloat(data[0].lat), parseFloat(data[0].lon));

    return {
      lat: parseFloat(data[0].lat),
      ing: parseFloat(data[0].lon)
    };

  } catch (error) {
    console.error("Geocoding failed for:", address, error);
    return null;
  }
}
// After getting Nominatim results, validate the city matches
function validateGeocodeResult(results, expectedCity) {
  // Try to find a result where display_name contains the expected city
  const match = results.find(r => 
    r.display_name.toLowerCase().includes(expectedCity.toLowerCase())
  );
  
  if (match) return match;
  
  // If no match, try with postal code or bounded search
  // (fallback strategy)
  return null;
}