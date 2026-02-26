// ============================================
// TankMate - Refactored with 5 Categories + Universal Search
// RCT | SST | SFM | GFS | ALL (Universal)
// ============================================

const CATEGORY_CONFIG = {
  RCT: {
    code: "RCT",
    name: "Rhino Commercial Tank",
    short: "RCT",
    description: "Commercial liquid water storage solutions",
    unit: "KL"
  },
  SST: {
    code: "SST",
    name: "SecureStore Micro-Coated Tanks",
    short: "SST",
    description: "Large-scale industrial storage solutions",
    unit: "KL"
  },
  SFM: {
    code: "SFM",
    name: "Factory Mutual Tanks",
    short: "SFM",
    description: "Factory Mutual storage systems",
    unit: "KL"
  },
  GFS: {
    code: "GFS",
    name: "Glass Fiber Sheets Tank",
    short: "GFS",
    description: "Lightweight glass fiber reinforced tanks",
    unit: "KL"
  },
  ALL: {
    code: "ALL",
    name: "Universal Search",
    short: "All Categories",
    description: "Search across all tank categories",
    unit: "KL"
  }
};

// ============================================
// Global State
// ============================================
let selectedCategory = null;
let autocompleteTimeout = null;
let currentSuggestions = [];
let selectedSuggestionIndex = -1;

// ============================================
// Initialize App
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  console.log('TankMate initialized - 5 categories + Universal Search');
  document.documentElement.style.scrollBehavior = 'smooth';
  setupGlobalListeners();
});

// ============================================
// Setup Global Event Listeners
// ============================================
function setupGlobalListeners() {
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('modelDropdown');
    const input = document.getElementById('modelInput');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
      hideAutocompleteDropdown();
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideAutocompleteDropdown();
    }
  });
}

// ============================================
// Category Selection (5 Cards)
// ============================================
function selectCategory(category) {
  selectedCategory = category;
  
  const categoryTypeSection = document.getElementById('tankTypeSelection');
  const searchInterface = document.getElementById('searchInterface');
  
  categoryTypeSection.style.display = 'none';
  searchInterface.style.display = 'block';
  
  // Update selected category name
  const config = CATEGORY_CONFIG[category];
  document.getElementById('selectedCategoryName').textContent = config.name;
  
  // Show/hide price filter (only for universal search)
  const priceFilterSection = document.getElementById('priceFilterSection');
  if (category === 'ALL') {
    priceFilterSection.style.display = 'grid';
  } else {
    priceFilterSection.style.display = 'none';
    // Clear price inputs
    document.getElementById('minPriceInput').value = '';
    document.getElementById('maxPriceInput').value = '';
  }
  
  // Setup autocomplete
  setupAutocomplete();
  
  // Clear previous results
  clearResults();
  
  // Scroll to search interface
  setTimeout(() => {
    searchInterface.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ============================================
// Setup Autocomplete Event Listeners
// ============================================
function setupAutocomplete() {
  const modelInput = document.getElementById('modelInput');
  
  modelInput.removeEventListener('input', handleModelInput);
  modelInput.removeEventListener('focus', handleModelFocus);
  modelInput.removeEventListener('keydown', handleModelKeydown);
  
  modelInput.addEventListener('input', handleModelInput);
  modelInput.addEventListener('focus', handleModelFocus);
  modelInput.addEventListener('keydown', handleModelKeydown);
}

// ============================================
// Handle Model Input (Real-time Search)
// ============================================
function handleModelInput(event) {
  const query = event.target.value.trim();
  
  if (autocompleteTimeout) {
    clearTimeout(autocompleteTimeout);
  }
  
  selectedSuggestionIndex = -1;
  
  autocompleteTimeout = setTimeout(() => {
    if (query.length >= 2) {
      searchModels(query);
    } else if (query.length === 0) {
      loadModels(selectedCategory);
    } else {
      hideAutocompleteDropdown();
      updateResultsCount('');
    }
  }, 200);
}

// ============================================
// Handle Model Focus
// ============================================
function handleModelFocus(event) {
  const query = event.target.value.trim();
  if (!query) {
    loadModels(selectedCategory);
  } else if (query.length >= 2 && currentSuggestions.length > 0) {
    showAutocompleteDropdown();
  }
}

// ============================================
// Handle Keyboard Navigation
// ============================================
function handleModelKeydown(event) {
  const dropdown = document.getElementById('modelDropdown');
  if (!dropdown || !dropdown.classList.contains('show')) return;
  
  const items = dropdown.querySelectorAll('.autocomplete-item');
  if (items.length === 0) return;
  
  switch(event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
      updateSelectedSuggestion(items);
      break;
      
    case 'ArrowUp':
      event.preventDefault();
      selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
      updateSelectedSuggestion(items);
      break;
      
    case 'Enter':
      event.preventDefault();
      if (selectedSuggestionIndex >= 0 && items[selectedSuggestionIndex]) {
        items[selectedSuggestionIndex].click();
      }
      break;
      
    case 'Escape':
      event.preventDefault();
      hideAutocompleteDropdown();
      break;
  }
}

// ============================================
// Update Selected Suggestion Highlight
// ============================================
function updateSelectedSuggestion(items) {
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('selected');
    }
  });
}

// ============================================
// Search Models with Query
// ============================================
function searchModels(query) {
  if (!selectedCategory) return;

  // Build URL based on category
  let url = `/api/models/?q=${encodeURIComponent(query)}`;
  if (selectedCategory !== 'ALL') {
    url += `&category=${selectedCategory}`;
  }

  fetch(url)
    .then(res => res.json())
    .then(data => {
      currentSuggestions = data.models || [];
      updateModelSuggestions(data.models, query);
    })
    .catch(err => {
      console.error('Error searching models:', err);
      showAutocompleteError();
    });
}

// ============================================
// Load All Models
// ============================================
function loadModels(category) {
  if (!category) return;
  
  let url = `/api/models/`;
  if (category !== 'ALL') {
    url += `?category=${category}`;
  }
  
  fetch(url)
    .then(res => res.json())
    .then(data => {
      currentSuggestions = data.models || [];
      updateModelSuggestions(data.models);
    })
    .catch(err => {
      console.error('Error loading models:', err);
      showAutocompleteError();
    });
}

// ============================================
// Update Autocomplete Dropdown
// ============================================
function updateModelSuggestions(models, highlightQuery = '') {
  const dropdown = document.getElementById('modelDropdown');
  
  dropdown.innerHTML = '';
  selectedSuggestionIndex = -1;
  
  updateResultsCount(models, highlightQuery);
  
  if (!models || models.length === 0) {
    if (highlightQuery) {
      dropdown.innerHTML = `
        <div class="autocomplete-empty">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <path d="M24 16v12M24 32v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>No models found for "${highlightQuery}"</p>
          <small>Try a different search term</small>
        </div>
      `;
      showAutocompleteDropdown();
    } else {
      hideAutocompleteDropdown();
    }
    return;
  }
  
  models.forEach((model, index) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.setAttribute('data-index', index);
    
    const modelName = highlightMatch(model.model, highlightQuery);
    const metadata = [];
    
    // NEW: Show category badge for universal search
    if (selectedCategory === 'ALL') {
      metadata.push(`<span class="category-badge-${model.category.toLowerCase()}">${model.category}</span>`);
    }
    
    if (model.diameter) {
      metadata.push(`Ø ${model.diameter}m`);
    }
    if (model.height) {
      metadata.push(`H ${model.height}m`);
    }
    if (model.net_capacity) {
      metadata.push(`${model.net_capacity} KL`);
    }
    
    item.innerHTML = `
      <div class="autocomplete-item-title">${modelName}</div>
      ${metadata.length > 0 ? `
        <div class="autocomplete-item-meta">
          ${metadata.join(' • ')}
        </div>
      ` : ''}
    `;
    
    item.addEventListener('click', () => {
      selectModel(model.model);
    });
    
    item.addEventListener('mouseenter', () => {
      selectedSuggestionIndex = index;
      updateSelectedSuggestion(dropdown.querySelectorAll('.autocomplete-item'));
    });
    
    dropdown.appendChild(item);
  });
  
  showAutocompleteDropdown();
}

// ============================================
// Update Results Count
// ============================================
function updateResultsCount(models, highlightQuery = '') {
  const resultsCount = document.getElementById('modelResultsCount');
  
  if (!resultsCount) return;
  
  if (models && models.length > 0) {
    resultsCount.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} found`;
    resultsCount.className = 'field-hint has-results';
  } else if (highlightQuery) {
    resultsCount.textContent = 'No models match your search';
    resultsCount.className = 'field-hint no-results';
  } else {
    resultsCount.textContent = '';
    resultsCount.className = 'field-hint';
  }
}

// ============================================
// Highlight Matching Text
// ============================================
function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Select Model from Dropdown
// ============================================
function selectModel(modelName) {
  const modelInput = document.getElementById('modelInput');
  modelInput.value = modelName;
  hideAutocompleteDropdown();
  
  const resultsCount = document.getElementById('modelResultsCount');
  if (resultsCount) {
    resultsCount.textContent = `✓ ${modelName} selected`;
    resultsCount.className = 'field-hint selected';
    setTimeout(() => {
      resultsCount.textContent = '';
      resultsCount.className = 'field-hint';
    }, 2000);
  }
}

// ============================================
// Show/Hide Autocomplete Dropdown
// ============================================
function showAutocompleteDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  if (dropdown) {
    dropdown.classList.add('show');
  }
}

function hideAutocompleteDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  if (dropdown) {
    dropdown.classList.remove('show');
  }
  selectedSuggestionIndex = -1;
}

// ============================================
// Autocomplete Error State
// ============================================
function showAutocompleteError() {
  const dropdown = document.getElementById('modelDropdown');
  if (dropdown) {
    dropdown.innerHTML = `
      <div class="autocomplete-empty error">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" opacity="0.3"/>
          <path d="M24 14v14M24 32v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>Failed to load models</p>
        <small>Please try again</small>
      </div>
    `;
    showAutocompleteDropdown();
  }
}

// ============================================
// Change Category (Go Back)
// ============================================
function changeCategory() {
  selectedCategory = null;
  
  const categoryTypeSection = document.getElementById('tankTypeSelection');
  const searchInterface = document.getElementById('searchInterface');
  
  categoryTypeSection.style.display = 'block';
  searchInterface.style.display = 'none';
  
  document.getElementById('tankSearchForm').reset();
  clearResults();
  hideAutocompleteDropdown();
  
  const resultsCount = document.getElementById('modelResultsCount');
  if (resultsCount) {
    resultsCount.textContent = '';
    resultsCount.className = 'field-hint';
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================
// Handle Search Form Submit
// ============================================
function handleSearch(event) {
  event.preventDefault();
  
  hideAutocompleteDropdown();
  
  if (!selectedCategory) {
    showNotification('Please select a category first', 'error');
    return;
  }
  
  // Get form values
  const capacity = document.getElementById('capacityInput').value.trim();
  const model = document.getElementById('modelInput').value.trim();
  const diameter = document.getElementById('diameterInput').value.trim();
  const height = document.getElementById('heightInput').value.trim();
  const minPrice = document.getElementById('minPriceInput').value.trim();
  const maxPrice = document.getElementById('maxPriceInput').value.trim();
  const sortBy = document.getElementById('sortBySelect').value;
  
  // Validate at least one input
  if (!capacity && !model && !diameter && !height && !minPrice && !maxPrice) {
    showNotification('Please enter at least one search parameter', 'error');
    return;
  }
  
  // Build query parameters
  const params = new URLSearchParams();
  
  // Add category (unless universal search)
  if (selectedCategory !== 'ALL') {
    params.append('category', selectedCategory);
  }
  
  if (capacity) params.append('capacity', capacity);
  if (model) params.append('model', model);
  if (diameter) params.append('diameter', diameter);
  if (height) params.append('height', height);
  if (minPrice) params.append('min_price', minPrice);
  if (maxPrice) params.append('max_price', maxPrice);
  if (sortBy) params.append('sort_by', sortBy);
  
  // Show calculated volume if both diameter and height provided
  if (diameter && height) {
    const d = parseFloat(diameter);
    const h = parseFloat(height);
    if (!isNaN(d) && !isNaN(h) && d > 0 && h > 0) {
      const volume = Math.PI * Math.pow(d / 2, 2) * h;
      
      const volumeInfo = document.getElementById('volumeInfo');
      volumeInfo.innerHTML = `
        <h4>Calculated Volume</h4>
        <p><strong>${volume.toFixed(2)} m³ (KL)</strong> based on ${d}m diameter × ${h}m height</p>
      `;
      volumeInfo.classList.add('show');
    }
  } else {
    document.getElementById('volumeInfo').classList.remove('show');
  }
  
  // Perform search
  performSearch(params);
}

// ============================================
// Perform Search API Call
// ============================================
function performSearch(params) {
  showLoading();
  
  fetch(`/api/search/?${params.toString()}`)
    .then(res => {
      if (!res.ok) {
        return res.json().then(data => {
          throw new Error(data.error || 'Search failed');
        });
      }
      return res.json();
    })
    .then(data => {
      displayResults(data);
    })
    .catch(err => {
      console.error('Search error:', err);
      showError(err.message);
    });
}

// ============================================
// Display Results
// ============================================
function displayResults(data) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsGrid = document.getElementById('resultsGrid');
  
  resultsGrid.innerHTML = '';
  
  if (!data.results || data.results.length === 0) {
    showNoResults();
    return;
  }
  
  // Build header text
  let headerText = '';
  const searchInfo = data.search_info;
  
  if (searchInfo.category === 'all') {
    headerText = `Universal Search: ${data.count} tank${data.count !== 1 ? 's' : ''} found`;
  } else if (searchInfo.search_type === 'capacity') {
    headerText = `Found ${data.count} tank${data.count !== 1 ? 's' : ''} for ${searchInfo.capacity_kl} KL`;
  } else if (searchInfo.search_type === 'model') {
    headerText = `Results for model: ${searchInfo.query}`;
  } else if (searchInfo.search_type === 'dimensions') {
    headerText = `${data.count} match${data.count !== 1 ? 'es' : ''} for ${searchInfo.diameter}m × ${searchInfo.height}m`;
  } else {
    headerText = `${data.count} result${data.count !== 1 ? 's' : ''} found`;
  }
  
  // Add sorting info
  if (searchInfo.sorted_by) {
    const sortLabels = {
      'price_low_to_high': 'Sorted: Price (Low to High)',
      'price_high_to_low': 'Sorted: Price (High to Low)',
      'capacity_low_to_high': 'Sorted: Capacity (Low to High)'
    };
    headerText += ` • ${sortLabels[searchInfo.sorted_by] || ''}`;
  }
  
  resultsHeader.innerHTML = `
    <h3>${headerText}</h3>
    <p>${data.count} result${data.count !== 1 ? 's' : ''}</p>
  `;
  
  // Display results
  data.results.forEach(tank => {
    const card = createResultCard(tank);
    resultsGrid.appendChild(card);
  });
  
  resultsSection.classList.add('show');
  
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ============================================
// Create Result Card (WITH NEW FIELDS)
// ============================================
function createResultCard(tank) {
  const card = document.createElement('div');
  card.className = 'result-card';
   
  let matchInfo = '';
  
  if (tank.match_label) {
    let bgColor = '#FEF3C7';
    let borderColor = '#F59E0B';
    let textColor = '#78350F';
    
    if (tank.match_label === 'Exact Match') {
      bgColor = '#D1FAE5';
      borderColor = '#10B981';
      textColor = '#065F46';
    }
    
    matchInfo = `
      <div class="match-info" style="background: ${bgColor}; border-left-color: ${borderColor}; color: ${textColor};">
        ${tank.match_label}
        ${tank.match_difference !== undefined ? ` (Δ ${tank.match_difference} KL)` : ''}
      </div>
    `;
  } else if (tank.match_type === 'approximate') {
    matchInfo = `
      <div class="match-info">
        Approximate match<br>
        Diameter: ±${tank.diameter_diff}m | Height: ±${tank.height_diff}m
      </div>
    `;
  }
  
  card.innerHTML = `
    <div class="card-header">
      <div class="model-name">
        ${tank.model}
        
      </div>
      <button class="copy-icon-btn"
        onclick="copyTankDetails(event, ${JSON.stringify(tank).replace(/"/g, '&quot;')})"
        title="Copy tank details">
        Copy
      </button>
    </div>
    
    <div class="specs-grid">
      <div class="spec-row">
        <span class="spec-label">Diameter</span>
        <span class="spec-value">${tank.diameter} m</span>
      </div>
      <div class="spec-row">
        <span class="spec-label">Height</span>
        <span class="spec-value">${tank.height} m</span>
      </div>
      <div class="spec-row">
        <span class="spec-label">Net Capacity</span>
        <span class="spec-value">${tank.capacity_display}</span>
      </div>
      <div class="spec-row">
        <span class="spec-label">Gross Capacity</span>
        <span class="spec-value">${tank.gross_capacity_display}</span>
      </div>
    </div>
    
    <div class="pricing-section">
      <div class="price-row">
        <span class="price-label">Ideal Price</span>
        <span class="price-value">${tank.price_display}</span>
      </div>
      <div class="price-row">
        <span class="price-label">NRP</span>
        <span class="price-value">${tank.nrp_display}</span>
      </div>
      <div class="price-per-kl">
        <span class="price-label">Price per KL</span>
        <span class="price-value">₹${tank.price_per_kl.toLocaleString('en-IN')}/KL</span>
      </div>
    </div>
    
    ${matchInfo}
  `;
  
  return card;
}

// ============================================
// Copy Tank Details to Clipboard
// ============================================
function copyTankDetails(event, tank) {
  event.preventDefault();
  event.stopPropagation();

  const details =
`Tank: ${tank.model}
Category: ${tank.category_name}
Diameter: ${tank.diameter} m
Height: ${tank.height} m
Net Capacity: ${tank.capacity_display}
Gross Capacity: ${tank.gross_capacity_display}
Ideal Price: ${tank.price_display}
NRP: ${tank.nrp_display}
Price per KL: ₹${tank.price_per_kl}/KL`;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(details)
      .then(() => showNotification("Copied to clipboard", "success"))
      .catch(() => fallbackCopy(details));
  } else {
    fallbackCopy(details);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    document.execCommand("copy");
    showNotification("Copied to clipboard", "success");
  } catch (err) {
    showNotification("Tap & hold to copy manually", "info");
  }

  document.body.removeChild(textarea);
}

// ============================================
// Show Loading State
// ============================================
function showLoading() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsGrid = document.getElementById('resultsGrid');
  
  resultsHeader.innerHTML = '';
  resultsGrid.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Searching tanks...</p>
    </div>
  `;
  
  resultsSection.classList.add('show');
}

// ============================================
// Show No Results
// ============================================
function showNoResults() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsGrid = document.getElementById('resultsGrid');
  
  resultsHeader.innerHTML = '';
  resultsGrid.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="32" stroke="currentColor" stroke-width="3" opacity="0.3"/>
          <path d="M36 24v24M36 54v.01" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
        </svg>
      </div>
      <h3>No matching tanks found</h3>
      <p>Try adjusting your search parameters</p>
    </div>
  `;
  
  resultsSection.classList.add('show');
}

// ============================================
// Show Error
// ============================================
function showError(message) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsGrid = document.getElementById('resultsGrid');
  
  resultsHeader.innerHTML = '';
  resultsGrid.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="32" stroke="currentColor" stroke-width="3" opacity="0.3"/>
          <path d="M36 20v20M36 48v.01" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
        </svg>
      </div>
      <h3>Error</h3>
      <p>${message}</p>
    </div>
  `;
  
  resultsSection.classList.add('show');
}

// ============================================
// Clear Results
// ============================================
function clearResults() {
  const resultsSection = document.getElementById('resultsSection');
  resultsSection.classList.remove('show');
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('resultsHeader').innerHTML = '';
  document.getElementById('volumeInfo').classList.remove('show');
}

// ============================================
// Show Notification (Toast-style)
// ============================================
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  const style = document.createElement('style');
  style.textContent = `
    .notification {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    }
    
    .notification-success {
      border-left: 4px solid #34C759;
      color: #065F46;
    }
    
    .notification-error {
      border-left: 4px solid #FF3B30;
      color: #7F1D1D;
    }
    
    .notification-info {
      border-left: 4px solid #007AFF;
      color: #1E40AF;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    
    @keyframes slideOut {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `;
  
  if (!document.querySelector('style[data-notifications]')) {
    style.setAttribute('data-notifications', '');
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// ============================================
// Service Worker Registration (PWA Support)
// ============================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/static/calculator/js/sw.js")
      .then(reg => {
        console.log("Service Worker registered:", reg.scope);
      })
      .catch(err => {
        console.error("Service Worker registration failed:", err);
      });
  });
}