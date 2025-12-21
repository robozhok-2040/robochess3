import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function auditDatabase() {
  try {
    console.log('🔍 Auditing stats_snapshots table...\n');

    // Fetch the most recent snapshot
    const latestSnapshot = await prisma.stats_snapshots.findFirst({
      orderBy: { captured_at: 'desc' },
    });

    if (!latestSnapshot) {
      console.log('❌ No snapshots found in the database.');
      return;
    }

    console.log('📊 Most Recent Snapshot Record:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get all keys from the snapshot object
    const keys = Object.keys(latestSnapshot);
    
    // Print all columns with their values
    console.log('Column Name'.padEnd(40) + '│ Value'.padEnd(30) + '│ Type');
    console.log('─'.repeat(40) + '┼' + '─'.repeat(30) + '┼' + '─'.repeat(20));

    for (const key of keys) {
      if (key === 'profiles') continue; // Skip relation field
      
      const value = (latestSnapshot as any)[key];
      const valueStr = value === null ? '(NULL)' : value === undefined ? '(UNDEFINED)' : String(value);
      const valueType = value === null ? 'null' : typeof value;
      
      console.log(key.padEnd(40) + '│ ' + valueStr.padEnd(29) + '│ ' + valueType);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check for null/empty values
    console.log('📋 Analysis:\n');
    
    const nullColumns: string[] = [];
    const zeroColumns: string[] = [];
    const populatedColumns: string[] = [];

    for (const key of keys) {
      if (key === 'profiles' || key === 'id' || key === 'user_id' || key === 'captured_at') continue;
      
      const value = (latestSnapshot as any)[key];
      
      if (value === null || value === undefined) {
        nullColumns.push(key);
      } else if (typeof value === 'number' && value === 0) {
        zeroColumns.push(key);
      } else {
        populatedColumns.push(key);
      }
    }

    console.log(`✅ Populated columns (${populatedColumns.length}):`);
    populatedColumns.forEach(col => {
      const value = (latestSnapshot as any)[col];
      console.log(`   - ${col}: ${value}`);
    });

    console.log(`\n⚠️  Zero-value columns (${zeroColumns.length}):`);
    zeroColumns.forEach(col => {
      console.log(`   - ${col}: 0`);
    });

    console.log(`\n❌ Null/Empty columns (${nullColumns.length}):`);
    nullColumns.forEach(col => {
      console.log(`   - ${col}: NULL`);
    });

    // Check specific fields we're interested in
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🎯 Field Analysis for Rename/Delete Operations:\n');

    const fieldsToCheck = {
      'games_played_24h': (latestSnapshot as any).games_played_24h,
      'games_played_7d': (latestSnapshot as any).games_played_7d,
      'games_played_blitz_24h': (latestSnapshot as any).games_played_blitz_24h,
      'games_played_blitz_7d': (latestSnapshot as any).games_played_blitz_7d,
      'total_games_rapid_lifetime': (latestSnapshot as any).total_games_rapid_lifetime,
      'total_games_blitz_lifetime': (latestSnapshot as any).total_games_blitz_lifetime,
      'games_played_total': (latestSnapshot as any).games_played_total,
    };

    for (const [fieldName, value] of Object.entries(fieldsToCheck)) {
      const status = value === null ? 'NULL (can delete safely)' 
                    : value === 0 ? '0 (can rename/delete if not needed)' 
                    : `HAS DATA: ${value} (must preserve!)`;
      console.log(`   ${fieldName.padEnd(35)}: ${status}`);
    }

    // Count total records
    const totalCount = await prisma.stats_snapshots.count();
    console.log(`\n📊 Total snapshots in database: ${totalCount}`);

  } catch (error) {
    console.error('❌ Error auditing database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

auditDatabase();

