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

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    console.log("✓ Connected to database\n");

    // Get current database and schema
    const dbResult = await client.query(
      "SELECT current_database(), current_schema()"
    );
    console.log("Current database:", dbResult.rows[0].current_database);
    console.log("Current schema:", dbResult.rows[0].current_schema);
    console.log("");

    // List all tables in public schema
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log(`Tables in public schema (${tablesResult.rows.length}):`);
    console.log("=".repeat(50));

    // Get row count for each table
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      try {
        const countResult = await client.query(
          `SELECT count(*) FROM "${tableName}"`
        );
        const count = countResult.rows[0].count;
        console.log(`  ${tableName}: ${count} rows`);
      } catch (err) {
        console.log(`  ${tableName}: error getting count - ${err}`);
      }
    }

    console.log("");

    // Search for tables/columns containing 'puzzle' or 'lichess'
    const searchResult = await client.query(`
      SELECT 
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND (
        LOWER(table_name) LIKE '%puzzle%' 
        OR LOWER(table_name) LIKE '%lichess%'
        OR LOWER(column_name) LIKE '%puzzle%'
        OR LOWER(column_name) LIKE '%lichess%'
      )
      ORDER BY table_name, ordinal_position
    `);

    console.log(`Tables/columns containing 'puzzle' or 'lichess':`);
    console.log("=".repeat(50));

    if (searchResult.rows.length === 0) {
      console.log("  (none found)");
    } else {
      let currentTable = "";
      for (const row of searchResult.rows) {
        if (row.table_name !== currentTable) {
          currentTable = row.table_name;
          console.log(`\n  Table: ${row.table_name}`);
        }
        console.log(
          `    - ${row.column_name} (${row.data_type})`
        );
      }
    }

    console.log("");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

introspectDatabase();

