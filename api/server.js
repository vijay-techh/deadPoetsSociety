// ===== IMPORTS =====
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

// ===== ENV + DIR SETUP =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Load .env correctly
dotenv.config({ path: path.join(__dirname, ".env") });
console.log("DB URL from env:", process.env.DATABASE_URL);

// ===== INIT APP =====
const app = express();

// ===== DATABASE =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== MIDDLEWARE =====
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../public"))); // ⬅ adjust if your public folder is different

// ==== JWT HELPERS, ROUTES, ETC BELOW THIS ====

// ===== JWT HELPERS =====
function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function sendAuthCookie(res, token) {
  res.cookie("poetAuth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",   // ✅ THIS FIXES MOBILE
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}


// ===== JWT MIDDLEWARE =====
function requireAuth(req, res, next) {
  try {
    const token = req.cookies.poetAuth;
    if (!token) return res.status(401).json({ success: false, message: "Login required" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admins only" });
    }
    next();
  });
}

// ===== ROUTES =====



// SIGNUP (normal users only)
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const userExists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (userExists.rows.length > 0)
      return res.status(400).json({ success: false, message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const insert = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, name, email, role`,
      [name, email, hashed]
    );

    const user = insert.rows[0];
    res.json({ success: true, message: "Signup successful", user });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    console.log("⏳ Login attempt:", { email, password });
    console.log("📥 DB returned user:", user);

    if (!user) {
      console.log("❌ No user found with that email");
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    console.log("🔐 Stored hash:", user.password);

    const match = await bcrypt.compare(password, user.password);
    console.log("🧪 Password match?", match);

    if (!match) {
      console.log("❌ Password mismatch");
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    // If password correct, continue with token, response, etc.
    const token = createToken(user);
    sendAuthCookie(res, token);

    res.json({ success: true, message: "Login successful", user: { name: user.name, role: user.role } });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/poems/create", requireAuth, async (req, res) => {
  try {
    const { title, content, tags, anonymous } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required" });
    }

    const insert = await pool.query(
      `INSERT INTO poems (user_id, title, content, tags, anonymous)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, title, content, tags || null, anonymous || false]
    );

    res.json({ success: true, poem: insert.rows[0] });
  } catch (err) {
    console.error("Poem creation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
app.get("/api/poems", async (req, res) => {
  try {
    const { search, sort } = req.query;

    let query = `
      SELECT poems.*, 
      CASE WHEN poems.anonymous THEN 'Anonymous' ELSE users.name END AS author
      FROM poems
      JOIN users ON poems.user_id = users.id
    `;

    // Search
    if (search) {
      query += ` WHERE (poems.title ILIKE '%${search}%' OR poems.content ILIKE '%${search}%' OR poems.tags ILIKE '%${search}%') `;
    }

    // Sorting
    query += sort === "oldest"
      ? " ORDER BY poems.id ASC"
      : " ORDER BY poems.id DESC";

    const result = await pool.query(query);
    res.json({ success: true, poems: result.rows });
  } catch (err) {
    console.error("Fetch poems error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// GET ALL POEMS (PUBLIC FEED)
app.get("/api/poems", async (req, res) => {
  try {
    const poems = await pool.query(
      `SELECT poems.*, users.name AS author 
       FROM poems 
       JOIN users ON poems.user_id = users.id
       ORDER BY poems.id DESC`
    );
    res.json({ success: true, poems: poems.rows });
  } catch (err) {
    console.error("Poem fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// ADD FAVORITE
app.post("/api/favorites/:poemId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO favorites (user_id, poem_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.poemId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success:false });
  }
});

// REMOVE FAVORITE
app.delete("/api/favorites/:poemId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM favorites WHERE user_id=$1 AND poem_id=$2`,
      [req.user.id, req.params.poemId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success:false });
  }
});

// DELETE POEM
app.delete("/api/poems/:id", requireAuth, async (req, res) => {
  try {
    const poemId = req.params.id;

    // Find poem owner
    const result = await pool.query(`SELECT user_id FROM poems WHERE id=$1`, [poemId]);
    const poem = result.rows[0];

    if (!poem) {
      return res.status(404).json({ success: false, message: "Poem not found" });
    }

    // Check permissions
    if (req.user.role !== "admin" && req.user.id !== poem.user_id) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    // Delete poem
    await pool.query(`DELETE FROM poems WHERE id=$1`, [poemId]);
    res.json({ success: true, message: "Poem deleted successfully" });

  } catch (err) {
    console.error("Delete poem error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// GET LOGGED USER INFO (protected)
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ADMIN TEST ROUTE
app.get("/api/admin", requireAdmin, (req, res) => {
  res.json({ success: true, message: "Welcome Captain!", user: req.user });
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  res.clearCookie("poetAuth");
  res.json({ success: true, message: "Logged out" });
});

app.get("*", (req, res) => {
  const filePath = path.join(__dirname, "../public", req.path);

  res.sendFile(filePath, err => {
    if (err) {
      res.sendFile(path.join(__dirname, "../public", "index.html"));
    }
  });
});



// START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
