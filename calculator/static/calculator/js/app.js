function showToast(message, type = 'default', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast${type !== 'default' ? ' ' + type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

const CATEGORY_CONFIG = {
  RCT: { code: "RCT", name: "Rhino Commercial Tank", short: "RCT", unit: "KL" },
  SST: { code: "SST", name: "SecureStore Micro-Coated Tanks", short: "SST", unit: "KL" },
  SFM: { code: "SFM", name: "Factory Mutual Tanks", short: "SFM", unit: "KL" },
  GFS: { code: "GFS", name: "Glass Fiber Sheets Tank", short: "GFS", unit: "KL" },
  ALL: { code: "ALL", name: "Universal Search", short: "All Categories", unit: "KL" }
};

let selectedCategory = null;
let autocompleteTimeout = null;
let currentSuggestions = [];
let selectedSuggestionIndex = -1;

// ============================================
// Collections & Cart State Management
// ============================================
class TankCollection {
  constructor() {
    this.collections = this.loadCollections();
    this.activeCollectionId = this.loadActiveCollection();
  }

  loadCollections() {
    const stored = localStorage.getItem('tankmate_collections');
    if (stored) return JSON.parse(stored);
    const defaultCollection = {
      id: this.generateId(), name: 'My Selection', tanks: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    return { [defaultCollection.id]: defaultCollection };
  }

  loadActiveCollection() {
    const stored = localStorage.getItem('tankmate_active_collection');
    if (stored && this.collections[stored]) return stored;
    return Object.keys(this.collections)[0];
  }

  saveCollections() { localStorage.setItem('tankmate_collections', JSON.stringify(this.collections)); }
  saveActiveCollection() { localStorage.setItem('tankmate_active_collection', this.activeCollectionId); }
  generateId() { return 'col_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }
  getActiveCollection() { return this.collections[this.activeCollectionId]; }
  getAllCollections() {
    return Object.values(this.collections).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  createCollection(name) {
    const newCollection = {
      id: this.generateId(),
      name: name || `Collection ${Object.keys(this.collections).length + 1}`,
      tanks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.collections[newCollection.id] = newCollection;
    this.activeCollectionId = newCollection.id;
    this.saveCollections(); this.saveActiveCollection();
    return newCollection;
  }

  switchCollection(collectionId) {
    if (this.collections[collectionId]) {
      this.activeCollectionId = collectionId;
      this.saveActiveCollection(); return true;
    }
    return false;
  }

  renameCollection(collectionId, newName) {
    if (this.collections[collectionId]) {
      this.collections[collectionId].name = newName;
      this.collections[collectionId].updatedAt = new Date().toISOString();
      this.saveCollections(); return true;
    }
    return false;
  }

  deleteCollection(collectionId) {
    if (Object.keys(this.collections).length <= 1) {
      showNotification('Cannot delete the last collection', 'error'); return false;
    }
    delete this.collections[collectionId];
    if (this.activeCollectionId === collectionId) {
      this.activeCollectionId = Object.keys(this.collections)[0];
      this.saveActiveCollection();
    }
    this.saveCollections(); return true;
  }

  duplicateCollection(collectionId) {
    const original = this.collections[collectionId];
    if (!original) return null;
    const duplicate = {
      ...original, id: this.generateId(), name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.collections[duplicate.id] = duplicate;
    this.saveCollections(); return duplicate;
  }

  addTankToCollection(tank, collectionId = null) {
    const targetId = collectionId || this.activeCollectionId;
    const collection = this.collections[targetId];
    if (!collection) return false;
    if (collection.tanks.length >= 30) {
      showNotification('Collection limit reached (30 tanks)', 'error'); return false;
    }
    collection.tanks.push({ ...tank, id: Date.now() + "_" + Math.random(), addedAt: new Date().toISOString() });
    collection.updatedAt = new Date().toISOString();
    this.saveCollections(); return true;
  }

  removeTankFromCollection(tankId, collectionId = null) {
    const targetId = collectionId || this.activeCollectionId;
    const collection = this.collections[targetId];
    if (!collection) return false;
    collection.tanks = collection.tanks.filter(t => t.id !== tankId);
    collection.updatedAt = new Date().toISOString();
    this.saveCollections(); return true;
  }

  getCollectionStats(collectionId = null) {
    const collection = collectionId ? this.collections[collectionId] : this.getActiveCollection();
    if (!collection) return null;
    const totalCapacity = collection.tanks.reduce((sum, t) => sum + (t.net_capacity || 0), 0);
    const totalPrice = collection.tanks.reduce((sum, t) => sum + (t.ideal_price || 0), 0);
    return { count: collection.tanks.length, totalCapacity: totalCapacity.toFixed(2), totalPrice: totalPrice.toFixed(0) };
  }

  exportCollection(collectionId = null, format = 'json') {
    const collection = collectionId ? this.collections[collectionId] : this.getActiveCollection();
    if (!collection) return null;
    const stats = this.getCollectionStats(collectionId);
    if (format === 'json') {
      return {
        collection_name: collection.name,
        tanks: collection.tanks.map(tank => ({
          model: tank.model, category: tank.category, category_name: tank.category_name,
          diameter: tank.diameter, height: tank.height,
          net_capacity: tank.net_capacity, gross_capacity: tank.gross_capacity,
          ideal_price: tank.ideal_price, nrp: tank.nrp, price_per_kl: tank.price_per_kl
        })),
        statistics: stats, exported_at: new Date().toISOString(), source: 'tankmate', version: '1.0'
      };
    }
    if (format === 'text') return this.formatCollectionAsText(collection, stats);
    return null;
  }

  formatCollectionAsText(collection, stats) {
    let output = `TANK SELECTION: ${collection.name}\n`;
    output += `Generated: ${new Date().toLocaleString('en-IN')}\n`;
    output += `${'━'.repeat(60)}\n\n`;
    collection.tanks.forEach((tank, index) => {
      output += `[${index + 1}] ${tank.model}\n${'━'.repeat(60)}\n`;
      output += `Category: ${tank.category_name} (${tank.category})\n`;
      output += `Dimensions: Ø${tank.diameter}m × ${tank.height}m\n`;
      output += `Net Capacity: ${tank.net_capacity.toFixed(2)} KL\n`;
      output += `Gross Capacity: ${tank.gross_capacity.toFixed(2)} KL\n`;
      output += `Ideal Price: ₹${tank.ideal_price.toLocaleString('en-IN')}\n`;
      output += `NRP: ₹${tank.nrp.toLocaleString('en-IN')}\n`;
      output += `Price/KL: ₹${tank.price_per_kl.toLocaleString('en-IN')}/KL\n\n`;
    });
    output += `${'━'.repeat(60)}\nSUMMARY\n${'━'.repeat(60)}\n`;
    output += `Total Tanks: ${stats.count}\nCombined Capacity: ${stats.totalCapacity} KL\n`;
    output += `Total Investment: ₹${parseInt(stats.totalPrice).toLocaleString('en-IN')}\n`;
    output += `${'━'.repeat(60)}\n\nGenerated by TankMate\nhttps://tankmate.pythonanywhere.com\n`;
    return output;
  }
}

const collectionsManager = new TankCollection();

// ============================================
// Initialize App
// ============================================
document.addEventListener('DOMContentLoaded', function () {
  console.log('TankMate initialized');
  document.documentElement.style.scrollBehavior = 'smooth';
  setupGlobalListeners();
  updateCartUI();
  NexusSession.init();
  
  // CRITICAL: Setup cart sidebar close handlers
  setupCartSidebarHandlers();

  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('collectionsMenu');
    const toggle = document.querySelector('.collections-toggle');
    if (dropdown && toggle && !dropdown.contains(e.target) && !toggle.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
});

// ============================================
// CRITICAL FIX: Cart Sidebar Handlers
// ============================================
function setupCartSidebarHandlers() {
  const overlay = document.querySelector('.cart-sidebar-overlay');
  const closeBtn = document.querySelector('.cart-close-btn');
  
  // Overlay click to close
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      closeCartSidebar();
    });
    
    // Touch event for mobile
    overlay.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeCartSidebar();
    });
  }
  
  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeCartSidebar();
    });
  }
  
  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('cartSidebar');
      if (sidebar && sidebar.classList.contains('open')) {
        closeCartSidebar();
      }
    }
  });
  
  // Setup swipe-to-close
  setupSwipeToClose();
}

// ============================================
// SWIPE-TO-CLOSE GESTURE (iOS-like)
// ============================================
let touchStartX = 0;
let touchStartY = 0;
let isDragging = false;

function setupSwipeToClose() {
  const header = document.querySelector('.cart-header');
  if (!header) return;
  
  header.addEventListener('touchstart', handleTouchStart, { passive: true });
  header.addEventListener('touchmove', handleTouchMove, { passive: false });
  header.addEventListener('touchend', handleTouchEnd, { passive: true });
}

function handleTouchStart(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  isDragging = false;
}

function handleTouchMove(e) {
  if (!touchStartX) return;
  
  const touchX = e.touches[0].clientX;
  const touchY = e.touches[0].clientY;
  const diffX = touchX - touchStartX;
  const diffY = touchY - touchStartY;
  
  // Detect right swipe (close gesture)
  if (Math.abs(diffX) > Math.abs(diffY) && diffX > 50) {
    isDragging = true;
    e.preventDefault();
    
    // Visual feedback
    const content = document.querySelector('.cart-sidebar-content');
    if (content) {
      content.style.transform = `translateX(${Math.max(0, diffX)}px)`;
      content.style.transition = 'none';
    }
  }
}

function handleTouchEnd(e) {
  const content = document.querySelector('.cart-sidebar-content');
  
  if (isDragging && content) {
    const touchX = e.changedTouches[0].clientX;
    const diffX = touchX - touchStartX;
    
    // If swiped more than 100px, close
    if (diffX > 100) {
      closeCartSidebar();
    } else {
      // Reset position
      content.style.transition = '';
      content.style.transform = '';
    }
  }
  
  touchStartX = 0;
  touchStartY = 0;
  isDragging = false;
}

// ============================================
// Cart Sidebar Toggle (FIXED)
// ============================================
function toggleCartSidebar() {
  const sidebar = document.getElementById('cartSidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  // Prevent body scroll when sidebar open
  document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
}

// Close sidebar when overlay is clicked (already handled by onclick in HTML,
// but this ensures it works with the new class system)
document.addEventListener('DOMContentLoaded', function() {
  const overlay = document.querySelector('.cart-sidebar-overlay');
  if (overlay) {
    overlay.onclick = function() {
      const sidebar = document.getElementById('cartSidebar');
      if (sidebar) {
        sidebar.classList.remove('open');
        document.body.style.overflow = '';
      }
    };
  }

  // Close dropdowns on outside click
  document.addEventListener('click', function(e) {
    const nexusWrapper = document.getElementById('nexusDropdownWrapper');
    const nexusDropdown = document.getElementById('nexusDropdown');
    if (nexusDropdown && nexusWrapper && !nexusWrapper.contains(e.target)) {
      nexusDropdown.style.display = 'none';
    }

    const collectionsMenu = document.getElementById('collectionsMenu');
    const collectionsToggleEl = document.querySelector('.collections-toggle');
    if (collectionsMenu && collectionsToggleEl &&
        !collectionsToggleEl.closest('.collections-dropdown').contains(e.target)) {
      collectionsMenu.style.display = 'none';
    }
  });

  // Cart count badge — hide when 0
  const cartCount = document.getElementById('cartCount');
  if (cartCount) {
    const observer = new MutationObserver(function() {
      cartCount.style.display = cartCount.textContent.trim() === '0' || 
                                 cartCount.textContent.trim() === '' ? 'none' : 'flex';
    });
    observer.observe(cartCount, { childList: true, characterData: true, subtree: true });
    // Initial check
    cartCount.style.display = cartCount.textContent.trim() === '0' ? 'none' : 'flex';
  }

  // Prevent modals from closing when clicking modal content
  document.querySelectorAll('.custom-modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        // Click on backdrop — find close function
        const id = modal.id;
        const closeFnMap = {
          collectionModal:         'closeCollectionModal',
          confirmModal:            'closeConfirmModal',
          nexusExportConfirmModal: 'closeExportConfirmModal',
          importOverwriteModal:    'closeImportOverwriteModal',
          nexusProjectsModal:      'closeNexusProjectsModal',
          nexusDuplicateModal:     'closeNexusDuplicateModal',
        };
        const fn = closeFnMap[id];
        if (fn && typeof window[fn] === 'function') {
          window[fn]();
        }
      }
    });
  });

  // Fix Nexus dropdown position dynamically (always below trigger)
  function positionDropdownBelow(triggerId, dropdownId) {
    const trigger = document.getElementById(triggerId);
    const dropdown = document.getElementById(dropdownId);
    if (!trigger || !dropdown) return;

    const rect = trigger.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 8) + 'px';
  }

  // Patch toggleNexusDropdown to fix position
  const origToggleNexus = window.toggleNexusDropdown;
  window.toggleNexusDropdown = function() {
    if (origToggleNexus) origToggleNexus();
    setTimeout(() => positionDropdownBelow('nexusTrigger', 'nexusDropdown'), 0);
  };

  // Patch toggleCollectionsDropdown to fix position
  const origToggleCollections = window.toggleCollectionsDropdown;
  window.toggleCollectionsDropdown = function() {
    if (origToggleCollections) origToggleCollections();
    setTimeout(() => {
      const toggle = document.querySelector('.collections-toggle');
      const menu = document.getElementById('collectionsMenu');
      if (!toggle || !menu) return;
      const rect = toggle.getBoundingClientRect();
      menu.style.top = (rect.bottom + 8) + 'px';
    }, 0);
  };
});

function openCartSidebar() {
  const sidebar = document.getElementById('cartSidebar');

  updateCartUI();

  sidebar.classList.add('open');

  document.body.classList.add('cart-open');
}

function closeCartSidebar() {
  const sidebar = document.getElementById('cartSidebar');
  const content = document.querySelector('.cart-sidebar-content');

  sidebar.classList.remove('open');
  document.body.classList.remove('cart-open');

  if (content) {
    content.style.transform = '';
    content.style.transition = '';
  }
}

// ============================================
// Setup Global Event Listeners
// ============================================
function setupGlobalListeners() {
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('modelDropdown');
    const input = document.getElementById('modelInput');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) hideAutocompleteDropdown();
  });
}

// ============================================
// Category Selection
// ============================================
function selectCategory(category) {
  selectedCategory = category;
  document.getElementById('tankTypeSelection').style.display = 'none';
  document.getElementById('searchInterface').style.display = 'block';
  document.getElementById('selectedCategoryName').textContent = CATEGORY_CONFIG[category].name;
  const priceFilterSection = document.getElementById('priceFilterSection');
  if (category === 'ALL') {
    priceFilterSection.style.display = 'grid';
  } else {
    priceFilterSection.style.display = 'none';
    document.getElementById('minPriceInput').value = '';
    document.getElementById('maxPriceInput').value = '';
  }
  setupAutocomplete();
  clearResults();
  setTimeout(() => {
    document.getElementById('searchInterface').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function setupAutocomplete() {
  const modelInput = document.getElementById('modelInput');
  modelInput.removeEventListener('input', handleModelInput);
  modelInput.removeEventListener('focus', handleModelFocus);
  modelInput.removeEventListener('keydown', handleModelKeydown);
  modelInput.addEventListener('input', handleModelInput);
  modelInput.addEventListener('focus', handleModelFocus);
  modelInput.addEventListener('keydown', handleModelKeydown);
}

function handleModelInput(event) {
  const query = event.target.value.trim();
  if (autocompleteTimeout) clearTimeout(autocompleteTimeout);
  selectedSuggestionIndex = -1;
  autocompleteTimeout = setTimeout(() => {
    if (query.length >= 2) searchModels(query);
    else if (query.length === 0) loadModels(selectedCategory);
    else { hideAutocompleteDropdown(); updateResultsCount(''); }
  }, 200);
}

function handleModelFocus(event) {
  const query = event.target.value.trim();
  if (!query) loadModels(selectedCategory);
  else if (query.length >= 2 && currentSuggestions.length > 0) showAutocompleteDropdown();
}

function handleModelKeydown(event) {
  const dropdown = document.getElementById('modelDropdown');
  if (!dropdown || !dropdown.classList.contains('show')) return;
  const items = dropdown.querySelectorAll('.autocomplete-item');
  if (items.length === 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
      updateSelectedSuggestion(items); break;
    case 'ArrowUp':
      event.preventDefault();
      selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
      updateSelectedSuggestion(items); break;
    case 'Enter':
      event.preventDefault();
      if (selectedSuggestionIndex >= 0 && items[selectedSuggestionIndex]) items[selectedSuggestionIndex].click();
      break;
    case 'Escape':
      event.preventDefault(); hideAutocompleteDropdown(); break;
  }
}

function updateSelectedSuggestion(items) {
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) { item.classList.add('selected'); item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else item.classList.remove('selected');
  });
}

function searchModels(query) {
  if (!selectedCategory) return;
  let url = `/api/models/?q=${encodeURIComponent(query)}`;
  if (selectedCategory !== 'ALL') url += `&category=${selectedCategory}`;
  fetch(url).then(r => r.json()).then(data => {
    currentSuggestions = data.models || [];
    updateModelSuggestions(data.models, query);
  }).catch(() => showAutocompleteError());
}

function loadModels(category) {
  if (!category) return;
  let url = `/api/models/`;
  if (category !== 'ALL') url += `?category=${category}`;
  fetch(url).then(r => r.json()).then(data => {
    currentSuggestions = data.models || [];
    updateModelSuggestions(data.models);
  }).catch(() => showAutocompleteError());
}

function updateModelSuggestions(models, highlightQuery = '') {
  const dropdown = document.getElementById('modelDropdown');
  dropdown.innerHTML = ''; selectedSuggestionIndex = -1;
  updateResultsCount(models, highlightQuery);
  if (!models || models.length === 0) {
    if (highlightQuery) {
      dropdown.innerHTML = `<div class="autocomplete-empty"><p>No models found for "${highlightQuery}"</p><small>Try a different search term</small></div>`;
      showAutocompleteDropdown();
    } else hideAutocompleteDropdown();
    return;
  }
  models.forEach((model, index) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.setAttribute('data-index', index);
    const modelName = highlightMatch(model.model, highlightQuery);
    const metadata = [];
    if (selectedCategory === 'ALL') metadata.push(`<span class="category-badge-${model.category.toLowerCase()}">${model.category}</span>`);
    if (model.diameter) metadata.push(`Ø ${model.diameter}m`);
    if (model.height) metadata.push(`H ${model.height}m`);
    if (model.net_capacity) metadata.push(`${model.net_capacity} KL`);
    item.innerHTML = `<div class="autocomplete-item-title">${modelName}</div>${metadata.length > 0 ? `<div class="autocomplete-item-meta">${metadata.join(' • ')}</div>` : ''}`;
    item.addEventListener('click', () => selectModel(model.model));
    item.addEventListener('mouseenter', () => { selectedSuggestionIndex = index; updateSelectedSuggestion(dropdown.querySelectorAll('.autocomplete-item')); });
    dropdown.appendChild(item);
  });
  showAutocompleteDropdown();
}

function updateResultsCount(models, highlightQuery = '') {
  const resultsCount = document.getElementById('modelResultsCount');
  if (!resultsCount) return;
  if (models && models.length > 0) { resultsCount.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} found`; resultsCount.className = 'field-hint has-results'; }
  else if (highlightQuery) { resultsCount.textContent = 'No models match your search'; resultsCount.className = 'field-hint no-results'; }
  else { resultsCount.textContent = ''; resultsCount.className = 'field-hint'; }
}

function highlightMatch(text, query) {
  if (!query) return text;
  return text.replace(new RegExp(`(${escapeRegex(query)})`, 'gi'), '<mark>$1</mark>');
}

function escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function selectModel(modelName) {
  document.getElementById('modelInput').value = modelName;
  hideAutocompleteDropdown();
  const resultsCount = document.getElementById('modelResultsCount');
  if (resultsCount) {
    resultsCount.textContent = `✓ ${modelName} selected`;
    resultsCount.className = 'field-hint selected';
    setTimeout(() => { resultsCount.textContent = ''; resultsCount.className = 'field-hint'; }, 2000);
  }
}

function showAutocompleteDropdown() { const d = document.getElementById('modelDropdown'); if (d) d.classList.add('show'); }
function hideAutocompleteDropdown() { const d = document.getElementById('modelDropdown'); if (d) d.classList.remove('show'); selectedSuggestionIndex = -1; }

function showAutocompleteError() {
  const dropdown = document.getElementById('modelDropdown');
  if (dropdown) {
    dropdown.innerHTML = `<div class="autocomplete-empty error"><p>Failed to load models</p><small>Please try again</small></div>`;
    showAutocompleteDropdown();
  }
}

function changeCategory() {
  selectedCategory = null;
  document.getElementById('tankTypeSelection').style.display = 'block';
  document.getElementById('searchInterface').style.display = 'none';
  document.getElementById('tankSearchForm').reset();
  clearResults(); hideAutocompleteDropdown();
  const resultsCount = document.getElementById('modelResultsCount');
  if (resultsCount) { resultsCount.textContent = ''; resultsCount.className = 'field-hint'; }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================
// Handle Search Form Submit
// ============================================
function handleSearch(event) {
  event.preventDefault();
  hideAutocompleteDropdown();
  if (!selectedCategory) { showNotification('Please select a category first', 'error'); return; }
  const capacity = document.getElementById('capacityInput').value.trim();
  const model = document.getElementById('modelInput').value.trim();
  const diameter = document.getElementById('diameterInput').value.trim();
  const height = document.getElementById('heightInput').value.trim();
  const minPrice = document.getElementById('minPriceInput').value.trim();
  const maxPrice = document.getElementById('maxPriceInput').value.trim();
  const sortBy = document.getElementById('sortBySelect').value;
  if (!capacity && !model && !diameter && !height && !minPrice && !maxPrice) {
    showNotification('Please enter at least one search parameter', 'error'); return;
  }
  const params = new URLSearchParams();
  if (selectedCategory !== 'ALL') params.append('category', selectedCategory);
  if (capacity) params.append('capacity', capacity);
  if (model) params.append('model', model);
  if (diameter) params.append('diameter', diameter);
  if (height) params.append('height', height);
  if (minPrice) params.append('min_price', minPrice);
  if (maxPrice) params.append('max_price', maxPrice);
  if (sortBy) params.append('sort_by', sortBy);
  if (diameter && height) {
    const d = parseFloat(diameter), h = parseFloat(height);
    if (!isNaN(d) && !isNaN(h) && d > 0 && h > 0) {
      const volume = Math.PI * Math.pow(d / 2, 2) * h;
      const volumeInfo = document.getElementById('volumeInfo');
      volumeInfo.innerHTML = `<h4>Calculated Volume</h4><p><strong>${volume.toFixed(2)} m³ (KL)</strong> based on ${d}m diameter × ${h}m height</p>`;
      volumeInfo.classList.add('show');
    }
  } else { document.getElementById('volumeInfo').classList.remove('show'); }
  performSearch(params);
}

function performSearch(params) {
  showLoading();
  fetch(`/api/search/?${params.toString()}`)
    .then(res => { if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Search failed'); }); return res.json(); })
    .then(data => displayResults(data))
    .catch(err => { console.error('Search error:', err); showError(err.message); });
}

// ============================================
// Display Results
// ============================================
function displayResults(data) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsGrid = document.getElementById('resultsGrid');
  resultsGrid.innerHTML = '';
  if (!data.results || data.results.length === 0) { showNoResults(); return; }
  let headerText = '';
  const searchInfo = data.search_info;
  if (searchInfo.category === 'all') headerText = `Universal Search: ${data.count} tank${data.count !== 1 ? 's' : ''} found`;
  else if (searchInfo.search_type === 'capacity') headerText = `Found ${data.count} tank${data.count !== 1 ? 's' : ''} for ${searchInfo.capacity_kl} KL`;
  else if (searchInfo.search_type === 'model') headerText = `Results for model: ${searchInfo.query}`;
  else if (searchInfo.search_type === 'dimensions') headerText = `${data.count} match${data.count !== 1 ? 'es' : ''} for ${searchInfo.diameter}m × ${searchInfo.height}m`;
  else headerText = `${data.count} result${data.count !== 1 ? 's' : ''} found`;
  if (searchInfo.sorted_by) {
    const sortLabels = { 'price_low_to_high': 'Sorted: Price (Low to High)', 'price_high_to_low': 'Sorted: Price (High to Low)', 'capacity_low_to_high': 'Sorted: Capacity (Low to High)' };
    headerText += ` • ${sortLabels[searchInfo.sorted_by] || ''}`;
  }
  resultsHeader.innerHTML = `<h3>${headerText}</h3><p>${data.count} result${data.count !== 1 ? 's' : ''}</p>`;
  data.results.forEach(tank => resultsGrid.appendChild(createResultCard(tank)));
  resultsSection.classList.add('show');
  setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// ============================================
// Create Result Card
// ============================================
function createResultCard(tank) {
  const card = document.createElement('div');
  card.className = 'result-card';
  let matchInfo = '';
  if (tank.match_label) {
    let bgColor = '#FEF3C7', borderColor = '#F59E0B', textColor = '#78350F';
    if (tank.match_label === 'Exact Match') { bgColor = '#D1FAE5'; borderColor = '#10B981'; textColor = '#065F46'; }
    matchInfo = `<div class="match-info" style="background:${bgColor};border-left-color:${borderColor};color:${textColor};">${tank.match_label}${tank.match_difference !== undefined ? ` (Δ ${tank.match_difference} KL)` : ''}</div>`;
  } else if (tank.match_type === 'approximate') {
    matchInfo = `<div class="match-info">Approximate match<br>Diameter: ±${tank.diameter_diff}m | Height: ±${tank.height_diff}m</div>`;
  }
  card.innerHTML = `
    <div class="card-header">
      <div class="card-title-row">
        <h3 class="model-name">${tank.model}</h3>
      </div>

      <div class="card-actions">
        <button class="copy-btn" onclick="copyTankDetails(event, ${JSON.stringify(tank).replace(/"/g, '&quot;')})">
          <i class="ri-file-copy-line"></i>
        </button>
      </div>
    </div>
    <div class="specs-grid">
      <div class="spec-row"><span class="spec-label">Diameter</span><span class="spec-value">${tank.diameter} m</span></div>
      <div class="spec-row"><span class="spec-label">Height</span><span class="spec-value">${tank.height} m</span></div>
      <div class="spec-row"><span class="spec-label">Net Capacity</span><span class="spec-value">${tank.capacity_display}</span></div>
      <div class="spec-row"><span class="spec-label">Gross Capacity</span><span class="spec-value">${tank.gross_capacity_display}</span></div>
    </div>
    <div class="pricing-section">
      <div class="price-row"><span class="price-label">Ideal Price</span><span class="price-value">${tank.price_display}</span></div>
      <div class="price-row"><span class="price-label">NRP</span><span class="price-value">${tank.nrp_display}</span></div>
      <div class="price-per-kl"><span class="price-label">Price per KL</span><span class="price-value">₹${tank.price_per_kl.toLocaleString('en-IN')}/KL</span></div>
    </div>
    ${matchInfo}
    <div class="proposal-section">
      <button class="proposal-btn" data-model="${tank.model}" onclick="addTankToCart(event, ${JSON.stringify(tank).replace(/"/g, '&quot;')}, this)">
        <span class="btn-text">Add to Proposal</span>
        <span class="btn-count">0</span>
      </button>
    </div>`;
  return card;
}

// ============================================
// Copy Tank Details
// ============================================
function copyTankDetails(event, tank) {
  event.preventDefault(); event.stopPropagation();
  const details = `Tank: ${tank.model}\nCategory: ${tank.category_name}\nDiameter: ${tank.diameter} m\nHeight: ${tank.height} m\nNet Capacity: ${tank.capacity_display}\nGross Capacity: ${tank.gross_capacity_display}\nIdeal Price: ${tank.price_display}\nNRP: ${tank.nrp_display}\nPrice per KL: ₹${tank.price_per_kl}/KL`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(details).then(() => showNotification("Copied to clipboard", "success")).catch(() => fallbackCopy(details));
  } else fallbackCopy(details);
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text; textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute"; textarea.style.left = "-9999px";
  document.body.appendChild(textarea); textarea.select(); textarea.setSelectionRange(0, text.length);
  try { document.execCommand("copy"); showNotification("Copied to clipboard", "success"); }
  catch { showNotification("Tap & hold to copy manually", "info"); }
  document.body.removeChild(textarea);
}

// ============================================
// Loading / No Results / Error States
// ============================================
function showLoading() {
  const g = document.getElementById('resultsGrid');
  document.getElementById('resultsHeader').innerHTML = '';
  g.innerHTML = `<div class="loading"><div class="loading-spinner"></div><p>Searching tanks...</p></div>`;
  document.getElementById('resultsSection').classList.add('show');
}

function showNoResults() {
  document.getElementById('resultsHeader').innerHTML = '';
  document.getElementById('resultsGrid').innerHTML = `<div class="no-results"><h3>No matching tanks found</h3><p>Try adjusting your search parameters</p></div>`;
  document.getElementById('resultsSection').classList.add('show');
}

function showError(message) {
  document.getElementById('resultsHeader').innerHTML = '';
  document.getElementById('resultsGrid').innerHTML = `<div class="no-results"><h3>Error</h3><p>${message}</p></div>`;
  document.getElementById('resultsSection').classList.add('show');
}

function clearResults() {
  document.getElementById('resultsSection').classList.remove('show');
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('resultsHeader').innerHTML = '';
  document.getElementById('volumeInfo').classList.remove('show');
}

// ============================================
// PREMIUM TOAST with Progress Bar (Apple-Style)
// ============================================
function showNotification(message, type = 'info', duration = 3000) {
  // Remove existing notifications
  document.querySelectorAll('.tm-notification').forEach(n => n.remove());
  
  const notification = document.createElement('div');
  notification.className = `tm-notification tm-notification-${type}`;
  
  // Icon based on type
  let icon = '';
  switch(type) {
    case 'success': icon = '<i class="ri-check-line"></i>'; break;
    case 'error': icon = '<i class="ri-error-warning-line"></i>'; break;
    case 'info': icon = '<i class="ri-information-line"></i>'; break;
    default: icon = '<i class="ri-notification-line"></i>';
  }
  
  notification.innerHTML = `
    <div class="tm-notification-icon">${icon}</div>
    <div class="tm-notification-text">${message}</div>
    <div class="tm-notification-progress"></div>
  `;
  
  // Inject styles if not already present
  if (!document.querySelector('style[data-tm-notifications]')) {
    const style = document.createElement('style');
    style.setAttribute('data-tm-notifications', '');
    style.textContent = `
      .tm-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        min-width: 280px;
        max-width: 400px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        z-index: 99999;
        animation: tmSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 12px;
        overflow: hidden;
      }
      
      .tm-notification-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
      }
      
      .tm-notification-success .tm-notification-icon {
        background: linear-gradient(135deg, #34C759, #30D158);
        color: white;
      }
      
      .tm-notification-error .tm-notification-icon {
        background: linear-gradient(135deg, #FF3B30, #FF453A);
        color: white;
      }
      
      .tm-notification-info .tm-notification-icon {
        background: linear-gradient(135deg, #007AFF, #0A84FF);
        color: white;
      }
      
      .tm-notification-text {
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        color: #1D1D1F;
        line-height: 1.4;
      }
      
      .tm-notification-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: linear-gradient(90deg, #007AFF, #0A84FF);
        border-radius: 0 0 16px 16px;
        animation: tmProgress ${duration}ms linear forwards;
      }
      
      .tm-notification-success .tm-notification-progress {
        background: linear-gradient(90deg, #34C759, #30D158);
      }
      
      .tm-notification-error .tm-notification-progress {
        background: linear-gradient(90deg, #FF3B30, #FF453A);
      }
      
      @keyframes tmSlideIn {
        from {
          opacity: 0;
          transform: translateX(100%) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }
      
      @keyframes tmSlideOut {
        from {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateX(100%) scale(0.9);
        }
      }
      
      @keyframes tmProgress {
        from {
          width: 100%;
        }
        to {
          width: 0%;
        }
      }
      
      /* Mobile optimization */
      @media (max-width: 768px) {
        .tm-notification {
          top: 16px;
          right: 16px;
          left: 16px;
          min-width: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // Auto dismiss
  setTimeout(() => {
    notification.style.animation = 'tmSlideOut 0.3s cubic-bezier(0.4, 0, 1, 1) forwards';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, duration);
}

// ============================================
// Collections Management UI
// ============================================
function toggleCollectionsDropdown() {
  const menu = document.getElementById('collectionsMenu');
  const isVisible = menu.style.display === 'block';
  if (isVisible) menu.style.display = 'none';
  else { updateCollectionsList(); menu.style.display = 'block'; }
}

function updateCollectionsList() {
  const listEl = document.getElementById('collectionsList');
  const collections = collectionsManager.getAllCollections();
  const activeId = collectionsManager.activeCollectionId;
  listEl.innerHTML = collections.map(col => `
    <div class="collection-item ${col.id === activeId ? 'active' : ''}" onclick="switchToCollection('${col.id}')">
      <div class="collection-item-info">
        <i class="ri-folder-3-${col.id === activeId ? 'fill' : 'line'}"></i>
        <span class="collection-name">${col.name}</span>
        <span class="collection-count">${col.tanks.length}</span>
      </div>
      ${col.id === activeId ? '' : `
        <div class="collection-item-actions" onclick="event.stopPropagation()">
          <button onclick="renameCollectionPrompt('${col.id}')" title="Rename"><i class="ri-edit-line"></i></button>
          <button onclick="duplicateCollectionAction('${col.id}')" title="Duplicate"><i class="ri-file-copy-line"></i></button>
          <button onclick="deleteCollectionAction('${col.id}')" title="Delete"><i class="ri-delete-bin-line"></i></button>
        </div>`}
    </div>`).join('');
}

function switchToCollection(collectionId) {
  collectionsManager.switchCollection(collectionId);
  document.getElementById('activeCollectionName').textContent = collectionsManager.getActiveCollection().name;
  document.getElementById('collectionsMenu').style.display = 'none';
  updateCartUI();
  showNotification('Switched collection', 'success');
}

function createNewCollection() {
  document.getElementById("collectionModal").classList.add("show");
  document.getElementById("collectionsMenu").style.display = "none";
  
  // Clear input and focus
  const input = document.getElementById("collectionNameInput");
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
}

function closeCollectionModal() { 
  document.getElementById("collectionModal").classList.remove("show"); 
  window.tempRenameId = null;
}

function confirmCreateCollection() {
  const name = document.getElementById("collectionNameInput").value.trim();
  if (!name) return;
  if (window.tempRenameId) {
    collectionsManager.renameCollection(window.tempRenameId, name);
    window.tempRenameId = null;
    showNotification("Collection renamed", "success");
  } else {
    collectionsManager.createCollection(name);
    showNotification("Collection created", "success");
  }
  updateCollectionsList(); updateCartUI(); closeCollectionModal();
}

function renameCollectionPrompt(collectionId) {
  const collection = collectionsManager.collections[collectionId];
  document.getElementById("collectionNameInput").value = collection.name;
  document.getElementById("collectionModal").classList.add("show");
  window.tempRenameId = collectionId;
}

function duplicateCollectionAction(collectionId) {
  const duplicate = collectionsManager.duplicateCollection(collectionId);
  if (duplicate) { updateCollectionsList(); showNotification('Collection duplicated', 'success'); }
}

function deleteCollectionAction(collectionId) {
  window.tempDeleteId = collectionId;
  document.getElementById("confirmModal").classList.add("show");
}

// ============================================
// Cart UI Update
// ============================================
function addTankToCart(event, tank, buttonElement) {
  event.preventDefault(); event.stopPropagation();
  const added = collectionsManager.addTankToCollection(tank);
  if (added) {
    updateCartUI();
    const collection = collectionsManager.getActiveCollection();
    const count = collection.tanks.filter(t => t.model === tank.model).length;
    const countEl = buttonElement.querySelector(".btn-count");
    if (countEl) countEl.textContent = count;
    buttonElement.classList.add("added");
    buttonElement.querySelector(".btn-text").textContent = "Added";
    showNotification(`${tank.model} added`, "success");
  }
}

function removeTankFromCart(tankId) {
  if (collectionsManager.removeTankFromCollection(tankId)) { 
    updateCartUI(); 
    showNotification('Tank removed', 'success'); 
  }
}

function updateCartUI() {
  const collection = collectionsManager.getActiveCollection();
  const stats = collectionsManager.getCollectionStats();
  document.getElementById('cartCount').textContent = collection.tanks.length;
  document.getElementById('cartCollectionName').textContent = collection.name;
  document.getElementById('activeCollectionName').textContent = collection.name;
  if (stats) {
    document.getElementById('cartStatTanks').textContent = stats.count;
    document.getElementById('cartStatCapacity').textContent = `${stats.totalCapacity} KL`;
    document.getElementById('cartStatPrice').textContent = `₹${parseInt(stats.totalPrice).toLocaleString('en-IN')}`;
  }
  const itemsContainer = document.getElementById('cartItems');
  if (collection.tanks.length === 0) {
    itemsContainer.innerHTML = `<div class="cart-empty"><i class="ri-shopping-cart-line"></i><p>No tanks in this collection</p><small>Search and add tanks to get started</small></div>`;
  } else {
    itemsContainer.innerHTML = collection.tanks.map((tank, index) => `
      <div class="cart-item">
        <div class="cart-item-number">${index + 1}</div>
        <div class="cart-item-details">
          <div class="cart-item-model">${tank.model}</div>
          <div class="cart-item-specs">
            <span class="cart-item-spec"><i class="ri-dashboard-line"></i>${tank.net_capacity.toFixed(2)} KL</span>
            <span class="cart-item-spec"><i class="ri-price-tag-3-line"></i>₹${tank.ideal_price.toLocaleString('en-IN')}</span>
          </div>
          <div class="cart-item-category-badge category-badge-${tank.category.toLowerCase()}">${tank.category}</div>
        </div>
        <button onclick="removeTankFromCart('${tank.id}')" class="cart-item-remove" title="Remove"><i class="ri-close-line"></i></button>
      </div>`).join('');
  }
}

function clearActiveCollection() { document.getElementById("confirmModal").classList.add("show"); }
function closeConfirmModal() { document.getElementById("confirmModal").classList.remove("show"); }

function confirmClearCollection() {
  if (window.tempDeleteId) {
    collectionsManager.deleteCollection(window.tempDeleteId);
    window.tempDeleteId = null;
    showNotification("Collection deleted", "success");
  } else {
    const collection = collectionsManager.getActiveCollection();
    collection.tanks = []; collectionsManager.saveCollections();
    showNotification("Collection cleared", "success");
  }
  updateCollectionsList(); updateCartUI(); closeConfirmModal();
}

function copyCollection(format = 'text') {
  const exported = collectionsManager.exportCollection(null, format);
  if (!exported) { showNotification('Nothing to export', 'error'); return; }
  const textToCopy = format === 'json' ? JSON.stringify(exported, null, 2) : exported;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(textToCopy).then(() => showNotification(format === 'json' ? 'JSON copied' : 'Collection copied', 'success')).catch(() => fallbackCopy(textToCopy));
  } else fallbackCopy(textToCopy);
}

// function shareCollection() {
//   const collection = collectionsManager.getActiveCollection();
//   if (!collection.tanks.length) { showNotification('Add tanks to collection first', 'error'); return; }
//   const shareData = collectionsManager.exportCollection(null, 'json');
//   const shareJSON = JSON.stringify(shareData);
//   if (navigator.share) {
//     navigator.share({ title: `TankMate: ${collection.name}`, text: shareJSON }).catch(() => showNotification('Copied to clipboard', 'success'));
//   } else if (navigator.clipboard && window.isSecureContext) {
//     navigator.clipboard.writeText(shareJSON).then(() => showNotification('Collection data copied!', 'success'));
//   }
// }

// ============================================
// Service Worker
// ============================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/static/calculator/js/sw.js")
      .then(reg => console.log("SW registered:", reg.scope))
      .catch(err => console.error("SW failed:", err));
  });
}

// ============================================
// NEXUS INTEGRATION (Keep your existing code)
// ============================================
const NexusSession = {
  _key: 'nexus_salesperson',
  get() { try { return JSON.parse(sessionStorage.getItem(this._key)); } catch { return null; } },
  set(user) {
    sessionStorage.setItem(this._key, JSON.stringify(user));
    this._updateTrigger(user);
    this._updateExportButton(user);
  },
  clear() {
    sessionStorage.removeItem(this._key);
    this._updateTrigger(null);
    this._updateExportButton(null);
    _nexusUsersCache = null;
    const btn = document.getElementById('myProjectsBtn');
    if (btn) btn.style.display = 'none';
  },
  _updateTrigger(user) {
    const trigger = document.getElementById('nexusTrigger');
    const label = document.getElementById('nexusTriggerLabel');
    if (!trigger) return;
    if (user) {
      label.textContent = user.name.split(' ')[0];
      trigger.classList.add('connected');
    } else {
      label.textContent = 'Nexus';
      trigger.classList.remove('connected');
    }
  },
  _updateExportButton(user) {
    const btn = document.getElementById('nexusExportBtn');
    if (!btn) return;
    if (user) {
      btn.classList.add('nexus-ready');
      btn.classList.remove('not-connected');
      btn.innerHTML = `<i class="ri-send-plane-fill"></i> Export → Nexus`;
    } else {
      btn.classList.remove('nexus-ready');
      btn.classList.add('not-connected');
      btn.innerHTML = `<i class="ri-send-plane-line"></i> Export TO NEXUS`;
    }
  },
  init() {
    const saved = this.get();
    this._updateTrigger(saved);
    this._updateExportButton(saved);
    _syncMyProjectsBtn();
  }
};

let _nexusUsersCache = null;
let _nexusProjectsCache = null;
let _pendingDupMatches = [];
let _dupCheckTimer = null;

async function _fetchNexusUsers() {
  if (_nexusUsersCache) return _nexusUsersCache;
  try {
    const res = await fetch('/api/nexus/users/');
    const data = await res.json();
    if (data.users && data.users.length) _nexusUsersCache = data.users;
    return _nexusUsersCache || [];
  } catch { return []; }
}

function _syncMyProjectsBtn() {
  const btn = document.getElementById('myProjectsBtn');
  const user = NexusSession.get();
  if (btn) btn.style.display = user ? 'flex' : 'none';
}

async function toggleNexusDropdown() {
  const dropdown = document.getElementById('nexusDropdown');
  const isOpen = dropdown.style.display === 'block';
  if (isOpen) { dropdown.style.display = 'none'; return; }
  dropdown.style.display = 'block';
  const listEl = document.getElementById('nexusDropdownList');
  const footer = document.getElementById('nexusDropdownFooter');
  const saved = NexusSession.get();
  listEl.innerHTML = `<div class="nexus-dropdown-loading"><div class="nexus-spinner"></div><span>Loading...</span></div>`;
  try {
    const users = await _fetchNexusUsers();
    if (!users.length) {
      listEl.innerHTML = `<div class="nexus-dropdown-loading"><span>No users found</span></div>`;
      return;
    }
    listEl.innerHTML = users.map(u => {
      const initials = u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
      const isActive = saved && saved.name === u.name;
      return `
        <div class="nexus-dropdown-item ${isActive ? 'active' : ''}"
             data-name="${u.name}"
             onclick="selectNexusIdentity('${u.name.replace(/'/g,"\\'")}')">
          <span class="nd-avatar">${initials}</span>
          <span>${u.name}</span>
          <i class="ri-check-line nd-check"></i>
        </div>`;
    }).join('');
    footer.style.display = saved ? 'block' : 'none';
  } catch {
    listEl.innerHTML = `<div class="nexus-dropdown-loading"><span>Failed to load</span></div>`;
  }
}

function selectNexusIdentity(name) {
  NexusSession.set({ name });
  document.getElementById('nexusDropdown').style.display = 'none';
  document.getElementById('nexusDropdownFooter').style.display = 'block';
  _syncMyProjectsBtn();
  showNotification(`Connected as ${name}`, 'success');
}

document.addEventListener('click', (e) => {
  const wrapper = document.getElementById('nexusDropdownWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const dd = document.getElementById('nexusDropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function exportToNexus() {
  const user = NexusSession.get();
  if (!user) {
    await toggleNexusDropdown();
    showNotification('Please select your identity first', 'error');
    return;
  }
  const collection = collectionsManager.getActiveCollection();
  if (!collection.tanks.length) {
    showNotification('Add tanks to collection first', 'error');
    return;
  }
  _showExportConfirmModal(collection, user.name);
}

function _showExportConfirmModal(collection, salesPerson) {
  const stats = collectionsManager.getCollectionStats();
  const modal = document.getElementById('nexusExportConfirmModal');
  document.getElementById('ecm-client-name').textContent = collection.name;
  document.getElementById('ecm-sales-person').textContent = salesPerson;
  document.getElementById('ecm-tank-count').textContent = `${stats.count} tank${stats.count !== 1 ? 's' : ''}`;
  document.getElementById('ecm-capacity').textContent = `${stats.totalCapacity} KL`;
  document.getElementById('ecm-total-price').textContent = `₹${parseInt(stats.totalPrice).toLocaleString('en-IN')}`;
  const tanksHtml = collection.tanks.map((tank, i) => `
    <div class="ecm-tank-row">
      <span class="ecm-tank-num">${i + 1}</span>
      <div class="ecm-tank-info">
        <span class="ecm-tank-model">${tank.model}</span>
        <span class="ecm-tank-spec">${tank.net_capacity.toFixed(1)} KL · ₹${tank.ideal_price.toLocaleString('en-IN')}</span>
      </div>
      <span class="ecm-tank-badge ecm-badge-${tank.category.toLowerCase()}">${tank.category}</span>
    </div>`).join('');
  document.getElementById('ecm-tanks-list').innerHTML = tanksHtml;
  window._ecmCollection = collection;
  window._ecmSalesPerson = salesPerson;
  modal.classList.add('show');
}

function closeExportConfirmModal() {
  document.getElementById('nexusExportConfirmModal').classList.remove('show');
  window._ecmCollection = null;
  window._ecmSalesPerson = null;
}

async function confirmExportToNexus() {
  const collection = window._ecmCollection;
  const salesPerson = window._ecmSalesPerson;
  if (!collection || !salesPerson) return;
  closeExportConfirmModal();
  await _doExport(collection, salesPerson);
}

async function _doExport(collection, salesPerson) {
  const exported = collectionsManager.exportCollection(null, 'json');
  showNotification('Sending to Nexus…', 'info');
  try {
    const res = await fetch('/api/nexus/export/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: collection.name,
        sales_person: salesPerson,
        tanks: exported.tanks,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showNotification(`Proposal #${data.log_id} created ✓`, 'success');
      _nexusProjectsCache = null;
      if (data.redirect_url) window.open(data.redirect_url, '_blank');
    } else {
      showNotification(data.error || 'Export failed', 'error');
    }
  } catch {
    showNotification('Could not reach Nexus', 'error');
  }
}

function checkCollectionNameDuplicate(value) {
  const checkEl = document.getElementById('collectionNameCheck');
  const suggestEl = document.getElementById('collectionNameSuggestions');
  const trimmed = (value || '').trim();
  clearTimeout(_dupCheckTimer);
  _pendingDupMatches = [];
  if (!checkEl) return;
  checkEl.className = 'collection-name-check';
  checkEl.textContent = '';
  if (suggestEl) {
    suggestEl.style.display = 'none';
    suggestEl.innerHTML = '';
  }
  if (!trimmed) return;
  const localHit = collectionsManager.getAllCollections()
    .find(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (localHit) {
    checkEl.className = 'collection-name-check warning';
    checkEl.textContent = `⚠ Already exists locally (${localHit.tanks.length} tank${localHit.tanks.length !== 1 ? 's' : ''})`;
    return;
  }
  const user = NexusSession.get();
  if (!user || trimmed.length < 2) {
    checkEl.className = 'collection-name-check clear';
    checkEl.textContent = '✓ Name is available';
    return;
  }
  checkEl.className = 'collection-name-check';
  checkEl.textContent = '⏳ Checking Nexus…';
  _dupCheckTimer = setTimeout(async () => {
    try {
      const resp = await fetch(
        `/api/nexus/check/?sales_person=${encodeURIComponent(user.name)}&q=${encodeURIComponent(trimmed)}`
      );
      const data = await resp.json();
      const matches = data.matches || [];
      checkEl.textContent = '';
      checkEl.className = 'collection-name-check';
      if (suggestEl) { suggestEl.style.display = 'none'; suggestEl.innerHTML = ''; }
      if (!matches.length) {
        checkEl.className = 'collection-name-check clear';
        checkEl.textContent = '✓ Name is available';
        return;
      }
      _pendingDupMatches = matches;
      const exact = matches.find(m => m.client_name.toLowerCase() === trimmed.toLowerCase());
      if (exact) {
        checkEl.className = 'collection-name-check warning';
        checkEl.textContent = `⚠ Exact match in Nexus — created ${exact.created_at}`;
      } else {
        checkEl.className = 'collection-name-check warning';
        checkEl.textContent = `⚠ ${matches.length} similar project${matches.length > 1 ? 's' : ''} found in your Nexus history`;
      }
      if (suggestEl) _renderDupCards(matches, suggestEl);
    } catch (_err) {
      checkEl.className = 'collection-name-check clear';
      checkEl.textContent = '✓ Name is available';
    }
  }, 400);
}

function _renderDupCards(matches, container) {
  container.innerHTML = '';
  container.style.display = 'block';
  const labelEl = document.createElement('div');
  labelEl.className = 'cns-label';
  labelEl.innerHTML = '<i class="ri-history-line"></i> Similar projects in your Nexus history — click to import';
  container.appendChild(labelEl);
  matches.forEach(match => {
    const card = document.createElement('div');
    card.className = 'cns-card';
    card.innerHTML = `
      <div class="cns-card-info">
        <span class="cns-card-name">${_esc(match.client_name)}</span>
        <span class="cns-card-meta">${match.tank_count} tank${match.tank_count !== 1 ? 's' : ''} · ${match.created_at}</span>
      </div>
      <span class="cns-import-btn"><i class="ri-download-line"></i> Import</span>
    `;
    card.addEventListener('click', () => _importFromSuggestion(match));
    container.appendChild(card);
  });
}

async function _importFromSuggestion(match) {
  closeCollectionModal();
  const user = NexusSession.get();
  if (!user) return;
  showNotification('Loading project…', 'info');
  try {
    _nexusProjectsCache = null;
    const projects = await _getProjectsForUser(user.name);
    const project = projects.find(p => p.log_id === match.log_id);
    if (!project) { showNotification('Could not find project data', 'error'); return; }
    importNexusProject(project.log_id, project.client_name, project.payload);
  } catch {
    showNotification('Failed to import project', 'error');
  }
}

async function _getProjectsForUser(salesPerson) {
  if (_nexusProjectsCache && _nexusProjectsCache.user === salesPerson) {
    return _nexusProjectsCache.projects;
  }
  const resp = await fetch(`/api/nexus/projects/?sales_person=${encodeURIComponent(salesPerson)}`);
  const data = await resp.json();
  const projects = data.projects || [];
  _nexusProjectsCache = { user: salesPerson, projects };
  return projects;
}

async function openNexusProjects() {
  const user = NexusSession.get();
  if (!user) { showNotification('Connect to Nexus first', 'error'); return; }
  document.getElementById('collectionsMenu').style.display = 'none';
  const modal = document.getElementById('nexusProjectsModal');
  const subtitle = document.getElementById('nexusProjectsSubtitle');
  const listEl = document.getElementById('nexusProjectsList');
  modal.classList.add('show');
  subtitle.textContent = `Projects by ${user.name} — click Import to load into TankMate`;
  listEl.innerHTML = `
    <div style="text-align:center;padding:24px;color:#9ca3af;">
      <div class="nexus-spinner" style="margin:0 auto 8px;"></div>
      Loading your projects…
    </div>`;
  _nexusProjectsCache = null;
  try {
    const projects = await _getProjectsForUser(user.name);
    if (!projects.length) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:32px;color:#9ca3af;">
          <i class="ri-inbox-line" style="font-size:40px;opacity:0.4;display:block;margin-bottom:8px;"></i>
          No past projects found
        </div>`;
      return;
    }
    
    // Updated projects mapping with lock state display
    listEl.innerHTML = projects.map(p => {
      const isLocked   = p.is_locked;
      const lockReason = p.lock_reason || 'Modified in Nexus';

      return `
        <div class="nexus-project-item ${isLocked ? 'nexus-project-locked' : ''}">
          <div class="nexus-project-item-header">
            <div>
              <div class="nexus-project-item-name">
                ${isLocked ? '🔒' : '✅'} ${_esc(p.client_name)}
                ${isLocked ? `<span class="npi-locked-badge">LOCKED</span>` : ''}
              </div>
              <div class="nexus-project-item-meta">
                #${p.log_id} · ${p.tank_count} tank${p.tank_count !== 1 ? 's' : ''} · ${p.created_at}
                ${isLocked ? `<span class="npi-lock-reason">⚠ ${_esc(lockReason)}</span>` : ''}
              </div>
            </div>
            <button
              class="nexus-project-import-btn ${isLocked ? 'npi-btn-locked' : ''}"
              ${isLocked ? 'disabled' : ''}
              onclick='${isLocked ? '' : `importNexusProject(${JSON.stringify(p.log_id)}, ${JSON.stringify(p.client_name)}, ${JSON.stringify(p.payload)})`}'
              title="${isLocked ? lockReason : 'Import into TankMate'}"
            >
              <i class="ri-${isLocked ? 'lock-line' : 'download-line'}"></i>
              ${isLocked ? 'Locked' : 'Import'}
            </button>
          </div>
        </div>`;
    }).join('');
    
  } catch (err) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:24px;color:#ef4444;">
        <i class="ri-error-warning-line" style="font-size:28px;"></i>
        <p style="margin-top:8px;">Failed to load — check Nexus connection</p>
      </div>`;
  }
}

function closeNexusProjectsModal() {
  document.getElementById('nexusProjectsModal').classList.remove('show');
}

function importNexusProject(logId, clientName, payload) {
  const existing = collectionsManager.getAllCollections()
    .find(c => c.name.toLowerCase() === clientName.toLowerCase());
  if (existing) {
    document.getElementById('iom-name').textContent = clientName;
    document.getElementById('iom-count').textContent =
      `${existing.tanks.length} tank${existing.tanks.length !== 1 ? 's' : ''}`;
    window._iomPayload = payload;
    window._iomClientName = clientName;
    window._iomExistingId = existing.id;
    document.getElementById('importOverwriteModal').classList.add('show');
    return;
  }
  const col = collectionsManager.createCollection(clientName);
  _loadPayloadIntoCollection(payload, col.id, clientName);
}

function closeImportOverwriteModal() {
  document.getElementById('importOverwriteModal').classList.remove('show');
}

function confirmImportOverwrite() {
  closeImportOverwriteModal();
  const existing = collectionsManager.collections[window._iomExistingId];
  if (existing) { existing.tanks = []; collectionsManager.saveCollections(); }
  _loadPayloadIntoCollection(window._iomPayload, window._iomExistingId, window._iomClientName);
}

function importAsNewCollection() {
  closeImportOverwriteModal();
  const col = collectionsManager.createCollection(`${window._iomClientName} (Imported)`);
  _loadPayloadIntoCollection(window._iomPayload, col.id, col.name);
}

function _loadPayloadIntoCollection(payload, collectionId, label) {
  const tanks = (payload || []).map(p => ({
    model: p.tankModel || '',
    category: _guessCategory(p.tankModel),
    category_name: _guessCategoryName(p.tankModel),
    diameter: parseFloat(p.tankDiameter) || 0,
    height: parseFloat(p.tankHeight) || 0,
    net_capacity: p.netCapacity || 0,
    gross_capacity: p.grossCapacity || 0,
    ideal_price: p.tankCost || 0,
    nrp: p.tankCost || 0,
    price_per_kl: p.netCapacity ? Math.round(p.tankCost / p.netCapacity) : 0,
  }));
  tanks.forEach(t => collectionsManager.addTankToCollection(t, collectionId));
  collectionsManager.switchCollection(collectionId);
  updateCartUI();
  closeNexusProjectsModal();
  showNotification(`"${label}" imported — ${tanks.length} tanks loaded`, 'success');
}

function _guessCategory(model) {
  const m = (model || '').toUpperCase();
  if (m.startsWith('RCT')) return 'RCT';
  if (m.startsWith('SST')) return 'SST';
  if (m.startsWith('SFM')) return 'SFM';
  if (m.startsWith('GFS')) return 'GFS';
  return 'RCT';
}

function _guessCategoryName(model) {
  return { RCT:'Rhino Commercial Tank', SST:'SecureStore Micro-Coated Tanks',
           SFM:'Factory Mutual Tanks', GFS:'Glass Fiber Sheets Tank' }[_guessCategory(model)] || 'Tank';
}

function closeNexusDuplicateModal() {
  document.getElementById('nexusDuplicateModal').classList.remove('show');
  window._ndmPendingMatch = null;
}

async function importAndCloseDuplicateModal() {
  document.getElementById('nexusDuplicateModal').classList.remove('show');
  closeCollectionModal();
  const match = window._ndmPendingMatch;
  window._ndmPendingMatch = null;
  if (match) await _importFromSuggestion(match);
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}