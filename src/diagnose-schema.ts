import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseSchema() {
  try {
    console.log('🔍 Database Schema Diagnosis\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Try to fetch a record and inspect its structure
    const sample = await prisma.stats_snapshots.findFirst({
      orderBy: { captured_at: 'desc' },
      include: {
        profiles: {
          select: {
            id: true,
            username: true,
          }
        }
      }
    });

    if (!sample) {
      console.log('❌ No records found in stats_snapshots table.');
      console.log('✅ Table exists but is empty.');
      return;
    }

    console.log('📊 Sample Record Structure:\n');
    console.log('Column Name'.padEnd(40) + '│ Value'.padEnd(30) + '│ Type');
    console.log('─'.repeat(40) + '┼' + '─'.repeat(30) + '┼' + '─'.repeat(20));

    const keys = Object.keys(sample).filter(k => k !== 'profiles');
    
    for (const key of keys) {
      const value = (sample as any)[key];
      const valueStr = value === null ? '(NULL)' : value === undefined ? '(UNDEFINED)' : String(value);
      const valueType = value === null ? 'null' : typeof value;
      
      console.log(key.padEnd(40) + '│ ' + valueStr.substring(0, 29).padEnd(29) + '│ ' + valueType);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test relation
    console.log('🔗 Relation Check (user_id -> profiles):\n');
    if (sample.profiles) {
      console.log(`✅ Relation working! Connected to profile: ${sample.profiles.username || sample.profiles.id}`);
    } else {
      console.log(`⚠️  Relation not loaded or broken. user_id: ${sample.user_id}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Count records
    const count = await prisma.stats_snapshots.count();
    console.log(`📊 Total records in stats_snapshots: ${count}\n`);

    // List all column names from the actual database structure
    console.log('📋 Actual Database Columns (from Prisma introspection):\n');
    const allKeys = Object.keys(sample).filter(k => k !== 'profiles');
    allKeys.forEach(key => {
      console.log(`   - ${key}`);
    });

  } catch (error: any) {
    console.error('❌ Error during diagnosis:', error.message);
    if (error.message.includes('Unknown column')) {
      console.error('\n⚠️  This suggests the database schema does not match Prisma schema!');
    }
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseSchema();

