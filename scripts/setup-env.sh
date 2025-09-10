#!/bin/bash

# BMAD Platform Environment Setup Script
# Copies .env.example files to .env.local for easy development setup

set -e

echo "🔧 BMAD Platform Environment Setup"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Setting up environment files...${NC}"

# Root environment file
if [ -f ".env.example" ]; then
    if [ ! -f ".env.local" ]; then
        cp .env.example .env.local
        echo -e "${GREEN}✅ Created .env.local from .env.example${NC}"
    else
        echo -e "${YELLOW}⚠️  .env.local already exists, skipping root env file${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  .env.example not found in root directory${NC}"
fi

# API package environment file
if [ -f "packages/api/.env.example" ]; then
    if [ ! -f "packages/api/.env.local" ]; then
        cp packages/api/.env.example packages/api/.env.local
        echo -e "${GREEN}✅ Created packages/api/.env.local${NC}"
    else
        echo -e "${YELLOW}⚠️  packages/api/.env.local already exists, skipping${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  packages/api/.env.example not found${NC}"
fi

# Web package environment file
if [ -f "packages/web/.env.example" ]; then
    if [ ! -f "packages/web/.env.local" ]; then
        cp packages/web/.env.example packages/web/.env.local
        echo -e "${GREEN}✅ Created packages/web/.env.local${NC}"
    else
        echo -e "${YELLOW}⚠️  packages/web/.env.local already exists, skipping${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  packages/web/.env.example not found${NC}"
fi

# Realtime package environment file
if [ -f "packages/realtime/.env.example" ]; then
    if [ ! -f "packages/realtime/.env.local" ]; then
        cp packages/realtime/.env.example packages/realtime/.env.local
        echo -e "${GREEN}✅ Created packages/realtime/.env.local${NC}"
    else
        echo -e "${YELLOW}⚠️  packages/realtime/.env.local already exists, skipping${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  packages/realtime/.env.example not found${NC}"
fi

# Test environment file
if [ -f "packages/api/.env.test.example" ]; then
    if [ ! -f "packages/api/.env.test" ]; then
        cp packages/api/.env.test.example packages/api/.env.test
        echo -e "${GREEN}✅ Created packages/api/.env.test${NC}"
    else
        echo -e "${YELLOW}⚠️  packages/api/.env.test already exists, skipping${NC}"
    fi
fi

echo ""
echo -e "${GREEN}🎉 Environment setup complete!${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo "1. Update the .env.local files with your actual values"
echo "2. Set up required external services:"
echo "   • OpenAI API key: https://platform.openai.com"
echo "   • Anthropic API key: https://console.anthropic.com" 
echo "   • Stripe account: https://dashboard.stripe.com"
echo "   • PostgreSQL and Redis databases"
echo "3. Run 'npm install' to install dependencies"
echo "4. Run 'npm run dev' to start the development server"
echo ""
echo -e "${YELLOW}💡 Important:${NC}"
echo "• Never commit .env.local files to version control"
echo "• Use strong secrets (minimum 32 characters for JWT/session keys)"
echo "• Set up billing alerts on paid services like OpenAI"
echo "• Enable 2FA on all external service accounts"
echo ""
echo -e "${BLUE}📖 For detailed configuration help, see:${NC}"
echo "• README.md - Complete setup guide"
echo "• docs/testing/ - Testing configuration"
echo "• Each .env.local file has detailed comments"