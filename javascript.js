import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function removeDuplicatePlaces() {
  console.log("🧹 STARTING DUPLICATE CLEANUP...");

  const snapshot = await getDocs(collection(db, "places"));

  const seen = new Map();
  const duplicates = [];

  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();

    if (!data.name) return;

    // Normalize the address so formatting differences don't create separate entries
    const normalizedAddress = String(data.name)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*-\s*/g, "-");

    console.log(
      "Checking:",
      data.name,
      "→",
      normalizedAddress
    );

    if (seen.has(normalizedAddress)) {
      duplicates.push(documentSnapshot.id);

      console.log(
        "🗑️ DUPLICATE FOUND:",
        data.name,
        "ID:",
        documentSnapshot.id
      );
    } else {
      seen.set(normalizedAddress, documentSnapshot.id);
    }
  });

  console.log("📋 Firebase documents:", snapshot.size);
  console.log("🗑️ Duplicates found:", duplicates.length);

  // Delete duplicates
  for (const duplicateId of duplicates) {
    try {
      await deleteDoc(doc(db, "places", duplicateId));
      console.log("✅ Deleted duplicate:", duplicateId);
    } catch (error) {
      console.error(
        "❌ Could not delete duplicate:",
        duplicateId,
        error
      );
    }
  }

  console.log("🎉 DUPLICATE CLEANUP FINISHED");
}
// ===== STATE =====
let adminMode = false;   // true = admin features enabled
let activePlace = null;  // currently selected place
let markers = [];        // leaflet markers on map
let isAdding = false;    // future: add-mode state
let editingPlace = null; // currently edited place
let places = [];
let fuse; // declare first
let isImporting = false; // prevent snsapshot updates during import

const photoFolderUrl = "file:///C:/Users/junoz/OneDrive%20-%20Ghielens/data/100%20jaar/aaa";

// ===== DATA =====
const firebaseConfig = {
  apiKey: "AIzaSyDX-AIGkfhSEfBRDt-SRrJyVWRlmtxs7qE",
  authDomain: "project-ghielens.firebaseapp.com",
  projectId: "project-ghielens",
  storageBucket: "project-ghielens.firebasestorage.app",
  messagingSenderId: "720120279485",
  appId: "1:720120279485:web:96b0791f6206dad21ea2d4"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "default");
const auth = getAuth(app);
const SUPABASE_URL = "https://ekhxcltruzmufagywohk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE";
const SUPABASE_BUCKET = "place-photos";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  accessToken: async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in with the Firebase admin account before uploading pictures.");
    return user.getIdToken();
  }
});
console.log(app.options.projectId, "Firestore database: default");
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
  onSnapshot(collection(db, "places"), (snapshot) => {
    console.log("Snapshot size:", snapshot ? snapshot.size : 0);

      if (isImporting) {
        console.log("⏸️ Skipping render during Excel import");
        return;
      }

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
        image: Array.isArray(data.image) ? data.image : normalizeImageList(data.image || data.images || data.img || ""),
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

    // Replace places completely with Firebase data (no duplicates)
    places = firebasePlaces
      .sort((a, b) =>
        String(a.name || "").localeCompare(
          String(b.name || ""),
          "nl",
          { sensitivity: "base" }
        )
      );

    console.log("✅ Loaded from Firebase. Total places:", places.length, places.map(p => p.name));

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
function normalizeImageList(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(item => item !== "");
  }

  if (typeof value !== "string") {
    return [String(value).trim()].filter(item => item !== "");
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => String(item).trim())
          .filter(item => item !== "");
      }
    } catch (err) {
      // ignore malformed JSON and fall through to string parsing below
    }
  }

  return trimmed
    .split(/\s*[\n;|]+\s*/)
    .map(item => item.trim())
    .filter(item => item !== "");
}

function getImagesForPlace(place) {
  if (!place) return [];

  const rawImages = place.images || place.image || place.img || [];
  const images = normalizeImageList(rawImages);

  return images.map(image => {
    // Already a complete URL
    if (/^(https?:)?\/\//i.test(image)) {
      return image;
    }

    // Local paths
    if (
      image.startsWith("images/") ||
      image.startsWith("./") ||
      image.startsWith("/")
    ) {
      return image;
    }

    // Filename stored in Firebase
    return `${photoFolderUrl}/${encodeURIComponent(image)}`;
  });
}

console.log("getImagesForPlace() function defined.");

function buildGalleryHtml(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return "";

  const slides = imageUrls.map((url, index) => `
    <div class="gallery-slide ${index === 0 ? "active" : ""}" data-index="${index}">
      <img src="${url}" alt="${index + 1}" onerror="this.style.display='none'">
    </div>
  `).join("");

  const dots = imageUrls.map((_, index) => `
    <button type="button" class="gallery-dot ${index === 0 ? "active" : ""}" data-index="${index}" aria-label="Go to image ${index + 1}"></button>
  `).join("");

  const arrows = imageUrls.length > 1 ? `
    <button type="button" class="gallery-arrow gallery-prev" aria-label="Previous image">‹</button>
    <button type="button" class="gallery-arrow gallery-next" aria-label="Next image">›</button>
  ` : "";

  return `
    <div class="image-gallery" data-current="0" data-total="${imageUrls.length}">
      <div class="gallery-track">
        ${slides}
      </div>
      ${arrows}
      <div class="gallery-dots">${dots}</div>
    </div>
  `;
}

function setGalleryIndex(gallery, index) {
  if (!gallery) return;

  const slides = gallery.querySelectorAll(".gallery-slide");
  const dots = gallery.querySelectorAll(".gallery-dot");
  const total = slides.length || 1;
  const safeIndex = ((index % total) + total) % total;

  slides.forEach((slide, i) => {
    slide.classList.toggle("active", i === safeIndex);
  });

  dots.forEach((dot, i) => {
    dot.classList.toggle("active", i === safeIndex);
  });

  gallery.dataset.current = String(safeIndex);
}

function attachGalleryControls(popupElement) {
  if (!popupElement) return;

  const gallery = popupElement.querySelector(".image-gallery");
  if (!gallery) return;

  const total = Number(gallery.dataset.total || 0);
  if (total <= 1) return;

  const prevBtn = popupElement.querySelector(".gallery-prev");
  const nextBtn = popupElement.querySelector(".gallery-next");

  prevBtn?.addEventListener("click", () => {
    const current = Number(gallery.dataset.current || 0);
    setGalleryIndex(gallery, current - 1);
  });

  nextBtn?.addEventListener("click", () => {
    const current = Number(gallery.dataset.current || 0);
    setGalleryIndex(gallery, current + 1);
  });

  popupElement.querySelectorAll(".gallery-dot").forEach(dot => {
    dot.addEventListener("click", () => {
      setGalleryIndex(gallery, Number(dot.dataset.index || 0));
    });
  });
}
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
  const imageUrls = getImagesForPlace(place);

  if (place.marker) {
    // Keep the marker centered when opening details
    if (place.lat != null && place.ing != null) {
      map.setView([place.lat, place.ing], 17);
    }

    const imagesHtml = imageUrls.length
      ? imageUrls.map(url => `<img src="${url}" class="popup-image" onerror="this.style.display='none'">`).join("")
      : "";

    const popupContent = `
      <div class="location-popup">
        <h3>${place.name}</h3>

        ${buildGalleryHtml(imageUrls)}

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

      attachGalleryControls(popup);

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

  // Details should only appear in the map popup; the sidebar detail panel stays empty.
  detailsContainer.innerHTML = "";
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
    image: normalizeImageList(img),
    keyword: keywordInput
      .split(",")
      .map(k => k.trim())
      .filter(k => k !== "")
  });

 addDoc(collection(db, "places"), newPlace).then(docRef => {

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
  editingPlace.image = normalizeImageList(document.getElementById("e_img").value);

  editingPlace.keyword = document
    .getElementById("e_keywords")
    .value
    .split(",")
    .map(k => k.trim())
    .filter(k => k !== "");

  updateDoc(doc(db, "places", editingPlace.id), {
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
  deleteDoc(doc(db, "places", place.id)).then(() => {
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
  if (excelFile) excelFile.disabled = !adminMode;

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
  console.log(
    "renderPlaces called with:",
    Array.isArray(list) ? list.length : typeof list,
    "places"
  );

  console.log("📋 places currently contains:", places.length);

  // Always sort the visible list alphabetically
  list = [...list].sort((a, b) =>
    String(a.name || "").localeCompare(
      String(b.name || ""),
      "nl",
      {
        sensitivity: "base",
        numeric: true
      }
    )
  );

  console.log("🔤 SORTED LIST:", list.map(place => place.name));

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

async function login() {
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(
      auth,
      "juno.denis2008@gmail.com",
      password
    );

    adminMode = true;
    updateUI();

  } catch (error) {

    console.error("Firebase login error:", error);
    alert("Onjuist wachtwoord.");

  }

}
async function logout() {
  await signOut(auth);
  adminMode = false;
  updateUI();
}

function xmlElementsByName(xml, name) {
  return Array.from(xml.getElementsByTagName("*")).filter(element => element.localName === name);
}

function xmlAttributeByName(element, name) {
  return Array.from(element.attributes).find(attribute => attribute.localName === name)?.value;
}

function resolveZipPath(baseFilePath, target) {
  if (target.startsWith("/")) return target.slice(1);

  const parts = baseFilePath.split("/");
  parts.pop();
  target.split("/").forEach(part => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });

  return parts.join("/");
}

function readRelationships(xml) {
  return new Map(xmlElementsByName(xml, "Relationship").map(relationship => [
    relationship.getAttribute("Id"),
    relationship.getAttribute("Target")
  ]));
}

async function extractWorkbookImages(workbookBytes, firstSheetName) {
  const zip = await JSZip.loadAsync(workbookBytes);
  const parser = new DOMParser();
  const parseXml = (text, path) => {
    const xml = parser.parseFromString(text, "application/xml");
    const parserError = xml.getElementsByTagName("parsererror")[0];
    if (parserError) throw new Error(`Invalid XML in ${path}: ${parserError.textContent}`);
    return xml;
  };
  const readXml = async path => {
    const file = zip.file(path);
    if (!file) throw new Error(`Workbook relationship points to missing file: ${path}`);
    return parseXml(await file.async("text"), path);
  };

  const workbookPath = "xl/workbook.xml";
  const workbookXml = await readXml(workbookPath);
  const workbookRelationships = readRelationships(await readXml("xl/_rels/workbook.xml.rels"));
  const sheetElement = xmlElementsByName(workbookXml, "sheet")
    .find(element => element.getAttribute("name") === firstSheetName);
  const sheetTarget = sheetElement && workbookRelationships.get(xmlAttributeByName(sheetElement, "id"));
  if (!sheetTarget) throw new Error(`Could not resolve worksheet "${firstSheetName}" in the workbook.`);

  const sheetPath = resolveZipPath(workbookPath, sheetTarget);
  const sheetXml = await readXml(sheetPath);
  const drawingElement = xmlElementsByName(sheetXml, "drawing")[0];
  if (!drawingElement) {
    console.warn(`No embedded-picture drawing found on worksheet "${firstSheetName}".`);
    return new Map();
  }

  const sheetRelationshipsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const sheetRelationships = readRelationships(await readXml(sheetRelationshipsPath));
  const drawingTarget = sheetRelationships.get(xmlAttributeByName(drawingElement, "id"));
  if (!drawingTarget) throw new Error(`Could not resolve the picture drawing for worksheet "${firstSheetName}".`);

  const drawingPath = resolveZipPath(sheetPath, drawingTarget);
  const drawingXml = await readXml(drawingPath);
  const drawingRelationshipsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const drawingRelationships = readRelationships(await readXml(drawingRelationshipsPath));
  const imagesByRow = new Map();
  const mimeByExtension = {
    bmp: "image/bmp", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg",
    png: "image/png", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp"
  };
  const anchors = xmlElementsByName(drawingXml, "twoCellAnchor")
    .concat(xmlElementsByName(drawingXml, "oneCellAnchor"));

  for (const anchor of anchors) {
    const picture = xmlElementsByName(anchor, "pic")[0];
    if (!picture) continue;
    const from = xmlElementsByName(anchor, "from")[0];
    const rowElement = from && xmlElementsByName(from, "row")[0];
    const blip = xmlElementsByName(picture, "blip")[0];
    if (!rowElement || !blip) {
      throw new Error("Found an embedded picture without a usable worksheet row anchor.");
    }

    const imageTarget = drawingRelationships.get(xmlAttributeByName(blip, "embed"));
    if (!imageTarget) throw new Error("Found an embedded picture without a media-file relationship.");

    const imagePath = resolveZipPath(drawingPath, imageTarget);
    const imageFile = zip.file(imagePath);
    if (!imageFile) throw new Error(`Embedded image file not found: ${imagePath}`);

    const extension = imagePath.split(".").pop().toLowerCase();
    const imageBytes = await imageFile.async("uint8array");
    if (!imageBytes.length) throw new Error(`Embedded image file is empty: ${imagePath}`);
    const image = {
      blob: new Blob([imageBytes], { type: mimeByExtension[extension] || "application/octet-stream" }),
      name: imagePath.split("/").pop()
    };
    const rowNumber = Number(rowElement.textContent);
    if (!imagesByRow.has(rowNumber)) imagesByRow.set(rowNumber, []);
    imagesByRow.get(rowNumber).push(image);
  }

  const imageCount = Array.from(imagesByRow.values())
    .reduce((total, images) => total + images.length, 0);
  console.info(`Workbook image extraction found ${imageCount} image(s) across ${imagesByRow.size} row(s).`);

  return imagesByRow;
}

async function uploadImageToSupabase(image) {
  if (SUPABASE_PUBLISHABLE_KEY === "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE") {
    throw new Error("Set SUPABASE_PUBLISHABLE_KEY in javascript.js to the Supabase publishable key.");
  }

  const filePath = `places/${crypto.randomUUID()}-${image.name}`;
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, image.blob, {
      contentType: image.blob.type || "application/octet-stream"
    });

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(data.path);

  return publicUrl;
}

function normalizeAddressKey(address) {
  return String(address || "").trim().toLowerCase().replace(/\s+/g, " ");
}

window.addEventListener("load", () => {
  const excelFileInput = document.getElementById("excelFile");
  if (!excelFileInput) return;

  excelFileInput.addEventListener("change", event => {
    if (!adminMode) return;

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async loadEvent => {
      isImporting = true;
      let successCount = 0;
      let errorCount = 0;
      let imageErrorCount = 0;
      let firestoreSaveErrorCount = 0;
      let matchedImageCount = 0;
      let extractedImageCount = null;

      try {
        const workbookBytes = new Uint8Array(loadEvent.target.result);
        const workbook = XLSX.read(workbookBytes, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const sheetRowOffset = sheet["!ref"]
          ? XLSX.utils.decode_range(sheet["!ref"]).s.r
          : 0;
        const headerNames = (rows[0] || []).map(value => String(value).trim().toLowerCase());
        const hasHeader = ["name", "address", "adres", "naam"].includes(headerNames[0]);
        const firstDataRow = hasHeader ? 1 : 0;
        let imagesByRow;
        try {
          imagesByRow = await extractWorkbookImages(workbookBytes, firstSheetName);
        } catch (extractionError) {
          throw new Error(`Excel picture extraction failed: ${extractionError.message}`);
        }
        extractedImageCount = Array.from(imagesByRow.values())
          .reduce((total, rowImages) => total + rowImages.length, 0);
        if (!extractedImageCount) {
          console.warn("No embedded pictures were extracted. Check that the workbook contains pictures anchored to the first worksheet.");
        }
        const existingSnapshot = await getDocs(collection(db, "places"));
        const existingPlaces = new Map();

        existingSnapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.name) {
            existingPlaces.set(normalizeAddressKey(data.name), {
              id: docSnap.id,
              image: normalizeImageList(data.image || data.images || data.img || "")
            });
          }
        });

        for (let rowNumber = firstDataRow; rowNumber < rows.length; rowNumber++) {
          const cells = rows[rowNumber] || [];
          const address = String(cells[0] || "").trim();
          if (!address) continue;

          const row = {};
          if (hasHeader) {
            headerNames.forEach((header, columnIndex) => {
              if (header) row[header] = cells[columnIndex];
            });
          }
          row.name = address;

          try {
            let coordinates = extractLatLngFromRow(row);
            if (coordinates.lat == null || coordinates.ing == null) {
              const geocoded = await geocodeAddress(address);
              if (geocoded) coordinates = geocoded;
            }

            const imageUrls = [];
            const worksheetRow = rowNumber + sheetRowOffset;
            const rowImages = imagesByRow.get(worksheetRow) || [];
            matchedImageCount += rowImages.length;
            if (rowImages.length) {
              console.info(`Mapped ${rowImages.length} workbook image(s) from worksheet row ${worksheetRow + 1} to ${address}.`);
            }
            for (const picture of rowImages) {
              try {
                imageUrls.push(await uploadImageToSupabase(picture));
              } catch (uploadError) {
                imageErrorCount++;
                console.error(`Supabase upload failed for ${address} (${picture.name}):`, uploadError);
              }
            }

            const descriptionKey = headerNames.find(header => ["description", "beschrijving", "omschrijving"].includes(header));
            const place = {
              name: address,
              keyword: [],
              description: descriptionKey ? row[descriptionKey] || "" : "",
              lat: parseCoord(coordinates.lat),
              ing: parseCoord(coordinates.ing)
            };
            const normalizedAddress = normalizeAddressKey(address);
            const existingPlace = existingPlaces.get(normalizedAddress);

            if (existingPlace) {
              place.image = [...new Set([...existingPlace.image, ...imageUrls])];
            } else {
              place.image = imageUrls;
            }

            try {
              if (existingPlace) {
                await updateDoc(doc(db, "places", existingPlace.id), place);
                existingPlace.image = place.image;
              } else {
                const docRef = await addDoc(collection(db, "places"), place);
                existingPlaces.set(normalizedAddress, { id: docRef.id, image: imageUrls });
              }
            } catch (saveError) {
              errorCount++;
              firestoreSaveErrorCount++;
              console.error(`Firestore save failed for ${address}:`, saveError);
              continue;
            }

            successCount++;
          } catch (error) {
            errorCount++;
            console.error(`Import failed for ${address}:`, error);
          }
        }

        await removeDuplicatePlaces();
      } catch (error) {
        errorCount++;
        console.error("Workbook import failed:", error);
        alert(`Workbook import failed: ${error.message}`);
      } finally {
        isImporting = false;
        await loadPlaces();
        excelFileInput.value = "";
        console.log(`Import complete. Extracted pictures: ${typeof extractedImageCount === "number" ? extractedImageCount : "unavailable"}; matched workbook images: ${matchedImageCount}; places saved: ${successCount}; row/save errors: ${errorCount}; Firestore save errors: ${firestoreSaveErrorCount}; upload errors: ${imageErrorCount}.`);
        const importWarnings = [];
        if (typeof extractedImageCount === "number" && extractedImageCount === 0) {
          importWarnings.push("No embedded pictures were extracted from the first worksheet.");
        } else if (typeof extractedImageCount === "number" && matchedImageCount < extractedImageCount) {
          importWarnings.push(`${extractedImageCount - matchedImageCount} extracted picture(s) did not match a non-empty address row.`);
        }
        if (imageErrorCount) {
          importWarnings.push(`${imageErrorCount} picture upload(s) failed; existing images were kept.`);
        }
        if (firestoreSaveErrorCount) {
          importWarnings.push(`${firestoreSaveErrorCount} Firestore save(s) failed. See the browser console for the affected addresses and errors.`);
        }
        if (importWarnings.length) {
          alert(`Imported ${successCount} address row(s). ${importWarnings.join(" ")}`);
        }
      }
    };

    reader.readAsArrayBuffer(file);
  });
});
 
// ===== INIT =====
window.addEventListener("load", () => {
  console.log("Page loaded - initializing app");
  loadPlaces();
  updateUI();

  setTimeout(() => {
    map.invalidateSize();
  }, 100);
});

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
    // Wait 1 second before each request to respect Nominatim's rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geocoding request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.length === 0) {
      console.warn("No coordinates found for:", address);
      return null;
    }

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

window.confirmAdd = confirmAdd;
window.closeAddModal = closeAddModal;
window.confirmEdit = confirmEdit;
window.closeEditModal = closeEditModal;
window.login = login;
window.logout = logout;