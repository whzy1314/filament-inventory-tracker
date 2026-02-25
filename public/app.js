// App version
const APP_VERSION = '1.0.0';
const APP_COMMIT = '95550c6';

// Apply saved theme immediately to prevent flash
(function() {
    const saved = localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

// Global state
let filaments = [];
let usedFilaments = [];
let currentEditId = null;
let deleteFilamentId = null;

// Format weight to 2 decimal places
function formatWeight(w) {
    return (typeof w === 'number' ? w : parseFloat(w) || 0).toFixed(2);
}
let useFilamentId = null;
let customColorsCache = [];
let customTypesCache = [];
let currentFilters = {
    brands: [],
    types: [],
    colors: [],
    spoolTypes: [],
    stockStatus: 'active',
    dateFrom: null,
    dateTo: null,
    weightMin: null,
    weightMax: null
};
let isFiltersActive = false;

// DOM elements
const filamentGrid = document.getElementById('filamentGrid');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const addFilamentBtn = document.getElementById('addFilamentBtn');
const filamentModal = document.getElementById('filamentModal');
const useFilamentModal = document.getElementById('useFilamentModal');
const deleteModal = document.getElementById('deleteModal');
const filamentForm = document.getElementById('filamentForm');
const useFilamentForm = document.getElementById('useFilamentForm');
const loading = document.getElementById('loading');
const emptyState = document.getElementById('emptyState');
const toast = document.getElementById('toast');

// Stats elements
const totalFilaments = document.getElementById('totalFilaments');
const totalBrands = document.getElementById('totalBrands');
const totalWeight = document.getElementById('totalWeight');
const desktopLowStockList = document.getElementById('desktopLowStockList');
const desktopLowStockCount = document.getElementById('desktopLowStockCount');
const usedStatsContainer = document.getElementById('usedStats');

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication first
    await checkAuthAndLoadUser();

    setupEventListeners();
    initializeColorOptions();
    setDefaultValues();

    // Load custom colors first, then load filaments to ensure color indicators work properly
    await loadCustomBrandsAndColors();
    loadFilaments();
    loadUsedFilaments();
});

// Check authentication and load user info
let currentUser = null;

async function checkAuthAndLoadUser() {
    try {
        const response = await fetch('/api/auth/check');
        if (!response.ok) {
            window.location.href = '/login';
            return;
        }

        const data = await response.json();
        currentUser = data.user;

        // Legacy elements (hidden but kept for compat)
        const usernameDisplay = document.getElementById('usernameDisplay');
        const roleBadge = document.getElementById('roleBadge');
        const adminPanelBtn = document.getElementById('adminPanelBtn');

        if (usernameDisplay && data.user) {
            usernameDisplay.textContent = data.user.username;
        }
        if (roleBadge && data.user) {
            roleBadge.textContent = data.user.role;
            roleBadge.className = `role-badge ${data.user.role}`;
            roleBadge.style.display = 'inline-block';
        }
        if (adminPanelBtn && data.user && data.user.role === 'admin') {
            adminPanelBtn.style.display = 'flex';
            adminPanelBtn.addEventListener('click', showAdminModal);
        }

        // Sidebar user info
        if (data.user) {
            const sidebarUsername = document.getElementById('sidebarUsername');
            const sidebarRole = document.getElementById('sidebarRole');
            const sidebarAvatar = document.getElementById('sidebarAvatar');
            const sidebarAdminBtn = document.getElementById('sidebarAdminBtn');

            if (sidebarUsername) sidebarUsername.textContent = data.user.username;
            if (sidebarRole) sidebarRole.textContent = data.user.role;
            if (sidebarAvatar) sidebarAvatar.textContent = data.user.username.charAt(0).toUpperCase();

            // Show admin button in sidebar
            if (sidebarAdminBtn && data.user.role === 'admin') {
                sidebarAdminBtn.style.display = 'flex';
                sidebarAdminBtn.addEventListener('click', showAdminModal);
            }
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login';
    }
}

// Logout function
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout failed:', error);
        window.location.href = '/login';
    }
}

// Event listeners
function setupEventListeners() {
    addFilamentBtn.addEventListener('click', showAddModal);
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    });
    searchInput.addEventListener('input', (e) => {
        if (currentActiveTab === 'historyTab') {
            filterHistoryBySearch(e.target.value.trim());
            return;
        }
        if (e.target.value === '') {
            applyFiltersAndSearch();
        }
    });
    filamentForm.addEventListener('submit', handleFormSubmit);
    useFilamentForm.addEventListener('submit', handleUseFormSubmit);

    // Filter event listeners
    document.getElementById('filterBtn').addEventListener('click', toggleFiltersPanel);
    const mobileFilterBtn = document.getElementById('mobileFilterBtn');
    if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', toggleFiltersPanel);
    const mobileAddBtn = document.getElementById('mobileAddBtn');
    if (mobileAddBtn) mobileAddBtn.addEventListener('click', showAddModal);
    document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

    // Modal close on backdrop click
    // filamentModal.addEventListener('click', (e) => {
    //     if (e.target === filamentModal) {
    //         closeModal();
    //     }
    // });

    // deleteModal.addEventListener('click', (e) => {
    //     if (e.target === deleteModal) {
    //         closeDeleteModal();
    //     }
    // });

    // useFilamentModal.addEventListener('click', (e) => {
    //     if (e.target === useFilamentModal) {
    //         closeUseModal();
    //     }
    // });

    // Confirm delete button
    document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// API functions
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`/api${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            // Handle authentication errors
            if (response.status === 401) {
                window.location.href = '/login';
                throw new Error('Authentication required');
            }
            const error = await response.json();
            throw new Error(error.error || 'API request failed');
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        if (error.message !== 'Authentication required') {
            showToast(error.message, 'error');
        }
        throw error;
    }
}

// Load filaments
async function loadFilaments() {
    try {
        showLoading(true);
        filaments = await apiCall('/filaments');
        renderFilaments(filaments.filter(f => !f.is_archived));
        updateStats();
        populateHistoryFilter();
        // Refresh mobile dashboard if it's currently visible
        const dashView = document.getElementById('mobileDashboardView');
        if (dashView && dashView.style.display === 'block') {
            renderMobileDashboard();
        }
    } catch (error) {
        console.error('Failed to load filaments:', error);
    } finally {
        showLoading(false);
    }
}

async function loadUsedFilaments() {
    try {
        usedFilaments = await apiCall('/filaments/used');
        renderUsedFilaments(usedFilaments);
        updateUsedStats();
        // Refresh mobile dashboard if currently visible
        const dashView = document.getElementById('mobileDashboardView');
        if (dashView && dashView.style.display === 'block') {
            renderMobileDashboard();
        }
    } catch (error) {
        console.error('Failed to load used filaments:', error);
    }
}

// Search filaments or history depending on active tab
async function handleSearch() {
    const query = searchInput.value.trim();

    if (currentActiveTab === 'historyTab') {
        filterHistoryBySearch(query);
        return;
    }

    if (!query) {
        loadFilaments();
        return;
    }

    try {
        showLoading(true);
        const results = await apiCall(`/filaments/search?q=${encodeURIComponent(query)}`);
        renderFilaments(results);
        updateStats(results);
    } catch (error) {
        console.error('Search failed:', error);
    } finally {
        showLoading(false);
    }
}

// Client-side search/filter for history entries
function filterHistoryBySearch(query) {
    const timeline = document.getElementById('historyTimeline');
    const emptyEl = document.getElementById('historyEmpty');
    if (!timeline) return;

    const q = (query || '').toLowerCase();

    if (!q) {
        // No search query — show all loaded history
        timeline.innerHTML = historyData.map(entry => createHistoryEntry(entry)).join('');
        if (emptyEl) emptyEl.style.display = historyData.length === 0 ? 'block' : 'none';
        return;
    }

    const filtered = historyData.filter(entry => {
        const brand = (entry.brand || '').toLowerCase();
        const type = (entry.type || '').toLowerCase();
        const color = (entry.color || '').toLowerCase();
        const printName = (entry.print_name || '').toLowerCase();
        const matchedBy = (entry.matched_by || '').toLowerCase();
        return brand.includes(q) || type.includes(q) || color.includes(q) || printName.includes(q) || matchedBy.includes(q);
    });

    if (filtered.length === 0) {
        timeline.innerHTML = '<div class="history-empty-inline"><p>No history matching your search</p></div>';
        if (emptyEl) emptyEl.style.display = 'none';
    } else {
        timeline.innerHTML = filtered.map(entry => createHistoryEntry(entry)).join('');
        if (emptyEl) emptyEl.style.display = 'none';
    }
}

// Apply filter panel (brand/type/color/date) to history entries
function filterHistoryByFilters() {
    const searchQuery = (searchInput.value || '').trim().toLowerCase();
    const timeline = document.getElementById('historyTimeline');
    const emptyEl = document.getElementById('historyEmpty');
    if (!timeline) return;

    let filtered = [...historyData];

    // Apply search text
    if (searchQuery) {
        filtered = filtered.filter(entry => {
            const brand = (entry.brand || '').toLowerCase();
            const type = (entry.type || '').toLowerCase();
            const color = (entry.color || '').toLowerCase();
            const printName = (entry.print_name || '').toLowerCase();
            return brand.includes(searchQuery) || type.includes(searchQuery) || color.includes(searchQuery) || printName.includes(searchQuery);
        });
    }

    // Apply advanced filters from filter panel
    if (currentFilters.brands.length > 0) {
        filtered = filtered.filter(e => currentFilters.brands.includes(e.brand));
    }
    if (currentFilters.types.length > 0) {
        filtered = filtered.filter(e => currentFilters.types.includes(e.type));
    }
    if (currentFilters.colors.length > 0) {
        filtered = filtered.filter(e => currentFilters.colors.includes(e.color));
    }
    if (currentFilters.dateFrom || currentFilters.dateTo) {
        filtered = filtered.filter(e => {
            const entryDate = new Date(e.created_at + 'Z');
            if (currentFilters.dateFrom && entryDate < new Date(currentFilters.dateFrom)) return false;
            if (currentFilters.dateTo && entryDate > new Date(currentFilters.dateTo + 'T23:59:59Z')) return false;
            return true;
        });
    }

    if (filtered.length === 0) {
        timeline.innerHTML = '<div class="history-empty-inline"><p>No history matching your filters</p></div>';
        if (emptyEl) emptyEl.style.display = 'none';
    } else {
        timeline.innerHTML = filtered.map(entry => createHistoryEntry(entry)).join('');
        if (emptyEl) emptyEl.style.display = 'none';
    }
}

// Render filaments
function renderFilaments(filamentsToRender) {
    if (filamentsToRender.length === 0) {
        filamentGrid.style.display = 'none';
        emptyState.style.display = 'block';
    } else {
        filamentGrid.style.display = 'grid';
        emptyState.style.display = 'none';
        filamentGrid.innerHTML = filamentsToRender.map(filament => createFilamentCard(filament, !!filament.is_archived)).join('');
    }
}

function renderUsedFilaments(filamentsToRender) {
    const usedFilamentGrid = document.getElementById('usedFilamentGrid');
    if (filamentsToRender.length === 0) {
        usedFilamentGrid.innerHTML = '<p>No used up filaments yet.</p>';
    } else {
        usedFilamentGrid.innerHTML = filamentsToRender.map(filament => createFilamentCard(filament, true)).join('');
    }
}

// Create filament card HTML
function createFilamentCard(filament, isUsed = false) {
    const weightPercentage = Math.min((filament.weight_remaining / 1000) * 100, 100);

    // Get color hex for swatch
    const colorHex = filament.color_hex || getColorHexSync(filament.color);
    const isLightColor = colorHex && (colorHex.toLowerCase() === '#ffffff' || colorHex.toLowerCase() === '#f5f5dc' || colorHex.toLowerCase() === '#f0f8ff' || colorHex === 'rgba(255,255,255,0.3)');

    // Fix date display issue - parse date correctly to avoid timezone offset
    let purchaseDate = '';
    if (filament.purchase_date) {
        const dateParts = filament.purchase_date.split('-');
        if (dateParts.length === 3) {
            const year = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1;
            const day = parseInt(dateParts[2]);
            const localDate = new Date(year, month, day);
            purchaseDate = localDate.toLocaleDateString();
        } else {
            purchaseDate = new Date(filament.purchase_date).toLocaleDateString();
        }
    }

    const dateValue = isUsed ? new Date(filament.updated_at).toLocaleDateString() : purchaseDate;

    // Weight bar color class
    let barClass = '';
    if (weightPercentage < 10) barClass = 'critical';
    else if (weightPercentage < 25) barClass = 'low';

    return `
        <div class="filament-card">
            <div class="filament-card-header">
                <div class="filament-color-swatch" style="background-color: ${colorHex || '#ccc'};${isLightColor ? ' border-color: #C6C6C8;' : ''}"></div>
                <div class="filament-card-info">
                    <div class="filament-brand">${escapeHtml(filament.brand)}</div>
                    <span class="filament-type-badge">${escapeHtml(filament.type)}</span>
                </div>
            </div>
            <div class="filament-card-body">
                <div class="filament-weight-section">
                    <div class="filament-weight-info">
                        <span class="filament-weight-value">${formatWeight(filament.weight_remaining)}<span class="filament-weight-unit">g</span></span>
                        <span class="filament-weight-unit">${escapeHtml(filament.color)}</span>
                    </div>
                    <div class="filament-weight-bar">
                        <div class="filament-weight-bar-fill ${barClass}" style="width: ${weightPercentage}%"></div>
                    </div>
                </div>
                <div class="filament-meta">
                    <span class="filament-meta-item"><i class="fas fa-circle-dot"></i> ${filament.spool_type === 'with_spool' ? 'Spool' : 'Refill'}</span>
                    ${dateValue ? `<span class="filament-meta-item"><i class="far fa-calendar"></i> ${dateValue}</span>` : ''}
                </div>
                ${filament.notes ? `<div class="filament-notes">${escapeHtml(filament.notes)}</div>` : ''}
            </div>
            <div class="filament-card-actions">
                ${!isUsed ? `
                <button onclick="showUseModal(${filament.id})"><i class="fas fa-minus-circle"></i> Use</button>
                <button onclick="editFilament(${filament.id})"><i class="fas fa-pencil"></i> Edit</button>
                ` : ''}
                <button onclick="showSpoolHistory(${filament.id})"><i class="fas fa-clock-rotate-left"></i> History</button>
                <button class="action-danger" onclick="showDeleteModal(${filament.id})"><i class="fas fa-trash"></i> Delete</button>
            </div>
        </div>
    `;
}

// Get color hex value for a color name
function getColorHexSync(color) {
    const colorMap = {
        'red': '#ff0000', 'blue': '#0000ff', 'green': '#008000', 'yellow': '#ffff00',
        'orange': '#ffa500', 'purple': '#800080', 'pink': '#ffc0cb', 'black': '#000000',
        'white': '#ffffff', 'gray': '#808080', 'grey': '#808080', 'brown': '#a52a2a',
        'silver': '#c0c0c0', 'gold': '#ffd700', 'transparent': 'rgba(255,255,255,0.3)',
        'clear': 'rgba(255,255,255,0.3)', 'natural': '#f5f5dc', 'glow in dark': '#90ee90',
        'wood': '#deb887', 'marble': '#f0f8ff', 'carbon fiber': '#36454f'
    };
    const normalized = (color || '').toLowerCase().trim();
    if (colorMap[normalized]) return colorMap[normalized];
    // Check custom colors cache
    const custom = customColorsCache.find(c => c.name.toLowerCase() === normalized);
    if (custom && custom.hex_code) return custom.hex_code;
    return '#ccc';
}

// Get color style for color indicator
function getColorStyle(color) {
    const colorMap = {
        'red': '#ff0000',
        'blue': '#0000ff',
        'green': '#008000',
        'yellow': '#ffff00',
        'orange': '#ffa500',
        'purple': '#800080',
        'pink': '#ffc0cb',
        'black': '#000000',
        'white': '#ffffff',
        'gray': '#808080',
        'grey': '#808080',
        'brown': '#a52a2a',
        'transparent': 'rgba(255,255,255,0.3)',
        'clear': 'rgba(255,255,255,0.3)'
    };

    const normalizedColor = color.toLowerCase().trim();
    const backgroundColor = colorMap[normalizedColor] || '#cccccc';

    return `background-color: ${backgroundColor}; ${backgroundColor === '#ffffff' ? 'border-color: #999;' : ''}`;
}

// Update statistics
function updateStats(filamentsToCount = filaments) {
    const activeFilaments = filamentsToCount.filter(f => !f.is_archived);
    const total = activeFilaments.length;
    const brands = new Set(activeFilaments.map(f => f.brand.toLowerCase())).size;
    const weight = activeFilaments.reduce((sum, f) => sum + (f.weight_remaining || 0), 0);

    totalFilaments.textContent = total;
    totalBrands.textContent = brands;
    totalWeight.textContent = `${formatWeight(weight)}g`;
    renderDesktopLowStock(activeFilaments);
}

function renderDesktopLowStock(activeFilaments) {
    if (!desktopLowStockList) return;

    const lowStock = activeFilaments
        .filter(f => (f.weight_remaining || 0) < 100)
        .sort((a, b) => (a.weight_remaining || 0) - (b.weight_remaining || 0));

    if (desktopLowStockCount) {
        desktopLowStockCount.textContent = String(lowStock.length);
    }

    if (lowStock.length === 0) {
        desktopLowStockList.innerHTML = '<div class="desktop-low-stock-empty">No spools currently below 100g</div>';
        return;
    }

    desktopLowStockList.innerHTML = lowStock.map(f => {
        const colorHex = f.color_hex || getColorHexSync(f.color);
        return `<div class="desktop-low-stock-item">
            <span class="desktop-low-stock-dot" style="background-color: ${colorHex};"></span>
            <div class="desktop-low-stock-info">
                <span class="desktop-low-stock-title">${escapeHtml(f.brand)} ${escapeHtml(f.type)}</span>
                <span class="desktop-low-stock-subtitle">${escapeHtml(f.color || 'Unknown')}</span>
            </div>
            <span class="desktop-low-stock-value">${formatWeight(f.weight_remaining)}g</span>
        </div>`;
    }).join('');
}

function updateUsedStats() {
    const totalUsed = usedFilaments.length;
    let statsHtml = `
        <div class="stat-card">
            <div class="stat-number">${totalUsed}</div>
            <div class="stat-label">Total Used Spools</div>
        </div>
    `;

    const statsByType = usedFilaments.reduce((acc, f) => {
        acc[f.type] = (acc[f.type] || 0) + 1;
        return acc;
    }, {});

    for (const type in statsByType) {
        statsHtml += `
            <div class="stat-card">
                <div class="stat-number">${statsByType[type]}</div>
                <div class="stat-label">${escapeHtml(type)}</div>
            </div>
        `;
    }

    usedStatsContainer.innerHTML = statsHtml;
}

// Modal functions
async function showAddModal() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = 'Add New Filament';
    resetForm();

    // Ensure custom colors are loaded before showing modal
    await loadCustomBrandsAndColors();

    showModal();
}

function showModal() {
    filamentModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    filamentModal.classList.remove('active');
    document.body.style.overflow = '';
    resetForm();
}

function showUseModal(id) {
    useFilamentId = id;
    useFilamentModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeUseModal() {
    useFilamentModal.classList.remove('active');
    document.body.style.overflow = '';
    useFilamentForm.reset();
    useFilamentId = null;
}

function resetForm() {
    filamentForm.reset();
    document.getElementById('filamentId').value = '';
    currentEditId = null;
}

// Edit filament
async function editFilament(id) {
    try {
        const filament = await apiCall(`/filaments/${id}`);
        currentEditId = id;

        document.getElementById('modalTitle').textContent = 'Edit Filament';
        document.getElementById('filamentId').value = filament.id;
        document.getElementById('brand').value = filament.brand;
        document.getElementById('type').value = filament.type;
        document.getElementById('color').value = filament.color;
        document.getElementById('spoolType').value = filament.spool_type;
        document.getElementById('weightRemaining').value = filament.weight_remaining;
        document.getElementById('purchaseDate').value = filament.purchase_date || '';
        document.getElementById('notes').value = filament.notes || '';

        showModal();
    } catch (error) {
        console.error('Failed to load filament for editing:', error);
    }
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();

    // Handle custom color
    let colorValue = document.getElementById('color').value.trim();
    if (!colorValue) {
        const customColorName = document.getElementById('customColorName');
        const colorPicker = document.getElementById('colorPicker');

        if (customColorName && customColorName.value.trim()) {
            const customColorNameValue = customColorName.value.trim();
            const hexColor = colorPicker ? colorPicker.value : '#ff0000';

            // Add custom color to database
            try {
                await apiCall('/custom-colors', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: customColorNameValue,
                        hex_code: hexColor
                    })
                });
                // Update dropdowns to include the new color
                await loadCustomBrandsAndColors();
            } catch (error) {
                // If it already exists, that's fine
                if (!error.message.includes('already exists')) {
                    console.error('Failed to add custom color:', error);
                    return;
                }
            }

            colorValue = customColorNameValue;
        } else {
            showToast('Please select a color', 'error');
            return;
        }
    }

    const formData = {
        brand: document.getElementById('brand').value.trim(),
        type: document.getElementById('type').value,
        color: colorValue,
        spool_type: document.getElementById('spoolType').value,
        weight_remaining: parseFloat(document.getElementById('weightRemaining').value) || 1000,
        purchase_date: document.getElementById('purchaseDate').value || null,
        notes: document.getElementById('notes').value.trim() || null
    };

    try {
        if (currentEditId) {
            await apiCall(`/filaments/${currentEditId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            showToast('Filament updated successfully!', 'success');
        } else {
            await apiCall('/filaments', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            showToast('Filament added successfully!', 'success');
        }

        closeModal();
        loadFilaments();
    } catch (error) {
        console.error('Failed to save filament:', error);
    }
}

// Delete functions
function showDeleteModal(id) {
    deleteFilamentId = id;
    const filament = filaments.find(f => f.id === id);

    if (filament) {
        document.getElementById('deletePreview').innerHTML = `
            <strong>${escapeHtml(filament.brand)} - ${escapeHtml(filament.type)}</strong><br>
            <small>Color: ${escapeHtml(filament.color)} | Weight: ${formatWeight(filament.weight_remaining)}g</small>
        `;
    }

    deleteModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModal.classList.remove('active');
    document.body.style.overflow = '';
    deleteFilamentId = null;
}

async function confirmDelete() {
    if (!deleteFilamentId) return;

    try {
        await apiCall(`/filaments/${deleteFilamentId}`, {
            method: 'DELETE'
        });

        showToast('Filament deleted successfully!', 'success');
        closeDeleteModal();
        loadFilaments();
    } catch (error) {
        console.error('Failed to delete filament:', error);
    }
}

// Utility functions
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

function showToast(message, type = 'success') {
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;

    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key to close modals
    if (e.key === 'Escape') {
        if (filamentModal.classList.contains('active')) {
            closeModal();
        }
        if (deleteModal.classList.contains('active')) {
            closeDeleteModal();
        }
        if (useFilamentModal.classList.contains('active')) {
            closeUseModal();
        }
    }

    // Ctrl/Cmd + K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
    }

    // Ctrl/Cmd + N to add new filament
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showAddModal();
    }
});

// Service worker registration for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// Initialize color options with visual indicators
function initializeColorOptions() {
    // Load custom brands and colors
    loadCustomBrandsAndColors();

    // Initialize custom color dropdown
    initializeCustomColorDropdown();
}

// Initialize custom color dropdown
function initializeCustomColorDropdown() {
    const dropdown = document.getElementById('colorDropdown');
    const selected = document.getElementById('colorSelected');
    const options = document.getElementById('colorOptions');
    const hiddenInput = document.getElementById('color');
    const customColorContainer = document.getElementById('customColorContainer');

    // Toggle dropdown
    selected.addEventListener('click', function () {
        const isActive = selected.classList.contains('active');

        // Close all other dropdowns
        document.querySelectorAll('.dropdown-selected.active').forEach(el => {
            if (el !== selected) {
                el.classList.remove('active');
                el.nextElementSibling.classList.remove('show');
            }
        });

        if (isActive) {
            selected.classList.remove('active');
            options.classList.remove('show');
        } else {
            selected.classList.add('active');
            options.classList.add('show');
        }
    });

    // Handle option selection
    options.addEventListener('click', function (e) {
        // Check if the click was on an edit button
        if (e.target.closest('.edit-custom-color')) {
            e.stopPropagation();
            return; // Don't handle selection if clicking edit button
        }

        const option = e.target.closest('.dropdown-option');
        if (!option) return;

        const value = option.getAttribute('data-value');
        const color = option.getAttribute('data-color');
        const textElement = option.querySelector('span:last-child');
        const text = textElement ? textElement.textContent : option.textContent.replace('★', '').trim();

        console.log('Color option selected:', { value, color, text }); // Debug log

        // Update selected display
        if (value === 'custom') {
            selected.querySelector('.selected-text').textContent = 'Select color';
            hiddenInput.value = '';
            if (customColorContainer) {
                customColorContainer.style.display = 'block';
                const customColorName = document.getElementById('customColorName');
                if (customColorName) {
                    customColorName.focus();
                    customColorName.required = true;
                }
            }
        } else {
            const colorIndicator = option.querySelector('.color-indicator');
            const selectedText = selected.querySelector('.selected-text');

            selectedText.innerHTML = '';

            if (colorIndicator) {
                const clonedIndicator = colorIndicator.cloneNode(true);
                selectedText.appendChild(clonedIndicator);
                selectedText.appendChild(document.createTextNode(' ' + text));
            } else {
                selectedText.textContent = text;
            }

            hiddenInput.value = value;

            if (customColorContainer) {
                customColorContainer.style.display = 'none';
                const customColorName = document.getElementById('customColorName');
                if (customColorName) {
                    customColorName.required = false;
                }
            }
        }

        // Update selected state
        options.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        // Close dropdown
        selected.classList.remove('active');
        options.classList.remove('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
        if (!dropdown.contains(e.target)) {
            selected.classList.remove('active');
            options.classList.remove('show');
        }
    });
}

// Load custom brands, colors, and types from database
async function loadCustomBrandsAndColors() {
    try {
        const [customBrands, customColors, customTypes] = await Promise.all([
            apiCall('/custom-brands'),
            apiCall('/custom-colors'),
            apiCall('/custom-types')
        ]);

        // Cache custom colors and types for synchronous access
        customColorsCache = customColors;
        customTypesCache = customTypes;

        updateBrandDropdown(customBrands);
        updateColorDropdown(customColors);
        updateTypeDropdown(customTypes);
    } catch (error) {
        console.error('Failed to load custom options:', error);
    }
}

// Update brand dropdown with custom brands
function updateBrandDropdown(customBrands) {
    const brandSelect = document.getElementById('brand');
    const customOption = brandSelect.querySelector('option[value="custom"]');

    // Remove existing custom brand options
    const existingCustom = brandSelect.querySelectorAll('.custom-brand-option');
    existingCustom.forEach(option => option.remove());

    // Add custom brands before the "Add Custom" option
    customBrands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand.name;
        option.textContent = `★ ${brand.name}`;
        option.className = 'custom-brand-option custom-option';
        brandSelect.insertBefore(option, customOption);
    });
}

// Update color dropdown with custom colors
function updateColorDropdown(customColors) {
    const colorOptions = document.getElementById('colorOptions');
    const customOption = colorOptions.querySelector('[data-value="custom"]');

    // Remove existing custom color options
    const existingCustom = colorOptions.querySelectorAll('.custom-color-option');
    existingCustom.forEach(option => option.remove());

    // Add custom colors before the "Add Custom" option
    customColors.forEach(color => {
        const option = document.createElement('div');
        option.className = 'dropdown-option custom-color-option custom-option';
        option.setAttribute('data-value', color.name);
        option.setAttribute('data-color', color.hex_code);
        option.innerHTML = `
            <span class="color-indicator" style="background-color: ${color.hex_code}; ${color.hex_code === '#ffffff' ? 'border-color: #999;' : ''}"></span>
            <span>★ ${color.name}</span>
        `;
        colorOptions.insertBefore(option, customOption);
    });
}

// Update type dropdown with custom types
function updateTypeDropdown(customTypes) {
    const typeSelect = document.getElementById('type');
    const customOption = typeSelect.querySelector('option[value="custom"]');

    // Remove existing custom type options
    const existingCustom = typeSelect.querySelectorAll('.custom-type-option');
    existingCustom.forEach(option => option.remove());

    // Add custom types before the "Add Custom" option
    customTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type.name;
        option.textContent = `★ ${type.name}`;
        option.className = 'custom-type-option custom-option';
        typeSelect.insertBefore(option, customOption);
    });
}

// Style color options with visual indicators
function styleColorOptions() {
    const colorSelect = document.getElementById('color');
    const colorOptions = colorSelect.querySelectorAll('option[data-color]');

    colorOptions.forEach(option => {
        const color = option.getAttribute('data-color');
        if (color) {
            // Clean up the text and set CSS custom property for color
            const colorName = option.textContent.replace('●', '').replace('★', '').trim();
            option.textContent = colorName;
            option.style.setProperty('--option-color', color);
            option.style.paddingLeft = '30px';

            // Create a visual color indicator using background
            option.style.background = `linear-gradient(90deg, ${color} 20px, transparent 20px)`;
            option.style.backgroundRepeat = 'no-repeat';
            option.style.backgroundPosition = '8px center';
            option.style.backgroundSize = '12px 12px';

            // Add border for white/light colors
            if (color === '#ffffff' || color.toLowerCase() === 'white') {
                option.style.backgroundImage = `radial-gradient(circle at 8px center, ${color} 5px, #999 5px, #999 6px, transparent 6px)`;
            }
        }
    });
}

// Set default values for the form
function setDefaultValues() {
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('purchaseDate').value = today;

    // Set default weight
    document.getElementById('weightRemaining').value = '1000';
}

// Handle form submission
async function handleUseFormSubmit(e) {
    e.preventDefault();
    if (!useFilamentId) return;

    const usageType = document.getElementById('usageType').value;
    const amount = parseFloat(document.getElementById('usageAmount').value);

    if (isNaN(amount) || amount < 0) {
        showToast('Please enter a valid amount.', 'error');
        return;
    }

    try {
        await apiCall(`/filaments/${useFilamentId}/use`, {
            method: 'POST',
            body: JSON.stringify({ usageType, amount })
        });
        showToast('Filament usage updated!', 'success');
        closeUseModal();
        loadFilaments();
        loadUsedFilaments();
    } catch (error) {
        console.error('Failed to update filament usage:', error);
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = {
        brand: document.getElementById('brand').value.trim(),
        type: document.getElementById('type').value,
        color: document.getElementById('color').value.trim(),
        spool_type: document.getElementById('spoolType').value,
        weight_remaining: parseFloat(document.getElementById('weightRemaining').value) || 1000,
        purchase_date: document.getElementById('purchaseDate').value || null,
        notes: document.getElementById('notes').value.trim() || null
    };

    try {
        if (currentEditId) {
            await apiCall(`/filaments/${currentEditId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            showToast('Filament updated successfully!', 'success');
        } else {
            await apiCall('/filaments', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            showToast('Filament added successfully!', 'success');
        }

        closeModal();
        loadFilaments();
    } catch (error) {
        console.error('Failed to save filament:', error);
    }
}

// Enhanced reset form to handle custom inputs and defaults
function resetForm() {
    filamentForm.reset();
    document.getElementById('filamentId').value = '';
    currentEditId = null;

    // Hide custom inputs (only if they exist)
    const customBrand = document.getElementById('customBrand');
    const customColorContainer = document.getElementById('customColorContainer');
    const customColorName = document.getElementById('customColorName');
    const colorPicker = document.getElementById('colorPicker');
    const colorHex = document.getElementById('colorHex');
    const customTypeContainer = document.getElementById('customType');
    const customTypeName = document.getElementById('customTypeName');

    if (customBrand) {
        customBrand.style.display = 'none';
        customBrand.required = false;
        customBrand.value = '';
    }

    if (customColorContainer) {
        customColorContainer.style.display = 'none';
    }

    if (customColorName) {
        customColorName.required = false;
        customColorName.value = '';
    }

    if (colorPicker) {
        colorPicker.value = '#ff0000';
    }

    if (colorHex) {
        colorHex.value = '';
    }

    if (customTypeContainer) {
        customTypeContainer.style.display = 'none';
    }

    if (customTypeName) {
        customTypeName.required = false;
        customTypeName.value = '';
    }

    // Reset color dropdown to default state
    const colorSelected = document.getElementById('colorSelected');
    const hiddenColorInput = document.getElementById('color');
    if (colorSelected) {
        colorSelected.querySelector('.selected-text').textContent = 'Select color';
    }
    if (hiddenColorInput) {
        hiddenColorInput.value = '';
    }

    // Reset to defaults
    setDefaultValues();

    // Reset to default selections
    document.getElementById('brand').value = 'Bambu Lab';
    document.getElementById('type').value = 'PLA';
}

// Enhanced edit function to handle custom values
async function editFilament(id) {
    try {
        const filament = await apiCall(`/filaments/${id}`);
        currentEditId = id;

        // Ensure custom colors are loaded before editing
        await loadCustomBrandsAndColors();

        document.getElementById('modalTitle').textContent = 'Edit Filament';
        document.getElementById('filamentId').value = filament.id;

        // Handle brand (check if it's in the dropdown)
        const brandSelect = document.getElementById('brand');
        const brandOptions = Array.from(brandSelect.options).map(opt => opt.value);
        if (brandOptions.includes(filament.brand)) {
            brandSelect.value = filament.brand;
        } else {
            brandSelect.value = 'custom';
            document.getElementById('customBrand').style.display = 'block';
            document.getElementById('customBrand').value = filament.brand;
            document.getElementById('customBrand').required = true;
        }

        document.getElementById('type').value = filament.type;

        // Handle color with custom dropdown
        const colorOptions = document.getElementById('colorOptions');
        const colorSelected = document.getElementById('colorSelected');
        const hiddenColorInput = document.getElementById('color');
        const customColorContainer = document.getElementById('customColorContainer');

        // Check if color exists in dropdown options
        const colorOption = colorOptions.querySelector(`[data-value="${filament.color}"]`);
        if (colorOption) {
            // Color exists in dropdown - select it
            const colorIndicator = colorOption.querySelector('.color-indicator');
            const textSpan = colorOption.querySelector('span:last-child');
            const text = textSpan ? textSpan.textContent : colorOption.textContent.replace('★', '').trim();

            colorSelected.querySelector('.selected-text').innerHTML = '';
            if (colorIndicator) {
                const clonedIndicator = colorIndicator.cloneNode(true);
                colorSelected.querySelector('.selected-text').appendChild(clonedIndicator);
            }
            colorSelected.querySelector('.selected-text').appendChild(document.createTextNode(' ' + text));
            hiddenColorInput.value = filament.color;

            if (customColorContainer) {
                customColorContainer.style.display = 'none';
                const customColorName = document.getElementById('customColorName');
                if (customColorName) {
                    customColorName.required = false;
                }
            }

            // Update selected state
            colorOptions.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
            colorOption.classList.add('selected');
        } else {
            // Color doesn't exist in predefined options - it's a custom color
            // Set the color value directly and show it as selected
            hiddenColorInput.value = filament.color;

            // Try to find the color in custom colors cache to get hex code
            const customColor = customColorsCache.find(c => c.name.toLowerCase() === filament.color.toLowerCase());
            if (customColor) {
                // It's a known custom color - display it properly
                colorSelected.querySelector('.selected-text').innerHTML = `
                    <span class="color-indicator" style="background-color: ${customColor.hex_code}; ${customColor.hex_code === '#ffffff' ? 'border-color: #999;' : ''}"></span>
                    ★ ${filament.color}
                `;
            } else {
                // Unknown color - just display the name
                colorSelected.querySelector('.selected-text').textContent = filament.color;
            }

            if (customColorContainer) {
                customColorContainer.style.display = 'none';
                const customColorName = document.getElementById('customColorName');
                if (customColorName) {
                    customColorName.required = false;
                }
            }

            // Clear selected state from all options
            colorOptions.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
        }

        document.getElementById('spoolType').value = filament.spool_type;
        document.getElementById('weightRemaining').value = filament.weight_remaining;
        document.getElementById('purchaseDate').value = filament.purchase_date || '';
        document.getElementById('notes').value = filament.notes || '';

        showModal();
    } catch (error) {
        console.error('Failed to load filament for editing:', error);
    }
}

// Enhanced color style function with custom colors support
async function getColorStyle(color) {
    const colorMap = {
        'black': '#000000',
        'white': '#ffffff',
        'red': '#ff0000',
        'blue': '#0000ff',
        'green': '#008000',
        'yellow': '#ffff00',
        'orange': '#ffa500',
        'purple': '#800080',
        'pink': '#ffc0cb',
        'gray': '#808080',
        'grey': '#808080',
        'brown': '#a52a2a',
        'silver': '#c0c0c0',
        'gold': '#ffd700',
        'transparent': 'rgba(255,255,255,0.3)',
        'clear': 'rgba(255,255,255,0.3)',
        'natural': '#f5f5dc',
        'glow in dark': '#90ee90',
        'wood': '#deb887',
        'marble': '#f0f8ff',
        'carbon fiber': '#36454f'
    };

    const normalizedColor = color.toLowerCase().trim();

    // First check predefined colors
    if (colorMap[normalizedColor]) {
        const backgroundColor = colorMap[normalizedColor];
        return `background-color: ${backgroundColor}; ${backgroundColor === '#ffffff' ? 'border-color: #999;' : ''}`;
    }

    // Check custom colors from database
    try {
        const customColors = await apiCall('/custom-colors');
        const customColor = customColors.find(c => c.name.toLowerCase() === normalizedColor);
        if (customColor) {
            return `background-color: ${customColor.hex_code}; ${customColor.hex_code === '#ffffff' ? 'border-color: #999;' : ''}`;
        }
    } catch (error) {
        console.error('Failed to load custom colors for styling:', error);
    }

    // Default fallback
    return 'background-color: #cccccc;';
}

// Synchronous version for immediate use
function getColorStyleSync(color) {
    const colorMap = {
        'black': '#000000',
        'white': '#ffffff',
        'red': '#ff0000',
        'blue': '#0000ff',
        'green': '#008000',
        'yellow': '#ffff00',
        'orange': '#ffa500',
        'purple': '#800080',
        'pink': '#ffc0cb',
        'gray': '#808080',
        'grey': '#808080',
        'brown': '#a52a2a',
        'silver': '#c0c0c0',
        'gold': '#ffd700',
        'transparent': 'rgba(255,255,255,0.3)',
        'clear': 'rgba(255,255,255,0.3)',
        'natural': '#f5f5dc',
        'glow in dark': '#90ee90',
        'wood': '#deb887',
        'marble': '#f0f8ff',
        'carbon fiber': '#36454f'
    };

    const normalizedColor = color.toLowerCase().trim();

    // First check predefined colors
    if (colorMap[normalizedColor]) {
        const backgroundColor = colorMap[normalizedColor];
        return `background-color: ${backgroundColor}; ${backgroundColor === '#ffffff' ? 'border-color: #999;' : ''}`;
    }

    // Check cached custom colors
    const customColor = customColorsCache.find(c => c.name.toLowerCase() === normalizedColor);
    if (customColor) {
        const backgroundColor = customColor.hex_code;
        return `background-color: ${backgroundColor}; ${backgroundColor === '#ffffff' ? 'border-color: #999;' : ''}`;
    }

    // Default fallback
    return 'background-color: #cccccc;';
}

// Edit custom color function
function editCustomColor(colorName, hexCode) {
    // Prevent event bubbling
    event.stopPropagation();

    // Set the form to custom color mode
    const colorSelect = document.getElementById('color');
    const customColorContainer = document.getElementById('customColorContainer');
    const customColorName = document.getElementById('customColorName');
    const colorPicker = document.getElementById('colorPicker');
    const colorHex = document.getElementById('colorHex');

    // Show custom color inputs
    customColorContainer.style.display = 'block';
    customColorName.value = colorName;
    colorPicker.value = hexCode;
    colorHex.value = hexCode;
    customColorName.required = true;

    // Update the dropdown display
    const selected = document.getElementById('colorSelected');
    selected.querySelector('.selected-text').textContent = 'Edit Custom Color';
    document.getElementById('color').value = '';

    // Close dropdown
    selected.classList.remove('active');
    document.getElementById('colorOptions').classList.remove('show');

    showToast('Editing custom color. Modify and save to update.', 'success');
}

// Add management interface for custom brands and colors
function showManageCustomsModal() {
    // Create modal HTML
    const modalHTML = `
        <div class="modal" id="manageCustomsModal">
            <div class="modal-overlay" onclick="closeManageCustomsModal()"></div>
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2>Manage Custom Brands, Colors & Types</h2>
                    <button class="close-btn" onclick="closeManageCustomsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; gap: 15px;">
                        <div style="flex: 1;">
                            <h3>Custom Brands</h3>
                            <div class="form-group">
                                <input type="text" id="newBrandName" placeholder="Enter brand name" style="width: 100%; margin-bottom: 10px;">
                                <button type="button" class="btn btn-primary btn-small" onclick="addCustomBrand()">
                                    <i class="fas fa-plus"></i> Add Brand
                                </button>
                            </div>
                            <div id="customBrandsList"></div>
                        </div>
                        <div style="flex: 1;">
                            <h3>Custom Types</h3>
                            <div class="form-group">
                                <input type="text" id="newTypeName" placeholder="Enter type name" style="width: 100%; margin-bottom: 10px;">
                                <button type="button" class="btn btn-primary btn-small" onclick="addCustomType()">
                                    <i class="fas fa-plus"></i> Add Type
                                </button>
                            </div>
                            <div id="customTypesList"></div>
                        </div>
                        <div style="flex: 1;">
                            <h3>Custom Colors</h3>
                            <div class="form-group">
                                <input type="text" id="newColorName" placeholder="Enter color name" style="width: 100%; margin-bottom: 10px;">
                                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                                    <input type="color" id="newColorPicker" value="#ff0000" style="width: 50px; height: 35px;">
                                    <input type="text" id="newColorHex" placeholder="#FF0000" maxlength="7" pattern="^#[0-9A-Fa-f]{6}$" style="flex: 1;">
                                </div>
                                <button type="button" class="btn btn-primary btn-small" onclick="addCustomColor()">
                                    <i class="fas fa-plus"></i> Add Color
                                </button>
                            </div>
                            <div id="customColorsList"></div>
                        </div>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="closeManageCustomsModal()">Close</button>
                </div>
            </div>
        </div>
    `;

    // Add modal to page if it doesn't exist
    if (!document.getElementById('manageCustomsModal')) {
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add event listeners for color picker sync
        const colorPicker = document.getElementById('newColorPicker');
        const colorHex = document.getElementById('newColorHex');

        colorPicker.addEventListener('input', function () {
            colorHex.value = this.value.toUpperCase();
        });

        colorHex.addEventListener('input', function () {
            const hex = this.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                colorPicker.value = hex;
            }
        });
    }

    loadCustomManagementData();
    document.getElementById('manageCustomsModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeManageCustomsModal() {
    const modal = document.getElementById('manageCustomsModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

async function loadCustomManagementData() {
    try {
        const [customBrands, customTypes, customColors] = await Promise.all([
            apiCall('/custom-brands'),
            apiCall('/custom-types'),
            apiCall('/custom-colors')
        ]);

        // Render custom brands
        const brandsList = document.getElementById('customBrandsList');
        brandsList.innerHTML = customBrands.map(brand => `
            <div class="custom-item-row">
                <div class="custom-item-name">
                    <span>★ ${escapeHtml(brand.name)}</span>
                </div>
                <div class="custom-item-actions">
                    <button class="btn btn-secondary btn-small" onclick="editCustomBrand('${brand.name}')" title="Edit Brand">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteCustomBrand('${brand.name}')" title="Delete Brand">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('') || '<p style="color: #666; font-style: italic;">No custom brands</p>';

        // Render custom types
        const typesList = document.getElementById('customTypesList');
        typesList.innerHTML = customTypes.map(type => `
            <div class="custom-item-row">
                <div class="custom-item-name">
                    <span>★ ${escapeHtml(type.name)}</span>
                </div>
                <div class="custom-item-actions">
                    <button class="btn btn-secondary btn-small" onclick="editCustomType('${type.name}')" title="Edit Type">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteCustomType('${type.name}')" title="Delete Type">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('') || '<p style="color: #666; font-style: italic;">No custom types</p>';

        // Render custom colors
        const colorsList = document.getElementById('customColorsList');
        colorsList.innerHTML = customColors.map(color => `
            <div class="custom-item-row">
                <div class="custom-item-name">
                    <span class="color-indicator" style="background-color: ${color.hex_code}; ${color.hex_code === '#ffffff' ? 'border-color: #999;' : ''}"></span>
                    <span>★ ${escapeHtml(color.name)}</span>
                </div>
                <div class="custom-item-actions">
                    <button class="btn btn-secondary btn-small" onclick="editCustomColorInPanel('${color.name}', '${color.hex_code}')" title="Edit Color">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteCustomColor('${color.name}')" title="Delete Color">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('') || '<p style="color: #666; font-style: italic;">No custom colors</p>';

    } catch (error) {
        console.error('Failed to load custom management data:', error);
    }
}

async function deleteCustomBrand(brandName) {
    // Check if any filaments are using this brand
    const referencingFilaments = filaments.filter(f => f.brand.toLowerCase() === brandName.toLowerCase());

    if (referencingFilaments.length > 0) {
        showReferencingFilamentsModal('brand', brandName, referencingFilaments);
        return;
    }

    showCustomDeleteConfirmModal('brand', brandName, async () => {
        try {
            await apiCall(`/custom-brands/${encodeURIComponent(brandName)}`, {
                method: 'DELETE'
            });

            showToast('Custom brand deleted successfully!', 'success');
            loadCustomManagementData();
            loadCustomBrandsAndColors(); // Refresh dropdowns
        } catch (error) {
            console.error('Failed to delete custom brand:', error);
            showToast('Failed to delete custom brand', 'error');
        }
    });
}

async function deleteCustomColor(colorName) {
    // Check if any filaments are using this color
    const referencingFilaments = filaments.filter(f => f.color.toLowerCase() === colorName.toLowerCase());

    if (referencingFilaments.length > 0) {
        showReferencingFilamentsModal('color', colorName, referencingFilaments);
        return;
    }

    showCustomDeleteConfirmModal('color', colorName, async () => {
        try {
            await apiCall(`/custom-colors/${encodeURIComponent(colorName)}`, {
                method: 'DELETE'
            });

            showToast('Custom color deleted successfully!', 'success');
            loadCustomManagementData();
            loadCustomBrandsAndColors(); // Refresh dropdowns
        } catch (error) {
            console.error('Failed to delete custom color:', error);
            showToast('Failed to delete custom color', 'error');
        }
    });
}

async function addCustomBrand() {
    const brandName = document.getElementById('newBrandName').value.trim();

    if (!brandName) {
        showToast('Please enter a brand name', 'error');
        return;
    }

    try {
        await apiCall('/custom-brands', {
            method: 'POST',
            body: JSON.stringify({ name: brandName })
        });

        showToast('Custom brand added successfully!', 'success');
        document.getElementById('newBrandName').value = '';
        loadCustomManagementData();
        loadCustomBrandsAndColors(); // Refresh dropdowns
    } catch (error) {
        console.error('Failed to add custom brand:', error);
        showToast('Failed to add custom brand', 'error');
    }
}

async function addCustomColor() {
    const colorName = document.getElementById('newColorName').value.trim();
    const colorHex = document.getElementById('newColorHex').value || document.getElementById('newColorPicker').value;

    if (!colorName) {
        showToast('Please enter a color name', 'error');
        return;
    }

    if (!colorHex || !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
        showToast('Please select a valid color', 'error');
        return;
    }

    try {
        await apiCall('/custom-colors', {
            method: 'POST',
            body: JSON.stringify({
                name: colorName,
                hex_code: colorHex
            })
        });

        showToast('Custom color added successfully!', 'success');
        document.getElementById('newColorName').value = '';
        document.getElementById('newColorHex').value = '';
        document.getElementById('newColorPicker').value = '#ff0000';
        loadCustomManagementData();
        loadCustomBrandsAndColors(); // Refresh dropdowns
    } catch (error) {
        console.error('Failed to add custom color:', error);
        showToast('Failed to add custom color', 'error');
    }
}

async function addCustomType() {
    const typeName = document.getElementById('newTypeName').value.trim();

    if (!typeName) {
        showToast('Please enter a type name', 'error');
        return;
    }

    try {
        await apiCall('/custom-types', {
            method: 'POST',
            body: JSON.stringify({ name: typeName })
        });

        showToast('Custom type added successfully!', 'success');
        document.getElementById('newTypeName').value = '';
        loadCustomManagementData();
        loadCustomBrandsAndColors(); // Refresh dropdowns
    } catch (error) {
        console.error('Failed to add custom type:', error);
        showToast('Failed to add custom type', 'error');
    }
}

async function deleteCustomType(typeName) {
    // Check if any filaments are using this type
    const referencingFilaments = filaments.filter(f => f.type.toLowerCase() === typeName.toLowerCase());

    if (referencingFilaments.length > 0) {
        showReferencingFilamentsModal('type', typeName, referencingFilaments);
        return;
    }

    showCustomDeleteConfirmModal('type', typeName, async () => {
        try {
            await apiCall(`/custom-types/${encodeURIComponent(typeName)}`, {
                method: 'DELETE'
            });

            showToast('Custom type deleted successfully!', 'success');
            loadCustomManagementData();
            loadCustomBrandsAndColors(); // Refresh dropdowns
        } catch (error) {
            console.error('Failed to delete custom type:', error);
            showToast('Failed to delete custom type', 'error');
        }
    });
}

// Show edit brand modal
function editCustomBrand(brandName) {
    showEditModal('brand', brandName, '', '');
}

// Show edit type modal
function editCustomType(typeName) {
    showEditModal('type', typeName, '', '');
}

// Show edit color modal
function editCustomColorInPanel(colorName, hexCode) {
    showEditModal('color', colorName, hexCode, '');
}

// Generic edit modal function
function showEditModal(itemType, currentName, currentHex = '', currentExtra = '') {
    const modalHTML = `
        <div class="modal" id="editCustomModal">
            <div class="modal-overlay" onclick="closeEditModal()"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2>Edit Custom ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}</h2>
                    <button class="close-btn" onclick="closeEditModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="editCustomForm">
                        <div class="form-group">
                            <label for="editItemName">${itemType.charAt(0).toUpperCase() + itemType.slice(1)} Name:</label>
                            <input type="text" id="editItemName" value="${escapeHtml(currentName)}" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        </div>
                        ${itemType === 'color' ? `
                            <div class="form-group">
                                <label for="editItemHex">Color:</label>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <input type="color" id="editItemColorPicker" value="${currentHex}" style="width: 50px; height: 40px; border: none; border-radius: 4px; cursor: pointer;">
                                    <input type="text" id="editItemHex" value="${currentHex}" placeholder="#FF0000" maxlength="7" pattern="^#[0-9A-Fa-f]{6}$" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                                </div>
                            </div>
                        ` : ''}
                    </form>
                </div>
                <div class="form-actions" style="display: flex; gap: 10px; justify-content: flex-end; padding: 15px; border-top: 1px solid #eee;">
                    <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" onclick="saveEditedItem('${itemType}', '${escapeHtml(currentName)}')">
                        <i class="fas fa-save"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('editCustomModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add event listeners for color picker sync (if color type)
    if (itemType === 'color') {
        const colorPicker = document.getElementById('editItemColorPicker');
        const colorHex = document.getElementById('editItemHex');

        colorPicker.addEventListener('input', function () {
            colorHex.value = this.value.toUpperCase();
        });

        colorHex.addEventListener('input', function () {
            const hex = this.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                colorPicker.value = hex;
            }
        });
    }

    // Show modal
    document.getElementById('editCustomModal').classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus on name input
    document.getElementById('editItemName').focus();
    document.getElementById('editItemName').select();
}

// Close edit modal
function closeEditModal() {
    const modal = document.getElementById('editCustomModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 300);
    }
}

// Save edited item
async function saveEditedItem(itemType, originalName) {
    const newName = document.getElementById('editItemName').value.trim();

    if (!newName) {
        showToast(`Please enter a ${itemType} name`, 'error');
        return;
    }

    let requestBody = { newName };

    // Handle color-specific fields
    if (itemType === 'color') {
        const newHex = document.getElementById('editItemHex').value;
        if (!newHex || !/^#[0-9A-Fa-f]{6}$/.test(newHex)) {
            showToast('Please enter a valid hex color code (e.g., #FF0000)', 'error');
            return;
        }
        requestBody.newHexCode = newHex;

        // Check if no changes were made
        const originalHex = document.getElementById('editItemColorPicker').defaultValue;
        if (newName === originalName && newHex === originalHex) {
            closeEditModal();
            return;
        }
    } else {
        // Check if no changes were made for brand/type
        if (newName === originalName) {
            closeEditModal();
            return;
        }
    }

    try {
        const endpoint = itemType === 'brand' ? 'custom-brands' :
            itemType === 'type' ? 'custom-types' : 'custom-colors';

        const result = await apiCall(`/${endpoint}/${encodeURIComponent(originalName)}`, {
            method: 'PUT',
            body: JSON.stringify(requestBody)
        });

        showToast(`Custom ${itemType} updated successfully! ${result.filamentsUpdated} filaments updated.`, 'success');
        closeEditModal();

        // Refresh all data and UI components
        await loadCustomManagementData();
        await loadCustomBrandsAndColors(); // Refresh dropdowns and cache
        await loadFilaments(); // Refresh filament list to show updated data
    } catch (error) {
        console.error(`Failed to update custom ${itemType}:`, error);
        showToast(`Failed to update custom ${itemType}`, 'error');
    }
}

// Show referencing filaments modal
function showReferencingFilamentsModal(itemType, itemName, referencingFilaments) {
    const modalHTML = `
        <div class="modal" id="referencingFilamentsModal">
            <div class="modal-overlay" onclick="closeReferencingFilamentsModal()"></div>
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h2><i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i> Cannot Delete Custom ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}</h2>
                    <button class="close-btn" onclick="closeReferencingFilamentsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 15px; color: #dc3545; font-weight: 600;">
                        Cannot delete "${itemName}" because it is currently being used by ${referencingFilaments.length} filament${referencingFilaments.length > 1 ? 's' : ''}:
                    </p>
                    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 10px; background: #f8f9fa;">
                        ${referencingFilaments.map(filament => {
        const colorStyle = getColorStyleSync(filament.color);
        return `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid #eee; margin-bottom: 5px; border-radius: 4px; background: white;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <span class="color-indicator" style="${colorStyle}"></span>
                                        <div>
                                            <strong>${escapeHtml(filament.brand)} - ${escapeHtml(filament.type)}</strong><br>
                                            <small style="color: #666;">Color: ${escapeHtml(filament.color)} | Weight: ${formatWeight(filament.weight_remaining)}g</small>
                                        </div>
                                    </div>
                                    <button class="btn btn-secondary btn-small" onclick="editFilament(${filament.id}); closeReferencingFilamentsModal();" title="Edit this filament">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                </div>
                            `;
    }).join('')}
                    </div>
                    <p style="margin-top: 15px; color: #666; font-style: italic;">
                        To delete this custom ${itemType}, you must first remove or change the ${itemType} for all filaments listed above.
                    </p>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-primary" onclick="closeReferencingFilamentsModal()">
                        <i class="fas fa-check"></i> Understood
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('referencingFilamentsModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Show modal
    document.getElementById('referencingFilamentsModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close referencing filaments modal
function closeReferencingFilamentsModal() {
    const modal = document.getElementById('referencingFilamentsModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 300);
    }
}

// Global variable to store the delete callback
let pendingDeleteCallback = null;

// Show custom delete confirmation modal
function showCustomDeleteConfirmModal(itemType, itemName, onConfirm) {
    const modalHTML = `
        <div class="modal" id="customDeleteConfirmModal">
            <div class="modal-overlay" onclick="closeCustomDeleteConfirmModal()"></div>
            <div class="modal-content" style="max-width: 450px;">
                <div class="modal-header">
                    <h2><i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i> Confirm Deletion</h2>
                    <button class="close-btn" onclick="closeCustomDeleteConfirmModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; padding: 20px 0;">
                        <div style="font-size: 3rem; color: #dc3545; margin-bottom: 15px;">
                            <i class="fas fa-trash-alt"></i>
                        </div>
                        <h3 style="margin-bottom: 15px; color: #333;">Delete Custom ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}?</h3>
                        <p style="margin-bottom: 20px; color: #666; font-size: 1.1rem;">
                            Are you sure you want to permanently delete the custom ${itemType}:
                        </p>
                        <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <strong style="color: #333; font-size: 1.1rem;">"${escapeHtml(itemName)}"</strong>
                        </div>
                        <p style="color: #dc3545; font-weight: 600; margin-bottom: 0;">
                            <i class="fas fa-exclamation-circle"></i> This action cannot be undone!
                        </p>
                    </div>
                </div>
                <div class="form-actions" style="display: flex; gap: 10px; justify-content: center; padding: 20px; border-top: 1px solid #eee;">
                    <button type="button" class="btn btn-secondary" onclick="closeCustomDeleteConfirmModal()" style="min-width: 120px;">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                    <button type="button" class="btn btn-danger" onclick="confirmCustomDelete()" style="min-width: 120px;">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('customDeleteConfirmModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Store the confirmation callback in both places for reliability
    pendingDeleteCallback = onConfirm;
    window.customDeleteCallback = onConfirm;
    console.log('Stored delete callback:', typeof onConfirm, 'pendingDeleteCallback:', typeof pendingDeleteCallback); // Debug log

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Show modal
    document.getElementById('customDeleteConfirmModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close custom delete confirmation modal
function closeCustomDeleteConfirmModal() {
    const modal = document.getElementById('customDeleteConfirmModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 300);
    }
    // Clear the callback
    window.customDeleteCallback = null;
}

// Confirm custom delete
async function confirmCustomDelete() {
    console.log('confirmCustomDelete called, window callback type:', typeof window.customDeleteCallback, 'pending callback type:', typeof pendingDeleteCallback);

    // Try window callback first, then fallback to pendingDeleteCallback
    const callback = window.customDeleteCallback || pendingDeleteCallback;

    if (callback && typeof callback === 'function') {
        try {
            closeCustomDeleteConfirmModal();
            await callback();
        } catch (error) {
            console.error('Error during custom delete:', error);
            showToast('Failed to delete item', 'error');
        }
    } else {
        console.error('No valid delete callback found, window type:', typeof window.customDeleteCallback, 'pending type:', typeof pendingDeleteCallback);
        showToast('Delete operation failed - no callback', 'error');
    }
}

// Filter functionality
function toggleFiltersPanel() {
    const filtersPanel = document.getElementById('filtersPanel');
    const filterBtn = document.getElementById('filterBtn');

    if (filtersPanel.style.display === 'none' || !filtersPanel.style.display) {
        filtersPanel.style.display = 'block';
        if (filterBtn) filterBtn.classList.add('filter-active');
        populateFilterOptions();
    } else {
        filtersPanel.style.display = 'none';
        if (filterBtn) filterBtn.classList.remove('filter-active');
    }
}

function populateFilterOptions() {
    // Get unique values from current filaments
    const brands = [...new Set(filaments.map(f => f.brand))].sort();
    const types = [...new Set(filaments.map(f => f.type))].sort();
    const colors = [...new Set(filaments.map(f => f.color))].sort();

    // Populate brand filter
    const brandFilter = document.getElementById('filterBrand');
    brandFilter.innerHTML = '<option value="">All Brands</option>' +
        brands.map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join('');

    // Populate type filter
    const typeFilter = document.getElementById('filterType');
    typeFilter.innerHTML = '<option value="">All Types</option>' +
        types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');

    // Populate color filter
    const colorFilter = document.getElementById('filterColor');
    colorFilter.innerHTML = '<option value="">All Colors</option>' +
        colors.map(color => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`).join('');
}

function applyFilters() {
    // Get filter values
    const brandFilter = document.getElementById('filterBrand');
    const typeFilter = document.getElementById('filterType');
    const colorFilter = document.getElementById('filterColor');
    const spoolTypeFilter = document.getElementById('filterSpoolType');
    const stockStatusFilter = document.getElementById('filterStockStatus');
    const dateFromFilter = document.getElementById('filterDateFrom');
    const dateToFilter = document.getElementById('filterDateTo');
    const weightMinFilter = document.getElementById('filterWeightMin');
    const weightMaxFilter = document.getElementById('filterWeightMax');

    // Update current filters
    currentFilters.brands = Array.from(brandFilter.selectedOptions).map(option => option.value).filter(v => v);
    currentFilters.types = Array.from(typeFilter.selectedOptions).map(option => option.value).filter(v => v);
    currentFilters.colors = Array.from(colorFilter.selectedOptions).map(option => option.value).filter(v => v);
    currentFilters.spoolTypes = Array.from(spoolTypeFilter.selectedOptions).map(option => option.value).filter(v => v);
    currentFilters.stockStatus = stockStatusFilter ? stockStatusFilter.value : 'active';
    currentFilters.dateFrom = dateFromFilter.value || null;
    currentFilters.dateTo = dateToFilter.value || null;
    currentFilters.weightMin = weightMinFilter.value ? parseFloat(weightMinFilter.value) : null;
    currentFilters.weightMax = weightMaxFilter.value ? parseFloat(weightMaxFilter.value) : null;

    // Check if any filters are active
    isFiltersActive = currentFilters.brands.length > 0 ||
        currentFilters.types.length > 0 ||
        currentFilters.colors.length > 0 ||
        currentFilters.spoolTypes.length > 0 ||
        currentFilters.stockStatus !== 'active' ||
        currentFilters.dateFrom ||
        currentFilters.dateTo ||
        currentFilters.weightMin !== null ||
        currentFilters.weightMax !== null;

    // Update filter button appearance
    const filterBtn = document.getElementById('filterBtn');
    const mobileFilterBtn = document.getElementById('mobileFilterBtn');
    if (isFiltersActive) {
        if (filterBtn) filterBtn.classList.add('filters-indicator');
        if (mobileFilterBtn) mobileFilterBtn.classList.add('filters-indicator');
    } else {
        if (filterBtn) filterBtn.classList.remove('filters-indicator');
        if (mobileFilterBtn) mobileFilterBtn.classList.remove('filters-indicator');
    }

    // Apply filters and search
    applyFiltersAndSearch();

    // Auto-close filters panel after apply (mobile/desktop)
    const filtersPanel = document.getElementById('filtersPanel');
    if (filtersPanel) filtersPanel.style.display = 'none';
    if (filterBtn) filterBtn.classList.remove('filter-active');
    if (mobileFilterBtn) mobileFilterBtn.classList.remove('filter-active');

    showToast('Filters applied successfully!', 'success');
}

function clearFilters() {
    // Reset filter values
    document.getElementById('filterBrand').selectedIndex = 0;
    document.getElementById('filterType').selectedIndex = 0;
    document.getElementById('filterColor').selectedIndex = 0;
    document.getElementById('filterSpoolType').selectedIndex = 0;
    document.getElementById('filterStockStatus').value = 'active';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    document.getElementById('filterWeightMin').value = '';
    document.getElementById('filterWeightMax').value = '';

    // Reset current filters
    currentFilters = {
        brands: [],
        types: [],
        colors: [],
        spoolTypes: [],
        stockStatus: 'active',
        dateFrom: null,
        dateTo: null,
        weightMin: null,
        weightMax: null
    };

    isFiltersActive = false;

    // Update filter button appearance
    const filterBtn = document.getElementById('filterBtn');
    const mobileFilterBtn = document.getElementById('mobileFilterBtn');
    if (filterBtn) filterBtn.classList.remove('filters-indicator');
    if (mobileFilterBtn) mobileFilterBtn.classList.remove('filters-indicator');

    // Apply filters (which will show all filaments)
    applyFiltersAndSearch();

    showToast('Filters cleared!', 'success');
}

function applyFiltersAndSearch() {
    // If on history tab, filter history instead
    if (currentActiveTab === 'historyTab') {
        filterHistoryByFilters();
        return;
    }

    const searchQuery = searchInput.value.trim().toLowerCase();

    // Data source by stock status
    const stockStatus = currentFilters.stockStatus || 'active';
    let filteredFilaments;
    if (stockStatus === 'used') {
        filteredFilaments = [...usedFilaments];
    } else if (stockStatus === 'all') {
        filteredFilaments = [...filaments, ...usedFilaments];
    } else {
        filteredFilaments = [...filaments].filter(f => !f.is_archived);
    }

    // Apply search filter
    if (searchQuery) {
        filteredFilaments = filteredFilaments.filter(filament =>
            filament.brand.toLowerCase().includes(searchQuery) ||
            filament.type.toLowerCase().includes(searchQuery) ||
            filament.color.toLowerCase().includes(searchQuery) ||
            (filament.notes && filament.notes.toLowerCase().includes(searchQuery))
        );
    }

    // Apply advanced filters
    filteredFilaments = filteredFilaments.filter(filament => {
        if (currentFilters.brands.length > 0 && !currentFilters.brands.includes(filament.brand)) return false;
        if (currentFilters.types.length > 0 && !currentFilters.types.includes(filament.type)) return false;
        if (currentFilters.colors.length > 0 && !currentFilters.colors.includes(filament.color)) return false;
        if (currentFilters.spoolTypes.length > 0 && !currentFilters.spoolTypes.includes(filament.spool_type)) return false;

        if (currentFilters.dateFrom || currentFilters.dateTo) {
            const filamentDate = filament.purchase_date ? new Date(filament.purchase_date) : null;
            if (currentFilters.dateFrom) {
                const fromDate = new Date(currentFilters.dateFrom);
                if (!filamentDate || filamentDate < fromDate) return false;
            }
            if (currentFilters.dateTo) {
                const toDate = new Date(currentFilters.dateTo);
                if (!filamentDate || filamentDate > toDate) return false;
            }
        }

        if (currentFilters.weightMin !== null || currentFilters.weightMax !== null) {
            const weight = filament.weight_remaining || 0;
            if (currentFilters.weightMin !== null && weight < currentFilters.weightMin) return false;
            if (currentFilters.weightMax !== null && weight > currentFilters.weightMax) return false;
        }

        return true;
    });

    renderFilaments(filteredFilaments);
    updateStats(filteredFilaments.filter(f => !f.is_archived));
}

// Export functions for global access
window.showAddModal = showAddModal;
window.closeModal = closeModal;
window.showUseModal = showUseModal;
window.closeUseModal = closeUseModal;
window.editFilament = editFilament;
window.showDeleteModal = showDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.editCustomColor = editCustomColor;
window.editCustomBrand = editCustomBrand;
window.editCustomType = editCustomType;
window.editCustomColorInPanel = editCustomColorInPanel;
window.showEditModal = showEditModal;
window.closeEditModal = closeEditModal;
window.saveEditedItem = saveEditedItem;
window.showManageCustomsModal = showManageCustomsModal;
window.closeManageCustomsModal = closeManageCustomsModal;
window.addCustomBrand = addCustomBrand;
window.addCustomType = addCustomType;
window.addCustomColor = addCustomColor;
window.deleteCustomBrand = deleteCustomBrand;
window.deleteCustomType = deleteCustomType;
window.deleteCustomColor = deleteCustomColor;
window.showReferencingFilamentsModal = showReferencingFilamentsModal;
window.closeReferencingFilamentsModal = closeReferencingFilamentsModal;
window.showCustomDeleteConfirmModal = showCustomDeleteConfirmModal;
window.closeCustomDeleteConfirmModal = closeCustomDeleteConfirmModal;
window.confirmCustomDelete = confirmCustomDelete;
window.toggleFiltersPanel = toggleFiltersPanel;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;

let currentActiveTab = 'inventoryTab';

function updateControlsForTab(tabName) {
    currentActiveTab = tabName;
    const isHistoryTab = tabName === 'historyTab';
    const isInventoryTab = tabName === 'inventoryTab';
    const topbarAddBtn = document.getElementById('addFilamentBtn');
    const filterBtn = document.getElementById('filterBtn');
    const mobileAddBtn = document.getElementById('mobileAddBtn');
    const mobileFilterBtn = document.getElementById('mobileFilterBtn');

    // Show Add button only on inventory tab
    if (topbarAddBtn) topbarAddBtn.hidden = !isInventoryTab;
    if (mobileAddBtn) mobileAddBtn.style.display = isInventoryTab ? '' : 'none';

    // Update search placeholder based on tab
    if (searchInput) {
        searchInput.placeholder = isHistoryTab ? 'Search history...' : 'Search filaments...';
        searchInput.value = '';
    }

    // Close filters panel when switching tabs
    const filtersPanel = document.getElementById('filtersPanel');
    if (filtersPanel) filtersPanel.style.display = 'none';
}

function openTab(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";

    updateControlsForTab(tabName);

    if (tabName === 'historyTab') {
        loadDeductionHistory();
    }
}

// ==================== Admin Panel Functions ====================

// Show admin modal
async function showAdminModal() {
    const adminModal = document.getElementById('adminModal');
    if (!adminModal) return;

    adminModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    await loadUsers();
}

// Close admin modal
function closeAdminModal() {
    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
        adminModal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Load all users
async function loadUsers() {
    const usersTableBody = document.getElementById('usersTableBody');
    const usersLoading = document.getElementById('usersLoading');

    if (!usersTableBody) return;

    // Show loading
    usersTableBody.innerHTML = '';
    if (usersLoading) usersLoading.style.display = 'block';

    try {
        const users = await apiCall('/admin/users');

        if (usersLoading) usersLoading.style.display = 'none';

        if (users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No users found</td></tr>';
            return;
        }

        usersTableBody.innerHTML = users.map(user => {
            const isCurrentUser = currentUser && currentUser.id === user.id;
            const createdDate = new Date(user.created_at).toLocaleDateString();

            return `
                <tr class="${isCurrentUser ? 'current-user' : ''}">
                    <td>${user.id}</td>
                    <td>
                        <div class="user-name-cell">
                            <i class="fas fa-user-circle"></i>
                            <span>${escapeHtml(user.username)}</span>
                            ${isCurrentUser ? '<span class="you-badge">You</span>' : ''}
                        </div>
                    </td>
                    <td>
                        <span class="table-role-badge ${user.role}">${user.role}</span>
                    </td>
                    <td>${createdDate}</td>
                    <td>
                        <div class="table-actions">
                            ${!isCurrentUser ? `
                                <button class="btn btn-secondary btn-small" onclick="toggleUserRole(${user.id}, '${user.role}', '${escapeHtml(user.username)}')" title="Toggle Role">
                                    <i class="fas fa-user-shield"></i>
                                </button>
                            ` : ''}
                            <button class="btn btn-secondary btn-small" onclick="showChangePasswordModal(${user.id}, '${escapeHtml(user.username)}')" title="Change Password">
                                <i class="fas fa-key"></i>
                            </button>
                            ${!isCurrentUser ? `
                                <button class="btn btn-danger btn-small" onclick="showDeleteUserModal(${user.id}, '${escapeHtml(user.username)}')" title="Delete User">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        if (usersLoading) usersLoading.style.display = 'none';
        usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #dc3545; padding: 20px;">Error loading users</td></tr>';
        console.error('Failed to load users:', error);
    }
}

// Toggle user role
async function toggleUserRole(userId, currentRole, username) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';

    if (!confirm(`Change ${username}'s role from "${currentRole}" to "${newRole}"?`)) {
        return;
    }

    try {
        await apiCall(`/admin/users/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        });

        showToast(`${username}'s role changed to ${newRole}`, 'success');
        await loadUsers();
    } catch (error) {
        console.error('Failed to change role:', error);
    }
}

// Show change password modal
function showChangePasswordModal(userId, username) {
    const modal = document.getElementById('changePasswordModal');
    const usernameDisplay = document.getElementById('changePasswordUsername');
    const userIdInput = document.getElementById('changePasswordUserId');
    const form = document.getElementById('changePasswordForm');

    if (!modal) return;

    // Reset form
    form.reset();

    // Set values
    usernameDisplay.textContent = username;
    userIdInput.value = userId;

    // Show modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus on password field
    setTimeout(() => {
        document.getElementById('newPassword').focus();
    }, 100);
}

// Close change password modal
function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Handle change password form submit
document.addEventListener('DOMContentLoaded', () => {
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const userId = document.getElementById('changePasswordUserId').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmNewPassword').value;

            if (newPassword !== confirmPassword) {
                showToast('Passwords do not match', 'error');
                return;
            }

            if (newPassword.length < 6) {
                showToast('Password must be at least 6 characters', 'error');
                return;
            }

            try {
                await apiCall(`/admin/users/${userId}/password`, {
                    method: 'PUT',
                    body: JSON.stringify({ newPassword })
                });

                showToast('Password changed successfully', 'success');
                closeChangePasswordModal();
            } catch (error) {
                console.error('Failed to change password:', error);
            }
        });
    }

    // Delete user confirmation button
    const confirmDeleteUserBtn = document.getElementById('confirmDeleteUserBtn');
    if (confirmDeleteUserBtn) {
        confirmDeleteUserBtn.addEventListener('click', confirmDeleteUser);
    }
});

// Show delete user modal
function showDeleteUserModal(userId, username) {
    const modal = document.getElementById('deleteUserModal');
    const usernameDisplay = document.getElementById('deleteUserUsername');
    const userIdInput = document.getElementById('deleteUserId');

    if (!modal) return;

    usernameDisplay.textContent = username;
    userIdInput.value = userId;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close delete user modal
function closeDeleteUserModal() {
    const modal = document.getElementById('deleteUserModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Confirm delete user
async function confirmDeleteUser() {
    const userId = document.getElementById('deleteUserId').value;

    if (!userId) return;

    try {
        await apiCall(`/admin/users/${userId}`, {
            method: 'DELETE'
        });

        showToast('User deleted successfully', 'success');
        closeDeleteUserModal();
        await loadUsers();
    } catch (error) {
        console.error('Failed to delete user:', error);
    }
}

// Export admin functions for global access
window.showAdminModal = showAdminModal;
window.closeAdminModal = closeAdminModal;
window.toggleUserRole = toggleUserRole;
window.showChangePasswordModal = showChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.showDeleteUserModal = showDeleteUserModal;
window.closeDeleteUserModal = closeDeleteUserModal;
window.confirmDeleteUser = confirmDeleteUser;
window.openTab = openTab;

// ==================== PWA & Mobile Enhancements ====================

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered:', registration.scope);
            })
            .catch((err) => {
                console.warn('SW registration failed:', err);
            });
    });
}

// --- PWA Install Prompt ---
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Only show if not dismissed recently
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
        const dismissedTime = parseInt(dismissed, 10);
        // Don't show again for 7 days
        if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) return;
    }
    showInstallBanner();
});

function showInstallBanner() {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) {
        banner.style.display = 'flex';
        requestAnimationFrame(() => banner.classList.add('show'));
    }
}

function hideInstallBanner() {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) {
        banner.classList.remove('show');
        setTimeout(() => { banner.style.display = 'none'; }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('pwaInstallBtn');
    const dismissBtn = document.getElementById('pwaInstallDismiss');

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hideInstallBanner();
        });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            localStorage.setItem('pwa-install-dismissed', Date.now().toString());
            hideInstallBanner();
        });
    }
});

window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    deferredPrompt = null;
});

// --- URL action handler (for PWA shortcuts) ---
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
        // Wait for app to load then show add modal
        setTimeout(() => { if (typeof showAddModal === 'function') showAddModal(); }, 500);
    }
});

// --- Tab switching helper (no event needed) ---
function switchTab(tabName) {
    const tabContents = document.getElementsByClassName('tab-content');
    for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].style.display = 'none';
    }
    const tabLinks = document.getElementsByClassName('tab-link');
    for (let i = 0; i < tabLinks.length; i++) {
        tabLinks[i].classList.remove('active');
    }
    const targetTab = document.getElementById(tabName);
    if (targetTab) targetTab.style.display = 'block';

    updateControlsForTab(tabName);

    // Highlight matching tab link
    for (let i = 0; i < tabLinks.length; i++) {
        if (tabLinks[i].getAttribute('onclick') &&
            tabLinks[i].getAttribute('onclick').includes(tabName)) {
            tabLinks[i].classList.add('active');
        }
    }
}

// --- Mobile Bottom Navigation ---
function initMobileNav() {
    const bottomNav = document.getElementById('mobileBottomNav');
    if (!bottomNav) return;

    const navItems = bottomNav.querySelectorAll('.bottom-nav-item');
    const fab = document.getElementById('mobileFab');
    const settingsPanel = document.getElementById('mobileSettingsPanel');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Hide settings panel
            if (settingsPanel) settingsPanel.style.display = 'none';

            switch (tab) {
                case 'dashboard':
                    showMobileSection('dashboard');
                    break;
                case 'inventory':
                    showMobileSection('inventory', 'Inventory');
                    switchTab('inventoryTab');
                    break;
                case 'add':
                    showAddModal();
                    break;
                case 'history':
                    showMobileSection('inventory', 'History');
                    switchTab('historyTab');
                    loadDeductionHistory();
                    break;
                case 'settings':
                    showMobileSection('settings');
                    break;
            }
        });
    });

    // FAB
    if (fab) {
        fab.addEventListener('click', () => {
            showAddModal();
        });
    }

    // Settings panel buttons
    const settingsAdmin = document.getElementById('settingsAdmin');
    if (settingsAdmin) {
        settingsAdmin.addEventListener('click', () => {
            showAdminModal();
        });
    }

    const settingsLogout = document.getElementById('settingsLogout');
    if (settingsLogout) {
        settingsLogout.addEventListener('click', logout);
    }

    // On mobile, show dashboard view on initial load
    if (window.innerWidth <= 768) {
        showMobileSection('dashboard');
    }
}

function showMobileSection(section, title) {
    const settingsPanel = document.getElementById('mobileSettingsPanel');
    const dashboardView = document.getElementById('mobileDashboardView');
    const container = document.querySelector('.container');
    const contentWrapper = document.querySelector('.content-wrapper');
    const topbarTitle = document.getElementById('topbarTitle');
    const topbarActions = document.querySelector('.topbar-actions');

    // Hide both overlay panels first
    if (settingsPanel) settingsPanel.style.display = 'none';
    if (dashboardView) dashboardView.style.display = 'none';

    if (section === 'settings') {
        // Hide main container content, show settings
        if (container) container.style.display = 'none';
        if (contentWrapper) contentWrapper.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'block';
        if (topbarTitle) topbarTitle.textContent = 'Settings';
        if (topbarActions) topbarActions.style.display = 'none';
        // Update settings info
        if (currentUser) {
            const nameEl = document.getElementById('settingsUsername');
            const roleEl = document.getElementById('settingsRole');
            if (nameEl) nameEl.textContent = currentUser.username;
            if (roleEl) {
                roleEl.textContent = currentUser.role;
                roleEl.className = 'settings-role-badge ' + currentUser.role;
            }
            // Show admin button if admin
            const adminBtn = document.getElementById('settingsAdmin');
            if (adminBtn) {
                adminBtn.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
            }
        }
    } else if (section === 'dashboard') {
        // Hide main container content, show dashboard
        if (container) container.style.display = 'none';
        if (contentWrapper) contentWrapper.style.display = 'none';
        if (dashboardView) dashboardView.style.display = 'block';
        if (topbarTitle) topbarTitle.textContent = 'Dashboard';
        if (topbarActions) topbarActions.style.display = 'none';
        renderMobileDashboard();
    } else {
        // Show main container for inventory/history
        if (container) container.style.display = 'block';
        if (contentWrapper) contentWrapper.style.display = 'block';
        if (topbarTitle) topbarTitle.textContent = title || 'Inventory';
        if (topbarActions) topbarActions.style.display = 'flex';
        // Hide add button when showing History on mobile
        const isHistory = title === 'History';
        const mobileAddBtn = document.getElementById('mobileAddBtn');
        if (mobileAddBtn) mobileAddBtn.style.display = isHistory ? 'none' : '';
        const topbarAddBtn = document.getElementById('addFilamentBtn');
        if (topbarAddBtn) topbarAddBtn.style.display = isHistory ? 'none' : '';
    }
}

async function renderMobileDashboard() {
    const activeFilaments = filaments.filter(f => !f.is_archived);

    // Summary stats
    const totalSpools = activeFilaments.length;
    const totalWeight = activeFilaments.reduce((sum, f) => sum + (f.weight_remaining || 0), 0);
    const brandsCount = new Set(activeFilaments.map(f => f.brand.toLowerCase())).size;

    const dashSpools = document.getElementById('dashTotalSpools');
    const dashWeight = document.getElementById('dashTotalWeight');
    const dashBrands = document.getElementById('dashBrandsCount');
    if (dashSpools) dashSpools.textContent = totalSpools;
    if (dashWeight) dashWeight.textContent = `${formatWeight(totalWeight)}g`;
    if (dashBrands) dashBrands.textContent = brandsCount;

    // Low stock alerts (under 100g) — active inventory only
    const lowStockEl = document.getElementById('dashLowStock');
    if (lowStockEl) {
        const lowStock = activeFilaments
            .filter(f => (f.weight_remaining || 0) < 100)
            .sort((a, b) => (a.weight_remaining || 0) - (b.weight_remaining || 0));

        if (lowStock.length === 0) {
            lowStockEl.innerHTML = '<div class="mobile-dash-empty">All Spools below 100g</div>';
        } else {
            lowStockEl.innerHTML = lowStock.map(f => {
                const colorHex = f.color_hex || getColorHexSync(f.color);
                return `<div class="mobile-dash-item">
                    <span class="mobile-dash-item-dot" style="background-color: ${colorHex};"></span>
                    <div class="mobile-dash-item-info">
                        <span class="mobile-dash-item-title">${escapeHtml(f.brand)} ${escapeHtml(f.type)}</span>
                        <span class="mobile-dash-item-subtitle">${escapeHtml(f.color || 'Unknown')}</span>
                    </div>
                    <span class="mobile-dash-item-value">${formatWeight(f.weight_remaining)}g</span>
                </div>`;
            }).join('');
        }
    }

    // Recent deductions (last 5)
    const recentEl = document.getElementById('dashRecentDeductions');
    if (recentEl) {
        try {
            const response = await fetch('/api/deduction-history?limit=5&offset=0');
            if (!response.ok) throw new Error('Failed');
            const data = await response.json();

            if (data.history.length === 0) {
                recentEl.innerHTML = '<div class="mobile-dash-empty">No deductions yet</div>';
            } else {
                recentEl.innerHTML = data.history.map(entry => {
                    const date = new Date(entry.created_at + 'Z');
                    const dateStr = date.toLocaleDateString();
                    const colorHex = entry.color_hex || getColorHexSync(entry.color || 'Unknown');
                    const filamentName = entry.brand && entry.type
                        ? `${escapeHtml(entry.brand)} ${escapeHtml(entry.type)}`
                        : 'Deleted filament';
                    return `<div class="mobile-dash-item">
                        <span class="mobile-dash-item-dot" style="background-color: ${colorHex};"></span>
                        <div class="mobile-dash-item-info">
                            <span class="mobile-dash-item-title">${filamentName}</span>
                            <span class="mobile-dash-item-subtitle">${dateStr}${entry.print_name ? ' &middot; ' + escapeHtml(entry.print_name) : ''}</span>
                        </div>
                        <span class="mobile-dash-item-value">-${formatWeight(entry.grams_used)}g</span>
                    </div>`;
                }).join('');
            }
        } catch (e) {
            recentEl.innerHTML = '<div class="mobile-dash-empty"><i class="fas fa-exclamation-circle"></i> Could not load history</div>';
        }
    }
}

// --- Pull to Refresh ---
function initPullToRefresh() {
    let startY = 0;
    let pulling = false;
    const pullIndicator = document.getElementById('pullToRefresh');
    const threshold = 80;

    document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && !document.querySelector('.modal.active')) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling || !pullIndicator) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0 && window.scrollY === 0) {
            const pullDistance = Math.min(diff, threshold * 1.5);
            pullIndicator.style.transform = `translateY(${pullDistance - 60}px)`;
            pullIndicator.style.opacity = Math.min(diff / threshold, 1);

            if (diff > threshold) {
                pullIndicator.classList.add('ready');
            } else {
                pullIndicator.classList.remove('ready');
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (!pulling || !pullIndicator) return;
        pulling = false;

        if (pullIndicator.classList.contains('ready')) {
            pullIndicator.classList.add('refreshing');
            pullIndicator.style.transform = 'translateY(10px)';

            // Refresh data
            Promise.all([loadFilaments(), loadUsedFilaments()])
                .finally(() => {
                    setTimeout(() => {
                        pullIndicator.classList.remove('ready', 'refreshing');
                        pullIndicator.style.transform = '';
                        pullIndicator.style.opacity = '0';
                        showToast('Refreshed!', 'success');
                    }, 600);
                });
        } else {
            pullIndicator.style.transform = '';
            pullIndicator.style.opacity = '0';
            pullIndicator.classList.remove('ready');
        }
    }, { passive: true });
}

// --- Swipe to dismiss modals ---
function initSwipeToDismiss() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        let startY = 0;
        let currentTranslate = 0;
        const content = modal.querySelector('.modal-content');
        if (!content) return;

        content.addEventListener('touchstart', (e) => {
            // Only initiate swipe from the modal header area
            const header = content.querySelector('.modal-header');
            if (!header) return;
            const headerRect = header.getBoundingClientRect();
            const touch = e.touches[0];
            if (touch.clientY < headerRect.top || touch.clientY > headerRect.bottom) return;

            startY = touch.clientY;
            content.style.transition = 'none';
        }, { passive: true });

        content.addEventListener('touchmove', (e) => {
            if (startY === 0) return;
            const diff = e.touches[0].clientY - startY;
            if (diff > 0) {
                currentTranslate = diff;
                content.style.transform = `translateY(${diff}px)`;
                content.style.opacity = Math.max(1 - diff / 300, 0.5);
            }
        }, { passive: true });

        content.addEventListener('touchend', () => {
            if (startY === 0) return;
            content.style.transition = 'transform 0.3s ease, opacity 0.3s ease';

            if (currentTranslate > 150) {
                // Dismiss
                content.style.transform = 'translateY(100vh)';
                content.style.opacity = '0';
                setTimeout(() => {
                    // Find and call the appropriate close function
                    modal.classList.remove('active');
                    document.body.style.overflow = '';
                    content.style.transform = '';
                    content.style.opacity = '';
                }, 300);
            } else {
                content.style.transform = '';
                content.style.opacity = '';
            }
            startY = 0;
            currentTranslate = 0;
        }, { passive: true });
    });
}

// ==================== Deduction History ====================

let historyData = [];
let historyOffset = 0;
let historyTotal = 0;
const HISTORY_PAGE_SIZE = 25;
let historyFilterFilamentId = '';

async function loadDeductionHistory(reset = true) {
    if (reset) {
        historyOffset = 0;
        historyData = [];
    }

    const timeline = document.getElementById('historyTimeline');
    const loadingEl = document.getElementById('historyLoading');
    const emptyEl = document.getElementById('historyEmpty');
    const paginationEl = document.getElementById('historyPagination');

    if (reset) {
        timeline.innerHTML = '';
        loadingEl.style.display = 'block';
        emptyEl.style.display = 'none';
        paginationEl.style.display = 'none';
    }

    try {
        let url = `/api/deduction-history?limit=${HISTORY_PAGE_SIZE}&offset=${historyOffset}`;
        if (historyFilterFilamentId) {
            url += `&filament_id=${historyFilterFilamentId}&filamentId=${historyFilterFilamentId}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch history');

        const data = await response.json();
        const incomingHistory = historyFilterFilamentId
            ? (data.history || []).filter(entry => String(entry.filament_id) === String(historyFilterFilamentId))
            : (data.history || []);

        historyTotal = data.total;
        historyData = historyData.concat(incomingHistory);
        historyOffset += incomingHistory.length;

        loadingEl.style.display = 'none';

        if (historyData.length === 0) {
            emptyEl.style.display = 'block';
            paginationEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        renderHistory(incomingHistory, !reset);
        paginationEl.style.display = historyOffset < historyTotal ? 'flex' : 'none';
    } catch (error) {
        console.error('Error loading deduction history:', error);
        loadingEl.style.display = 'none';
        if (historyData.length === 0) {
            emptyEl.style.display = 'block';
        }
    }
}

function renderHistory(entries, append = false) {
    const timeline = document.getElementById('historyTimeline');
    const html = entries.map(entry => createHistoryEntry(entry)).join('');
    if (append) {
        timeline.insertAdjacentHTML('beforeend', html);
    } else {
        timeline.innerHTML = html;
    }
}

function createHistoryEntry(entry) {
    const date = new Date(entry.created_at + 'Z');
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const colorHex = entry.color_hex || getColorHexSync(entry.color || 'Unknown');
    const isLightColor = colorHex && (colorHex.toLowerCase() === '#ffffff' || colorHex === 'rgba(255,255,255,0.3)');

    const sourceBadgeClass = entry.source === 'manual' ? 'manual' : (entry.source === 'api_key' ? 'api_key' : 'other');
    const sourceLabel = entry.source === 'manual' ? 'Manual' : (entry.source === 'api_key' ? 'Auto' : (entry.source || 'Other'));

    const filamentName = entry.brand && entry.type
        ? `${escapeHtml(entry.brand)} ${escapeHtml(entry.type)}`
        : 'Deleted filament';

    let matchedByDisplay = '';
    if (entry.matched_by) {
        const matchedByNormalized = String(entry.matched_by).toLowerCase().replace(/[_\s]+/g, ' ').trim();
        if (matchedByNormalized.includes('color hex') && entry.color) {
            matchedByDisplay = escapeHtml(entry.color);
        } else {
            matchedByDisplay = escapeHtml(entry.matched_by);
        }
    }

    return `
        <div class="history-entry">
            <div class="history-entry-header">
                <div class="history-filament-info">
                    <span class="history-color-dot" style="background-color: ${colorHex};${isLightColor ? ' border-color: #C6C6C8;' : ''}"></span>
                    <span class="history-filament-name">${filamentName}</span>
                </div>
                <span class="history-source-badge ${sourceBadgeClass}">${sourceLabel}</span>
            </div>
            <div class="history-entry-body">
                <span class="history-weight-change">-${formatWeight(entry.grams_used)}g</span>
                <span class="history-weight-detail">${formatWeight(entry.weight_before)}g &rarr; ${formatWeight(entry.weight_after)}g</span>
            </div>
            ${entry.print_name ? `<div class="history-print-name"><i class="fas fa-cube"></i> ${escapeHtml(entry.print_name)}</div>` : ''}
            <div class="history-entry-footer">
                <i class="far fa-clock"></i> ${dateStr} ${timeStr}${matchedByDisplay ? ` &middot; ${matchedByDisplay}` : ''}
            </div>
        </div>
    `;
}

function populateHistoryFilter() {
    const select = document.getElementById('historyFilamentFilter');
    if (!select) return;

    const currentValue = select.value;
    // Keep the "All Filaments" option and add filament options
    select.innerHTML = '<option value="">All Filaments</option>';

    const allFilaments = [...filaments, ...usedFilaments];
    const seen = new Set();
    allFilaments.forEach(f => {
        if (!seen.has(f.id)) {
            seen.add(f.id);
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = `${f.brand} ${f.type} - ${f.color}`;
            select.appendChild(opt);
        }
    });

    select.value = currentValue;
}

// Per-spool history modal
async function showSpoolHistory(filamentId) {
    const modal = document.getElementById('spoolHistoryModal');
    const timeline = document.getElementById('spoolHistoryTimeline');
    const loadingEl = document.getElementById('spoolHistoryLoading');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    timeline.innerHTML = '';
    loadingEl.style.display = 'block';

    try {
        const response = await fetch(`/api/deduction-history?filament_id=${filamentId}&limit=100`);
        if (!response.ok) throw new Error('Failed to fetch spool history');

        const data = await response.json();
        loadingEl.style.display = 'none';

        if (data.history.length === 0) {
            timeline.innerHTML = '<p class="history-empty-inline">No deduction history for this spool.</p>';
            return;
        }

        timeline.innerHTML = data.history.map(entry => createHistoryEntry(entry)).join('');
    } catch (error) {
        console.error('Error loading spool history:', error);
        loadingEl.style.display = 'none';
        timeline.innerHTML = '<p class="history-empty-inline">Error loading history.</p>';
    }
}

function closeSpoolHistoryModal() {
    const modal = document.getElementById('spoolHistoryModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// --- Theme Toggle ---
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI();
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', newTheme === 'dark' ? '#000000' : '#F2F2F7');
    }
}

function updateThemeUI() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('.theme-toggle-icon').forEach(function(icon) {
        icon.className = 'fas ' + (isDark ? 'fa-sun' : 'fa-moon') + ' theme-toggle-icon';
    });
    document.querySelectorAll('.theme-toggle-label').forEach(function(label) {
        label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    });
}

function initThemeToggle() {
    updateThemeUI();
    // Update meta theme-color on initial load
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && isDark) {
        metaTheme.setAttribute('content', '#000000');
    }
    const sidebarBtn = document.getElementById('themeToggleBtn');
    if (sidebarBtn) sidebarBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        toggleTheme();
    });
    const settingsBtn = document.getElementById('settingsThemeToggle');
    if (settingsBtn) settingsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        toggleTheme();
    });
    // Listen for system theme changes when no saved preference
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
            if (!localStorage.getItem('theme')) {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                updateThemeUI();
            }
        });
    }
}

// --- Version Footer ---
function initVersionFooter() {
    document.querySelectorAll('.app-version-footer').forEach(function(el) {
        el.textContent = 'v' + APP_VERSION + ' \u00B7 ' + APP_COMMIT;
    });
}

// --- Initialize all mobile features ---
document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initPullToRefresh();
    initSidebarNav();
    initThemeToggle();
    initVersionFooter();

    // Delay swipe init until modals exist
    setTimeout(initSwipeToDismiss, 1000);

    // History filter change handler
    const historyFilter = document.getElementById('historyFilamentFilter');
    if (historyFilter) {
        historyFilter.addEventListener('change', (e) => {
            historyFilterFilamentId = e.target.value;
            loadDeductionHistory(true);
        });
    }

    // History load more button
    const loadMoreBtn = document.getElementById('historyLoadMore');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            loadDeductionHistory(false);
        });
    }
});

// --- Sidebar Navigation ---
function initSidebarNav() {
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const topbarTitle = document.getElementById('topbarTitle');

    // Sidebar toggle (mobile)
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
        });
    }

    // Close sidebar on overlay click
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Sidebar nav items
    const sidebarItems = document.querySelectorAll('.sidebar-item[data-section]');
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;

            // Update active state
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                if (sidebarOverlay) sidebarOverlay.classList.remove('active');
            }

            // Switch section via desktop tab mechanism
            const tabMap = {
                'inventory': 'inventoryTab',
                'history': 'historyTab'
            };

            const tabName = tabMap[section];
            if (tabName) {
                // Hide all tab contents
                const tabContents = document.getElementsByClassName('tab-content');
                for (let i = 0; i < tabContents.length; i++) {
                    tabContents[i].style.display = 'none';
                }
                // Show selected tab
                const targetTab = document.getElementById(tabName);
                if (targetTab) targetTab.style.display = 'block';

                // Update tab-link active states (desktop segmented control)
                const tabLinks = document.getElementsByClassName('tab-link');
                for (let i = 0; i < tabLinks.length; i++) {
                    tabLinks[i].classList.remove('active');
                    if (tabLinks[i].getAttribute('onclick') && tabLinks[i].getAttribute('onclick').includes(tabName)) {
                        tabLinks[i].classList.add('active');
                    }
                }

                // Update controls (show/hide add/filter buttons) for active tab
                updateControlsForTab(tabName);

                // Load history if needed
                if (section === 'history') {
                    loadDeductionHistory();
                }

                // Update topbar title
                const titles = { 'inventory': 'Inventory', 'history': 'History' };
                if (topbarTitle) topbarTitle.textContent = titles[section] || 'Inventory';
            }
        });
    });
}

// Sync sidebar active state when desktop tabs are clicked
// Monkey-patch openTab by redefining it to also update sidebar
(function() {
    const origOpenTab = openTab;
    window.openTab = function(evt, tabName) {
        origOpenTab(evt, tabName);
        const sectionMap = { 'inventoryTab': 'inventory', 'historyTab': 'history' };
        const section = sectionMap[tabName];
        if (section) {
            document.querySelectorAll('.sidebar-item[data-section]').forEach(item => {
                item.classList.toggle('active', item.dataset.section === section);
            });
            const topbarTitle = document.getElementById('topbarTitle');
            const titles = { 'inventory': 'Inventory', 'history': 'History' };
            if (topbarTitle) topbarTitle.textContent = titles[section] || 'Inventory';
        }
    };
})();
