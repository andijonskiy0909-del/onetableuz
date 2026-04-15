# OneTable v3.0 — Restaurant Reservation Platform

## 📁 Project Structure

```
onetable/
├── backend/
│   ├── src/
│   │   ├── app.js                    ← Main server entry
│   │   ├── config/
│   │   │   ├── db.js                 ← PostgreSQL pool
│   │   │   └── logger.js             ← Colored logger
│   │   ├── middleware/
│   │   │   ├── auth.js               ← User/Owner/Admin JWT auth
│   │   │   ├── errorHandler.js       ← Centralized error handler
│   │   │   └── security.js           ← Rate limit, XSS, headers
│   │   ├── utils/
│   │   │   ├── jwt.js                ← JWT sign/verify
│   │   │   ├── AppError.js           ← Custom error class
│   │   │   ├── asyncHandler.js       ← Async route wrapper
│   │   │   └── seed.js               ← Admin seeder
│   │   ├── services/
│   │   │   └── bookingService.js     ← Core booking logic
│   │   ├── controllers/
│   │   │   ├── authController.js     ← Telegram/Owner/Admin login
│   │   │   ├── restaurantController.js ← Public restaurant API
│   │   │   ├── reservationController.js ← Booking API
│   │   │   ├── reviewController.js   ← Reviews API
│   │   │   ├── uploadController.js   ← File upload API
│   │   │   ├── ownerController.js    ← Dashboard API (50+ methods)
│   │   │   └── adminController.js    ← Admin panel API
│   │   └── routes/
│   │       ├── index.js              ← Route combiner
│   │       ├── auth.js
│   │       ├── restaurants.js
│   │       ├── reservations.js
│   │       ├── reviews.js
│   │       ├── uploads.js
│   │       ├── owner.js
│   │       └── admin.js
│   ├── uploads/                      ← Runtime file storage
│   ├── schema.sql                    ← Full database schema
│   ├── package.json
│   └── .env.example
├── bot/
│   ├── index.js                      ← Telegram bot
│   └── package.json
└── webapp/
    ├── index.html                    ← Mini App (your existing file)
    ├── dashboard.html                ← Owner dashboard (your existing file)
    └── admin.html                    ← Admin panel (NEW)
```

## 🚀 Quick Start (Local)

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 2. Setup Database
```bash
createdb onetable
```

### 3. Install & Configure
```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, BOT_TOKEN
npm install
```

### 4. Seed Admin
```bash
# Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first
npm run seed
```

### 5. Start Server
```bash
npm start
# or for development:
npm run dev
```

### 6. Access
- API: http://localhost:3000/api
- Dashboard: http://localhost:3000/dashboard
- Admin: http://localhost:3000/admin
- Mini App: http://localhost:3000/app
- Health: http://localhost:3000/health

## 🚂 Railway Deployment

### 1. Push to GitHub

### 2. Railway Setup
- Create new project → Deploy from GitHub
- Add PostgreSQL addon
- Set environment variables:
  ```
  DATABASE_URL     → from Postgres addon
  JWT_SECRET       → random 48+ char string
  BOT_TOKEN        → from @BotFather
  WEBHOOK_URL      → https://your-app.up.railway.app
  WEBAPP_URL       → https://your-app.up.railway.app/app
  API_URL          → https://your-app.up.railway.app/api
  NODE_ENV         → production
  ADMIN_EMAIL      → admin@onetable.uz
  ADMIN_PASSWORD   → your_secure_password
  ```
- Start command: `cd backend && npm install && npm run seed && npm start`

### 3. BotFather Setup
```
/setmenubutton → https://your-app.up.railway.app/app
```

## 📡 API Endpoints

### Auth
- `POST /api/auth/telegram` — Mini App login
- `POST /api/auth/admin/login` — Admin login
- `POST /api/owner/register` — Owner register
- `POST /api/owner/login` — Owner login

### Public (Restaurants)
- `GET /api/restaurants` — List (with search, filter, geo)
- `GET /api/restaurants/reels` — Reels feed
- `GET /api/restaurants/:id` — Single restaurant
- `GET /api/restaurants/:id/menu` — Menu
- `GET /api/restaurants/:id/zones` — Zones
- `GET /api/restaurants/:id/reviews` — Reviews
- `GET /api/restaurants/:id/availability?date=` — Busy times

### Reservations (auth required)
- `POST /api/reservations` — Create booking
- `GET /api/reservations/my` — My bookings
- `DELETE /api/reservations/:id` — Cancel

### Reviews
- `POST /api/reviews` — Create review

### Uploads (owner auth)
- `POST /api/uploads/image` — Upload image
- `POST /api/uploads/images` — Multiple images
- `POST /api/uploads/video` — Upload video
- `DELETE /api/uploads/:filename` — Delete file

### Owner Dashboard (owner auth)
- `GET /api/owner/restaurant` — Get restaurant + owner
- `POST /api/owner/restaurants` — Create restaurant
- `PUT /api/owner/restaurant` — Update restaurant
- `PUT /api/owner/restaurant/location` — Set coordinates
- Full CRUD for: menu, zones, tables, reels, reviews
- `GET /api/owner/analytics` — Dashboard stats
- `GET/POST /api/owner/premium` — Premium management
- `GET /api/owner/notifications` — Notifications

### Admin (admin auth)
- `GET /api/admin/stats` — Platform statistics
- Full management for: users, owners, restaurants, bookings, reviews
- `PUT /api/admin/restaurants/:id/approve` — Approve
- `PUT /api/admin/restaurants/:id/reject` — Reject
- `PUT /api/admin/restaurants/:id/premium` — Toggle premium
- `GET/PUT /api/admin/premium-requests` — Process premium

## 🔒 Security Features
- JWT with role-based auth (user/owner/admin)
- Rate limiting (200/min API, 20/15min auth)
- XSS protection
- Input sanitization
- File type/size validation
- Security headers
- Centralized error handling (no stack trace leaks)

## 📊 Database Features
- 14 tables with proper foreign keys
- Indexes on all query columns
- Auto-updating timestamps via triggers
- CHECK constraints on enums
- Unique constraints preventing duplicates
- Cascading deletes

## ⚡ Booking Logic
- Transaction-based table assignment
- Double-booking prevention
- Automatic table selection (smallest fitting)
- Zone fallback (if zone full, try other zones)
- Alternative time suggestions
- 30-minute expiration for pending bookings
- Auto-completion of past confirmed bookings
- Pre-order total calculation
- Deposit support
