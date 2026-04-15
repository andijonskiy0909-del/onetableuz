require('dotenv').config()
const bcrypt = require('bcryptjs')
const db = require('../config/db')
const logger = require('../config/logger')

async function seed() {
  const email = process.env.ADMIN_EMAIL || 'admin@onetable.uz'
  const password = process.env.ADMIN_PASSWORD || 'admin123'

  try {
    const hash = await bcrypt.hash(password, 10)
    await db.query(`
      INSERT INTO admins (full_name, email, password_hash, role, is_active)
      VALUES ('Super Admin', $1, $2, 'superadmin', true)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
    `, [email, hash])

    logger.info(`✅ Admin seeded: ${email} / ${password}`)
    process.exit(0)
  } catch (e) {
    logger.error('Seed error:', e.message)
    process.exit(1)
  }
}

seed()
