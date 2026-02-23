const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'filament-tracker-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';
const JWT_REMEMBER_EXPIRES_IN = '30d';
const API_KEY = process.env.API_KEY;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./data/filament_inventory.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS filaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT NOT NULL,
      spool_type TEXT NOT NULL CHECK(spool_type IN ('refill', 'with_spool')),
      weight_remaining REAL DEFAULT 1000,
      purchase_date TEXT,
      notes TEXT,
      is_archived BOOLEAN DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;

  const createUsersQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createCustomBrandsQuery = `
    CREATE TABLE IF NOT EXISTS custom_brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(name, user_id)
    )
  `;

  const createCustomColorsQuery = `
    CREATE TABLE IF NOT EXISTS custom_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hex_code TEXT NOT NULL,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(name, user_id)
    )
  `;

  const createCustomTypesQuery = `
    CREATE TABLE IF NOT EXISTS custom_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(name, user_id)
    )
  `;

  // Helper function to add user_id column if it doesn't exist
  const addUserIdColumn = (tableName, callback) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
      if (err) {
        console.error(`Error getting ${tableName} table info:`, err.message);
        if (callback) callback();
        return;
      }

      const userIdExists = columns.some(col => col.name === 'user_id');
      if (!userIdExists) {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN user_id INTEGER`, (err) => {
          if (err) {
            console.error(`Error adding user_id column to ${tableName}:`, err.message);
          } else {
            console.log(`user_id column added to ${tableName} table`);
          }
          if (callback) callback();
        });
      } else {
        if (callback) callback();
      }
    });
  };

  db.run(createTableQuery, (err) => {
    if (err) {
      console.error('Error creating filaments table:', err.message);
    } else {
      // Add the is_archived column if it doesn't exist
      db.all("PRAGMA table_info(filaments)", (err, columns) => {
        if (err) {
          console.error("Error getting table info:", err.message);
          return;
        }

        const isArchivedExists = columns.some(col => col.name === 'is_archived');
        if (!isArchivedExists) {
          db.run('ALTER TABLE filaments ADD COLUMN is_archived BOOLEAN DEFAULT 0', (err) => {
            if (err) {
              console.error('Error adding is_archived column:', err.message);
            } else {
              console.log('is_archived column added to filaments table');
            }
          });
        }

        // Add color_hex column if it doesn't exist
        const colorHexExists = columns.some(col => col.name === 'color_hex');
        if (!colorHexExists) {
          db.run('ALTER TABLE filaments ADD COLUMN color_hex TEXT', (err) => {
            if (err) {
              console.error('Error adding color_hex column:', err.message);
            } else {
              console.log('color_hex column added to filaments table');
              // Auto-populate color_hex from custom_colors table
              db.run(`UPDATE filaments SET color_hex = (
                SELECT hex_code FROM custom_colors
                WHERE custom_colors.name = filaments.color
                AND custom_colors.user_id = filaments.user_id
              ) WHERE color_hex IS NULL`, (err) => {
                if (err) {
                  console.error('Error auto-populating color_hex:', err.message);
                } else {
                  console.log('color_hex auto-populated from custom_colors');
                }
              });
            }
          });
        }

        // Add user_id column if it doesn't exist
        addUserIdColumn('filaments');
      });
      console.log('Filaments table ready');
    }
  });

  db.run(createCustomBrandsQuery, (err) => {
    if (err) {
      console.error('Error creating custom_brands table:', err.message);
    } else {
      addUserIdColumn('custom_brands');
      console.log('Custom brands table ready');
    }
  });

  db.run(createCustomColorsQuery, (err) => {
    if (err) {
      console.error('Error creating custom_colors table:', err.message);
    } else {
      addUserIdColumn('custom_colors');
      console.log('Custom colors table ready');
    }
  });

  db.run(createCustomTypesQuery, (err) => {
    if (err) {
      console.error('Error creating custom_types table:', err.message);
    } else {
      addUserIdColumn('custom_types');
      console.log('Custom types table ready');
    }
  });

  db.run(createUsersQuery, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('Users table ready');
      // Check if any users exist for setup status logging
      db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) {
          console.error('Error checking users:', err.message);
          return;
        }
        if (row.count === 0) {
          console.log('No users found - initial setup required');
        } else {
          console.log(`${row.count} user(s) found in database`);
        }
      });
    }
  });
}

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.clearCookie('auth_token');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Optional auth - adds user info if logged in but doesn't require it
const optionalAuth = (req, res, next) => {
  const token = req.cookies.auth_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Token is invalid, clear it
      res.clearCookie('auth_token');
    }
  }
  next();
};

// API Key Authentication Middleware (for machine-to-machine calls)
const authenticateApiKey = (req, res, next) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey) {
    return res.status(401).json({ error: 'API key required (X-API-Key header)' });
  }

  if (providedKey !== API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
};

// ==================== Auth Routes ====================

// Check if initial setup is required (no users exist)
app.get('/api/auth/setup-required', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ setupRequired: row.count === 0 });
  });
});

// Initial setup - create admin account and migrate existing data
app.post('/api/auth/setup', async (req, res) => {
  const { password, confirmPassword } = req.body;

  // Validation
  if (!password || !confirmPassword) {
    return res.status(400).json({ error: 'Password and confirmation are required' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if setup is still needed (no users exist)
    db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (row.count > 0) {
        return res.status(400).json({ error: 'Initial setup has already been completed' });
      }

      // Hash password and create admin user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', hashedPassword, 'admin'],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Error creating admin account' });
          }

          const adminUserId = this.lastID;
          console.log(`Admin account created through initial setup (ID: ${adminUserId})`);

          // Migrate existing data from pre-authentication version
          // All records with NULL user_id will be assigned to the admin
          const migrationTables = ['filaments', 'custom_brands', 'custom_colors', 'custom_types'];
          let migratedCounts = {};
          let completedMigrations = 0;

          migrationTables.forEach(table => {
            db.run(
              `UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`,
              [adminUserId],
              function (err) {
                if (err) {
                  console.error(`Error migrating ${table}:`, err.message);
                  migratedCounts[table] = 0;
                } else {
                  migratedCounts[table] = this.changes;
                  if (this.changes > 0) {
                    console.log(`Migrated ${this.changes} existing ${table} to admin user`);
                  }
                }

                completedMigrations++;

                // When all migrations are done, send response
                if (completedMigrations === migrationTables.length) {
                  const totalMigrated = Object.values(migratedCounts).reduce((a, b) => a + b, 0);

                  let message = 'Admin account created successfully';
                  if (totalMigrated > 0) {
                    message += `. Migrated ${totalMigrated} existing items to admin inventory.`;
                    console.log(`Total items migrated to admin: ${totalMigrated}`);
                  }

                  res.status(201).json({
                    message,
                    username: 'admin',
                    migrated: migratedCounts
                  });
                }
              }
            );
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if user already exists
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, existingUser) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (existingUser) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert new user
      db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, hashedPassword, 'user'],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Error creating user' });
          }

          res.status(201).json({
            message: 'User created successfully',
            userId: this.lastID
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password, rememberMe } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      // Create JWT token
      const tokenPayload = {
        userId: user.id,
        username: user.username,
        role: user.role
      };

      const expiresIn = rememberMe ? JWT_REMEMBER_EXPIRES_IN : JWT_EXPIRES_IN;
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn });

      // Set cookie
      const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge
      });

      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Logged out successfully' });
});

// Check authentication status
app.get('/api/auth/check', authenticateToken, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// Get current user profile
app.get('/api/auth/profile', authenticateToken, (req, res) => {
  db.get('SELECT id, username, role, created_at FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  });
});

// ==================== Admin Routes ====================

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC', [], (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(users);
  });
});

// Delete a user (admin only)
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const targetUserId = parseInt(id);

  // Prevent admin from deleting themselves
  if (targetUserId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  // Check if user exists
  db.get('SELECT id, username FROM users WHERE id = ?', [targetUserId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (cascades to delete their data due to foreign keys)
    db.run('DELETE FROM users WHERE id = ?', [targetUserId], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting user' });
      }
      res.json({ message: `User "${user.username}" deleted successfully` });
    });
  });
});

// Change user password (admin only)
app.put('/api/admin/users/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  const targetUserId = parseInt(id);

  if (!newPassword) {
    return res.status(400).json({ error: 'New password is required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if user exists
    db.get('SELECT id, username FROM users WHERE id = ?', [targetUserId], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      // Update password
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, targetUserId], function (err) {
        if (err) {
          return res.status(500).json({ error: 'Error updating password' });
        }
        res.json({ message: `Password for "${user.username}" updated successfully` });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change user role (admin only)
app.put('/api/admin/users/:id/role', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const targetUserId = parseInt(id);

  if (!role || !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Valid role (user or admin) is required' });
  }

  // Prevent admin from changing their own role
  if (targetUserId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  db.get('SELECT id, username FROM users WHERE id = ?', [targetUserId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.run('UPDATE users SET role = ? WHERE id = ?', [role, targetUserId], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating role' });
      }
      res.json({ message: `Role for "${user.username}" updated to ${role}` });
    });
  });
});

// ==================== Protected API Routes ====================
// Apply authentication middleware to all filament routes

// Get all filaments (user's own filaments only)
app.get('/api/filaments', authenticateToken, (req, res) => {
  const query = `
    SELECT * FROM filaments WHERE is_archived = 0 AND user_id = ?
    ORDER BY created_at DESC
  `;

  db.all(query, [req.user.userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get used filaments (user's own only)
app.get('/api/filaments/used', authenticateToken, (req, res) => {
  const query = `
      SELECT * FROM filaments WHERE is_archived = 1 AND user_id = ?
      ORDER BY updated_at DESC
    `;

  db.all(query, [req.user.userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Search filaments (user's own only)
app.get('/api/filaments/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  const query = `
    SELECT * FROM filaments 
    WHERE user_id = ? AND (brand LIKE ? OR type LIKE ? OR color LIKE ? OR notes LIKE ?)
    ORDER BY created_at DESC
  `;

  const searchTerm = `%${q}%`;

  db.all(query, [req.user.userId, searchTerm, searchTerm, searchTerm, searchTerm], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single filament (user's own only)
app.get('/api/filaments/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM filaments WHERE id = ? AND user_id = ?', [id, req.user.userId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Filament not found' });
      return;
    }
    res.json(row);
  });
});

// Add new filament (associated with current user)
app.post('/api/filaments', authenticateToken, (req, res) => {
  const { brand, type, color, spool_type, weight_remaining, purchase_date, notes, color_hex } = req.body;

  if (!brand || !type || !color || !spool_type) {
    return res.status(400).json({ error: 'Brand, type, color, and spool_type are required' });
  }

  const insertFilament = (hexValue) => {
    const query = `
      INSERT INTO filaments (brand, type, color, spool_type, weight_remaining, purchase_date, notes, user_id, color_hex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [brand, type, color, spool_type, weight_remaining || 1000, purchase_date, notes, req.user.userId, hexValue], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, message: 'Filament added successfully' });
    });
  };

  if (color_hex) {
    insertFilament(color_hex);
  } else {
    // Auto-fill color_hex from custom_colors if color name matches
    db.get('SELECT hex_code FROM custom_colors WHERE name = ? AND user_id = ?', [color, req.user.userId], (err, row) => {
      if (err) {
        console.error('Error looking up custom color:', err.message);
      }
      insertFilament(row ? row.hex_code : null);
    });
  }
});

// Update filament (user's own only)
app.put('/api/filaments/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { brand, type, color, spool_type, weight_remaining, purchase_date, notes, color_hex } = req.body;

  const updateFilament = (hexValue) => {
    const query = `
      UPDATE filaments
      SET brand = ?, type = ?, color = ?, spool_type = ?, weight_remaining = ?,
          purchase_date = ?, notes = ?, color_hex = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `;

    db.run(query, [brand, type, color, spool_type, weight_remaining, purchase_date, notes, hexValue, id, req.user.userId], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Filament not found' });
        return;
      }
      res.json({ message: 'Filament updated successfully' });
    });
  };

  if (color_hex) {
    updateFilament(color_hex);
  } else {
    // Auto-fill color_hex from custom_colors if color name matches
    db.get('SELECT hex_code FROM custom_colors WHERE name = ? AND user_id = ?', [color, req.user.userId], (err, row) => {
      if (err) {
        console.error('Error looking up custom color:', err.message);
      }
      updateFilament(row ? row.hex_code : null);
    });
  }
});

// Use filament (user's own only)
app.post('/api/filaments/:id/use', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { usageType, amount } = req.body;

  db.get('SELECT weight_remaining FROM filaments WHERE id = ? AND user_id = ?', [id, req.user.userId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Filament not found' });
    }

    let newWeight;
    if (usageType === 'used') {
      newWeight = row.weight_remaining - amount;
    } else {
      newWeight = amount;
    }

    if (newWeight < 0) {
      newWeight = 0;
    }

    const isArchived = newWeight === 0;

    const query = `
            UPDATE filaments 
            SET weight_remaining = ?, is_archived = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `;

    db.run(query, [newWeight, isArchived, id, req.user.userId], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Filament usage updated successfully' });
    });
  });
});

// Delete filament (user's own only)
app.delete('/api/filaments/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM filaments WHERE id = ? AND user_id = ?', [id, req.user.userId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Filament not found' });
      return;
    }
    res.json({ message: 'Filament deleted successfully' });
  });
});

// Custom brands endpoints (user-specific)
app.get('/api/custom-brands', authenticateToken, (req, res) => {
  db.all('SELECT * FROM custom_brands WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/custom-brands', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Brand name is required' });
  }

  db.run('INSERT INTO custom_brands (name, user_id) VALUES (?, ?)', [name, req.user.userId], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Brand already exists' });
      } else {
        res.status(500).json({ error: err.message });
      }
      return;
    }
    res.json({ id: this.lastID, name, message: 'Custom brand added successfully' });
  });
});

// Custom colors endpoints (user-specific)
app.get('/api/custom-colors', authenticateToken, (req, res) => {
  db.all('SELECT * FROM custom_colors WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/custom-colors', authenticateToken, (req, res) => {
  const { name, hex_code } = req.body;
  if (!name || !hex_code) {
    return res.status(400).json({ error: 'Color name and hex code are required' });
  }

  db.run('INSERT INTO custom_colors (name, hex_code, user_id) VALUES (?, ?, ?)', [name, hex_code, req.user.userId], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Color already exists' });
      } else {
        res.status(500).json({ error: err.message });
      }
      return;
    }
    res.json({ id: this.lastID, name, hex_code, message: 'Custom color added successfully' });
  });
});

// Update custom brand (user-specific)
app.put('/api/custom-brands/:name', authenticateToken, (req, res) => {
  const { name } = req.params;
  const { newName } = req.body;

  if (!newName) {
    return res.status(400).json({ error: 'New brand name is required' });
  }

  const oldName = decodeURIComponent(name);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Update custom brand
    db.run('UPDATE custom_brands SET name = ? WHERE name = ? AND user_id = ?', [newName, oldName, req.user.userId], function (err) {
      if (err) {
        db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        db.run('ROLLBACK');
        res.status(404).json({ error: 'Custom brand not found' });
        return;
      }

      // Update all filaments using this brand (for current user only)
      db.run('UPDATE filaments SET brand = ?, updated_at = CURRENT_TIMESTAMP WHERE brand = ? AND user_id = ?', [newName, oldName, req.user.userId], function (err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }

        db.run('COMMIT', (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            message: 'Custom brand updated successfully',
            filamentsUpdated: this.changes
          });
        });
      });
    });
  });
});

// Delete custom brand (user-specific)
app.delete('/api/custom-brands/:name', authenticateToken, (req, res) => {
  const { name } = req.params;

  db.run('DELETE FROM custom_brands WHERE name = ? AND user_id = ?', [decodeURIComponent(name), req.user.userId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Custom brand not found' });
      return;
    }
    res.json({ message: 'Custom brand deleted successfully' });
  });
});

// Update custom color (user-specific)
app.put('/api/custom-colors/:name', authenticateToken, (req, res) => {
  const { name } = req.params;
  const { newName, newHexCode } = req.body;

  if (!newName || !newHexCode) {
    return res.status(400).json({ error: 'New color name and hex code are required' });
  }

  const oldName = decodeURIComponent(name);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Update custom color
    db.run('UPDATE custom_colors SET name = ?, hex_code = ? WHERE name = ? AND user_id = ?', [newName, newHexCode, oldName, req.user.userId], function (err) {
      if (err) {
        db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        db.run('ROLLBACK');
        res.status(404).json({ error: 'Custom color not found' });
        return;
      }

      // Update all filaments using this color (for current user only)
      db.run('UPDATE filaments SET color = ?, updated_at = CURRENT_TIMESTAMP WHERE color = ? AND user_id = ?', [newName, oldName, req.user.userId], function (err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }

        db.run('COMMIT', (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            message: 'Custom color updated successfully',
            filamentsUpdated: this.changes
          });
        });
      });
    });
  });
});

// Delete custom color (user-specific)
app.delete('/api/custom-colors/:name', authenticateToken, (req, res) => {
  const { name } = req.params;

  db.run('DELETE FROM custom_colors WHERE name = ? AND user_id = ?', [decodeURIComponent(name), req.user.userId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Custom color not found' });
      return;
    }
    res.json({ message: 'Custom color deleted successfully' });
  });
});

// Custom types endpoints (user-specific)
app.get('/api/custom-types', authenticateToken, (req, res) => {
  db.all('SELECT * FROM custom_types WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/custom-types', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Type name is required' });
  }

  db.run('INSERT INTO custom_types (name, user_id) VALUES (?, ?)', [name, req.user.userId], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Type already exists' });
      } else {
        res.status(500).json({ error: err.message });
      }
      return;
    }
    res.json({ id: this.lastID, name, message: 'Custom type added successfully' });
  });
});

// Update custom type (user-specific)
app.put('/api/custom-types/:name', authenticateToken, (req, res) => {
  const { name } = req.params;
  const { newName } = req.body;

  if (!newName) {
    return res.status(400).json({ error: 'New type name is required' });
  }

  const oldName = decodeURIComponent(name);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Update custom type
    db.run('UPDATE custom_types SET name = ? WHERE name = ? AND user_id = ?', [newName, oldName, req.user.userId], function (err) {
      if (err) {
        db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        db.run('ROLLBACK');
        res.status(404).json({ error: 'Custom type not found' });
        return;
      }

      // Update all filaments using this type (for current user only)
      db.run('UPDATE filaments SET type = ?, updated_at = CURRENT_TIMESTAMP WHERE type = ? AND user_id = ?', [newName, oldName, req.user.userId], function (err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }

        db.run('COMMIT', (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            message: 'Custom type updated successfully',
            filamentsUpdated: this.changes
          });
        });
      });
    });
  });
});

// Delete custom type (user-specific)
app.delete('/api/custom-types/:name', authenticateToken, (req, res) => {
  const { name } = req.params;

  db.run('DELETE FROM custom_types WHERE name = ? AND user_id = ?', [decodeURIComponent(name), req.user.userId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Custom type not found' });
      return;
    }
    res.json({ message: 'Custom type deleted successfully' });
  });
});

// Serve the login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the main page (protected)
app.get('/', (req, res) => {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.redirect('/login');
  }

  try {
    jwt.verify(token, JWT_SECRET);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    res.clearCookie('auth_token');
    return res.redirect('/login');
  }
});

// ==================== API Key Protected Routes (Machine-to-Machine) ====================

// Convert Bambu RGBA hex (e.g. "000000FF") or plain hex to normalized "#rrggbb" format
function normalizeHexColor(color) {
  const cleaned = color.replace(/^#/, '');
  if (/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    // RGBA format — strip alpha suffix
    return '#' + cleaned.substring(0, 6).toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return '#' + cleaned.toLowerCase();
  }
  return null; // Not a hex code
}

// Deduct filament by brand + type + color (multi-strategy matching)
app.post('/api/filaments/deduct', authenticateApiKey, (req, res) => {
  const { brand, type, color, grams_used } = req.body;

  if (!brand || !type || !color || !grams_used) {
    return res.status(400).json({ error: 'brand, type, color, and grams_used are required' });
  }

  if (typeof grams_used !== 'number' || grams_used <= 0) {
    return res.status(400).json({ error: 'grams_used must be a positive number' });
  }

  const colorHex = normalizeHexColor(color);

  // Strategy 1: Exact match on brand + type + color name
  const exactQuery = `
    SELECT * FROM filaments
    WHERE LOWER(brand) = LOWER(?) AND LOWER(type) = LOWER(?) AND LOWER(color) = LOWER(?)
      AND is_archived = 0
    ORDER BY weight_remaining DESC
    LIMIT 1
  `;

  // Strategy 2: brand + type + color_hex
  const hexQuery = `
    SELECT * FROM filaments
    WHERE LOWER(brand) = LOWER(?) AND LOWER(type) = LOWER(?) AND LOWER(color_hex) = LOWER(?)
      AND is_archived = 0
    ORDER BY weight_remaining DESC
    LIMIT 1
  `;

  // Strategy 3: Fuzzy brand — just type + color name
  const fuzzyColorQuery = `
    SELECT * FROM filaments
    WHERE LOWER(type) = LOWER(?) AND LOWER(color) = LOWER(?)
      AND is_archived = 0
    ORDER BY weight_remaining DESC
    LIMIT 1
  `;

  // Strategy 4: Fuzzy brand — just type + color_hex
  const fuzzyHexQuery = `
    SELECT * FROM filaments
    WHERE LOWER(type) = LOWER(?) AND LOWER(color_hex) = LOWER(?)
      AND is_archived = 0
    ORDER BY weight_remaining DESC
    LIMIT 1
  `;

  const deductFromFilament = (filament, matchedBy) => {
    let newWeight = filament.weight_remaining - grams_used;
    if (newWeight < 0) newWeight = 0;
    const isArchived = newWeight === 0 ? 1 : 0;

    const updateQuery = `
      UPDATE filaments
      SET weight_remaining = ?, is_archived = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    db.run(updateQuery, [newWeight, isArchived, filament.id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      console.log(`[API-KEY] Deducted ${grams_used}g from filament #${filament.id} (${filament.brand} ${filament.type} ${filament.color}) [matched_by: ${matchedBy}]: ${filament.weight_remaining}g -> ${newWeight}g${isArchived ? ' [ARCHIVED]' : ''}`);

      res.json({
        message: `Deducted ${grams_used}g from ${filament.type} ${filament.color}`,
        filament: {
          id: filament.id,
          brand: filament.brand,
          type: filament.type,
          color: filament.color,
          weight_remaining: newWeight
        },
        matched_by: matchedBy
      });
    });
  };

  // Try strategies in order
  db.get(exactQuery, [brand, type, color], (err, filament) => {
    if (err) return res.status(500).json({ error: err.message });
    if (filament) return deductFromFilament(filament, 'color_name');

    // Strategy 2: hex match (only if color looks like a hex code)
    if (!colorHex) {
      // Color is not a hex code, skip to fuzzy brand match on color name
      return db.get(fuzzyColorQuery, [type, color], (err, filament) => {
        if (err) return res.status(500).json({ error: err.message });
        if (filament) return deductFromFilament(filament, 'fuzzy_brand_color_name');

        return res.status(404).json({
          error: 'No matching filament found',
          searched: { brand, type, color }
        });
      });
    }

    db.get(hexQuery, [brand, type, colorHex], (err, filament) => {
      if (err) return res.status(500).json({ error: err.message });
      if (filament) return deductFromFilament(filament, 'color_hex');

      // Strategy 3: fuzzy brand + color name
      db.get(fuzzyColorQuery, [type, color], (err, filament) => {
        if (err) return res.status(500).json({ error: err.message });
        if (filament) return deductFromFilament(filament, 'fuzzy_brand_color_name');

        // Strategy 4: fuzzy brand + color_hex
        db.get(fuzzyHexQuery, [type, colorHex], (err, filament) => {
          if (err) return res.status(500).json({ error: err.message });
          if (filament) return deductFromFilament(filament, 'fuzzy_brand_color_hex');

          return res.status(404).json({
            error: 'No matching filament found',
            searched: { brand, type, color, color_hex: colorHex }
          });
        });
      });
    });
  });
});

// Deduct filament by ID
app.post('/api/filaments/deduct-by-id', authenticateApiKey, (req, res) => {
  const { filament_id, grams_used } = req.body;

  if (!filament_id || !grams_used) {
    return res.status(400).json({ error: 'filament_id and grams_used are required' });
  }

  if (typeof grams_used !== 'number' || grams_used <= 0) {
    return res.status(400).json({ error: 'grams_used must be a positive number' });
  }

  db.get('SELECT * FROM filaments WHERE id = ? AND is_archived = 0', [filament_id], (err, filament) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!filament) {
      return res.status(404).json({ error: 'Filament not found or already archived' });
    }

    let newWeight = filament.weight_remaining - grams_used;
    if (newWeight < 0) newWeight = 0;
    const isArchived = newWeight === 0 ? 1 : 0;

    const updateQuery = `
      UPDATE filaments
      SET weight_remaining = ?, is_archived = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    db.run(updateQuery, [newWeight, isArchived, filament.id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      console.log(`[API-KEY] Deducted ${grams_used}g from filament #${filament.id} by ID: ${filament.weight_remaining}g -> ${newWeight}g${isArchived ? ' [ARCHIVED]' : ''}`);

      res.json({
        message: 'Filament deducted successfully',
        filament: {
          id: filament.id,
          brand: filament.brand,
          type: filament.type,
          color: filament.color,
          previous_weight: filament.weight_remaining,
          grams_deducted: grams_used,
          weight_remaining: newWeight,
          archived: !!isArchived
        }
      });
    });
  });
});

// Health check endpoint for K8s
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Filament Tracker server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
