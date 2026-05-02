# hacaton-backend

Backend for the hacaton project.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database

### Installation

1. Clone the repository
```bash
git clone https://github.com/TriphoyFLX/hacaton-backend.git
cd hacaton-backend
```

2. Install dependencies
```bash
npm install
```

3. Setup database

**Option A: Docker (Recommended)**
```bash
docker-compose up -d postgres
```

**Option B: Local PostgreSQL**
```bash
# Install PostgreSQL locally if not already installed
# Create database
createdb hacaton_db
```

4. Configure environment
```bash
cp .env.example .env
# Edit .env with your database settings
```

5. Run database migrations
```bash
npx prisma migrate dev
npx prisma generate
```

6. Start the server
```bash
npm run dev
```

The server will run on http://localhost:5002

## API Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Health check endpoint
