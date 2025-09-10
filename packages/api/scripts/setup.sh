#!/bin/bash

# BMAD API Setup Script
set -e

echo "🚀 Setting up BMAD API..."

# Check if required commands exist
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }

echo "✅ Node.js and npm are available"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo "✅ Dependencies installed successfully"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Copying from .env.example..."
    cp .env.example .env
    echo "📝 Please update .env with your actual configuration values"
else
    echo "✅ .env file exists"
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npm run db:generate

echo "✅ Prisma client generated successfully"

# Check database connection (optional)
if [ "$1" = "--with-db" ]; then
    echo "🔍 Testing database connection..."
    npm run db:migrate || echo "⚠️  Database migration failed. Make sure PostgreSQL is running and configured."
fi

# Check Redis connection (optional) 
if [ "$1" = "--with-redis" ]; then
    echo "🔍 Testing Redis connection..."
    node -e "
    const { testRedisConnection } = require('./dist/utils/redis');
    testRedisConnection().then(result => {
        if (result) {
            console.log('✅ Redis connection successful');
        } else {
            console.log('⚠️  Redis connection failed. Make sure Redis is running.');
            process.exit(1);
        }
    }).catch(() => {
        console.log('⚠️  Redis connection failed. Make sure Redis is running.');
        process.exit(1);
    });
    " 2>/dev/null || echo "⚠️  Redis connection test failed."
fi

echo "🎉 BMAD API setup completed successfully!"
echo "📚 Next steps:"
echo "   1. Update .env with your configuration"
echo "   2. Start PostgreSQL and Redis services"
echo "   3. Run 'npm run dev' to start the development server"