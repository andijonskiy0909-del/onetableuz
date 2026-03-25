# OneTable Production Deployment

## Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL 15+ (or use Docker)

## Setup

1. Clone repository
2. Copy `.env.example` to `.env` and fill in your secrets
3. Run migrations and seed:
   ```bash
   npm run migrate
   npm run seed
