require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Add it to .env for local development or Render Environment settings.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" || isProduction
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function cleanText(value, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function initializeDatabase() {
  // These tables are created automatically on startup. This is convenient for a
  // starter app; use versioned migrations before using the app for real operations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donors (
      id BIGSERIAL PRIMARY KEY,
      legal_name VARCHAR(255) NOT NULL,
      contact_email VARCHAR(320) NOT NULL UNIQUE,
      contact_phone VARCHAR(40),
      city VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recipients (
      id BIGSERIAL PRIMARY KEY,
      legal_name VARCHAR(255) NOT NULL,
      contact_email VARCHAR(320),
      city VARCHAR(100),
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS donations (
      id BIGSERIAL PRIMARY KEY,
      donor_id BIGINT NOT NULL REFERENCES donors(id) ON DELETE RESTRICT,
      recipient_id BIGINT REFERENCES recipients(id) ON DELETE SET NULL,
      food_description TEXT NOT NULL,
      category VARCHAR(20) NOT NULL CHECK (category IN ('PERISHABLE', 'SHELF_STABLE')),
      weight_lbs NUMERIC(10,2) NOT NULL CHECK (weight_lbs > 0),
      item_count INTEGER CHECK (item_count IS NULL OR item_count > 0),
      estimated_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
      pickup_notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'MATCHED', 'DELIVERED', 'CANCELLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (_error) {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const [donations, donors, recipients, weight] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM donations"),
      pool.query("SELECT COUNT(*)::int AS total FROM donors"),
      pool.query("SELECT COUNT(*)::int AS total FROM recipients"),
      pool.query("SELECT COALESCE(SUM(weight_lbs), 0)::numeric(12,2) AS total FROM donations WHERE status <> 'CANCELLED'")
    ]);
    res.json({
      donations: donations.rows[0].total,
      donors: donors.rows[0].total,
      recipients: recipients.rows[0].total,
      pounds: Number(weight.rows[0].total)
    });
  } catch (error) {
    console.error("Dashboard query failed:", error.message);
    res.status(500).json({ error: "Could not load dashboard data." });
  }
});

app.get("/api/donors", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, legal_name, contact_email, contact_phone, city, created_at FROM donors ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Donors query failed:", error.message);
    res.status(500).json({ error: "Could not load donors." });
  }
});

app.post("/api/donors", async (req, res) => {
  const legalName = cleanText(req.body.legal_name);
  const email = cleanText(req.body.contact_email, 320).toLowerCase();
  const phone = cleanText(req.body.contact_phone, 40);
  const city = cleanText(req.body.city, 100);

  if (legalName.length < 2 || !validEmail(email)) {
    return res.status(400).json({ error: "Enter a business name and a valid contact email." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO donors (legal_name, contact_email, contact_phone, city)
       VALUES ($1, $2, $3, $4)
       RETURNING id, legal_name, contact_email, contact_phone, city, created_at`,
      [legalName, email, phone || null, city || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "A donor with that email already exists." });
    }
    console.error("Create donor failed:", error.message);
    res.status(500).json({ error: "Could not save donor." });
  }
});

app.get("/api/recipients", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, legal_name, contact_email, city, is_verified, created_at FROM recipients ORDER BY legal_name ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Recipients query failed:", error.message);
    res.status(500).json({ error: "Could not load recipients." });
  }
});

app.post("/api/recipients", async (req, res) => {
  const legalName = cleanText(req.body.legal_name);
  const email = cleanText(req.body.contact_email, 320).toLowerCase();
  const city = cleanText(req.body.city, 100);
  const verified = req.body.is_verified === true;

  if (legalName.length < 2) {
    return res.status(400).json({ error: "Enter a recipient organization name." });
  }
  if (email && !validEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email or leave the email blank." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO recipients (legal_name, contact_email, city, is_verified)
       VALUES ($1, $2, $3, $4)
       RETURNING id, legal_name, contact_email, city, is_verified, created_at`,
      [legalName, email || null, city || null, verified]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create recipient failed:", error.message);
    res.status(500).json({ error: "Could not save recipient." });
  }
});

app.get("/api/donations", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.food_description, d.category, d.weight_lbs,
             d.item_count, d.estimated_value, d.pickup_notes, d.status, d.created_at,
             donor.legal_name AS donor_name,
             recipient.legal_name AS recipient_name
      FROM donations d
      JOIN donors donor ON donor.id = d.donor_id
      LEFT JOIN recipients recipient ON recipient.id = d.recipient_id
      ORDER BY d.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Donations query failed:", error.message);
    res.status(500).json({ error: "Could not load donations." });
  }
});

app.post("/api/donations", async (req, res) => {
  const donorId = Number(req.body.donor_id);
  const recipientId = req.body.recipient_id ? Number(req.body.recipient_id) : null;
  const description = cleanText(req.body.food_description, 2000);
  const category = req.body.category;
  const weight = Number(req.body.weight_lbs);
  const itemCount = req.body.item_count === "" || req.body.item_count == null
    ? null : Number(req.body.item_count);
  const estimatedValue = Number(req.body.estimated_value || 0);
  const pickupNotes = cleanText(req.body.pickup_notes, 2000);

  if (!Number.isInteger(donorId) || donorId <= 0) {
    return res.status(400).json({ error: "Choose a registered donor." });
  }
  if (description.length < 3) {
    return res.status(400).json({ error: "Describe the food (at least 3 characters)." });
  }
  if (!["PERISHABLE", "SHELF_STABLE"].includes(category)) {
    return res.status(400).json({ error: "Choose a valid food category." });
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 999999) {
    return res.status(400).json({ error: "Weight must be greater than 0 and below 1,000,000 lbs." });
  }
  if (itemCount !== null && (!Number.isInteger(itemCount) || itemCount <= 0)) {
    return res.status(400).json({ error: "Item count must be a positive whole number." });
  }
  if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
    return res.status(400).json({ error: "Estimated value cannot be negative." });
  }
  if (recipientId !== null && (!Number.isInteger(recipientId) || recipientId <= 0)) {
    return res.status(400).json({ error: "Choose a valid recipient." });
  }

  try {
    const donor = await pool.query("SELECT id FROM donors WHERE id = $1", [donorId]);
    if (donor.rowCount === 0) {
      return res.status(400).json({ error: "That donor does not exist. Add the donor first." });
    }
    if (recipientId !== null) {
      const recipient = await pool.query("SELECT id FROM recipients WHERE id = $1", [recipientId]);
      if (recipient.rowCount === 0) {
        return res.status(400).json({ error: "That recipient does not exist." });
      }
    }

    const result = await pool.query(
      `INSERT INTO donations
        (donor_id, recipient_id, food_description, category, weight_lbs, item_count, estimated_value, pickup_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, food_description, category, weight_lbs, item_count, estimated_value, status, created_at`,
      [donorId, recipientId, description, category, weight, itemCount, estimatedValue, pickupNotes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create donation failed:", error.message);
    res.status(500).json({ error: "Could not save donation." });
  }
});

app.patch("/api/donations/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid donation ID." });
  if (!["PENDING", "MATCHED", "DELIVERED", "CANCELLED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  try {
    const result = await pool.query(
      "UPDATE donations SET status = $1 WHERE id = $2 RETURNING id, status",
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Donation not found." });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update donation status failed:", error.message);
    res.status(500).json({ error: "Could not update donation status." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

async function start() {
  try {
    if (!process.env.DATABASE_URL) {
      console.error("Missing DATABASE_URL. Create a .env file or set DATABASE_URL in your hosting provider.");
      process.exit(1);
    }
    await initializeDatabase();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Samrosa is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Could not start Samrosa:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

start();
