import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.join(process.cwd(), ".env.local");

console.log("[db:introspect] cwd =", process.cwd());
console.log("[db:introspect] envPath =", envPath);
console.log("[db:introspect] env exists =", fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8");
  const lines = envText.split("\n");
  const first5Lines = lines.slice(0, 5);
  const maskedLines = first5Lines.map((line) =>
    line.replace(/postgresql:\/\/([^:]+):([^@]+)@/g, "postgresql://$1:***@")
  );
  console.log("[db:introspect] env preview:\n" + maskedLines.join("\n"));
}

dotenv.config({ path: envPath });

console.log("[db:introspect] DATABASE_URL =", process.env.DATABASE_URL ? "FOUND" : "MISSING");

import pg from "pg";

const { Client } = pg;

async function introspectDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not found in .env.local");
    console.error("Please add your Supabase connection string to .env.local");
    process.exit(1);
  }

  // Parse connection URL for diagnostics
  const url = new URL(databaseUrl);
  console.log("[db:introspect] Connection info:");
  console.log("  host:", url.hostname);
  console.log("  port:", url.port || "5432");
  console.log("  user:", url.username);
  console.log("  database:", url.pathname.slice(1)); // Remove leading '/'
  console.log("");

  // Force SSL connection - remove sslmode from URL if present, we'll handle it via config
  const cleanUrl = databaseUrl.split("?")[0];
  
  const client = new Client({
    connectionString: cleanUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log("✓ Connected to database\n");

    // Query A: current_user, current_database
    console.log("Query A: SELECT current_user, current_database();");
    const queryA = await client.query("SELECT current_user, current_database()");
    console.log("Result:", queryA.rows[0]);
    console.log("");

    // Query B: count of tables in public schema
    console.log("Query B: SELECT count(*) as tables FROM information_schema.tables WHERE table_schema='public';");
    const queryB = await client.query(
      "SELECT count(*) as tables FROM information_schema.tables WHERE table_schema='public'"
    );
    console.log("Result:", queryB.rows[0]);
    console.log("");

    // Query C: table names in public schema (limit 50)
    console.log("Query C: SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 50;");
    const queryC = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 50"
    );
    console.log(`Result (${queryC.rows.length} tables):`);
    queryC.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });
    console.log("");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

introspectDatabase();

