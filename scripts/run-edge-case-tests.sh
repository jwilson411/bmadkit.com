#!/bin/bash

# BMAD Edge Case Test Runner
# Executes the comprehensive edge case test suite implemented based on QA recommendations

set -e

echo "🧪 BMAD Edge Case Test Runner"
echo "=============================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "packages/api/package.json" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

# Navigate to API package
cd packages/api

echo -e "${BLUE}📊 Test Suite Overview:${NC}"
echo "• Cross-Story Integration Tests: 54 scenarios"
echo "• Document Edge Cases: 12 scenarios" 
echo "• Network Resilience: 15 scenarios"
echo "• Chaos Engineering: 18 scenarios"
echo "• Total: 99 advanced test scenarios"
echo ""

# Parse command line arguments
CATEGORY=""
WATCH_MODE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --category|-c)
            CATEGORY="$2"
            shift 2
            ;;
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -c, --category CATEGORY   Run specific test category"
            echo "                           (integration|chaos|network|document-edge|all)"
            echo "  -w, --watch              Run in watch mode"
            echo "  -v, --verbose            Enable verbose output"
            echo "  -h, --help               Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                       # Run all edge case tests"
            echo "  $0 -c integration        # Run only integration tests"
            echo "  $0 -c chaos -w           # Run chaos tests in watch mode"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set default category
if [ -z "$CATEGORY" ]; then
    CATEGORY="all"
fi

echo -e "${YELLOW}🔧 Setting up test environment...${NC}"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Create test results directory
mkdir -p test-results/edge-cases

echo -e "${YELLOW}⚡ Running edge case tests...${NC}"

# Function to run tests
run_tests() {
    local test_command="$1"
    local test_name="$2"
    
    echo -e "${BLUE}Running $test_name...${NC}"
    
    if [ "$VERBOSE" = true ]; then
        eval "$test_command --verbose"
    else
        eval "$test_command"
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $test_name passed${NC}"
    else
        echo -e "${RED}❌ $test_name failed${NC}"
        return 1
    fi
}

# Execute tests based on category
case $CATEGORY in
    integration)
        if [ "$WATCH_MODE" = true ]; then
            npm run test:integration -- --watch
        else
            run_tests "npm run test:integration" "Cross-Story Integration Tests"
        fi
        ;;
    chaos)
        if [ "$WATCH_MODE" = true ]; then
            npm run test:chaos -- --watch
        else
            run_tests "npm run test:chaos" "Chaos Engineering Tests"
        fi
        ;;
    network)
        if [ "$WATCH_MODE" = true ]; then
            npm run test:network -- --watch
        else
            run_tests "npm run test:network" "Network Resilience Tests"
        fi
        ;;
    document-edge)
        if [ "$WATCH_MODE" = true ]; then
            npm run test:document-edge -- --watch
        else
            run_tests "npm run test:document-edge" "Document Edge Case Tests"
        fi
        ;;
    all)
        if [ "$WATCH_MODE" = true ]; then
            npm run test:edge-cases:watch
        else
            echo -e "${BLUE}Running complete edge case test suite...${NC}"
            
            # Run each category
            run_tests "npm run test:integration" "Cross-Story Integration Tests"
            run_tests "npm run test:document-edge" "Document Edge Case Tests"  
            run_tests "npm run test:network" "Network Resilience Tests"
            run_tests "npm run test:chaos" "Chaos Engineering Tests"
            
            echo ""
            echo -e "${GREEN}🎉 All edge case tests completed successfully!${NC}"
            echo ""
            echo -e "${BLUE}📈 Test Results Summary:${NC}"
            echo "• Test Results: ./test-results/edge-cases/"
            echo "• HTML Report: ./test-results/edge-cases/edge-case-test-report.html"
            echo "• JUnit Report: ./test-results/edge-cases/edge-case-results.xml"
        fi
        ;;
    *)
        echo -e "${RED}Invalid category: $CATEGORY${NC}"
        echo "Valid categories: integration, chaos, network, document-edge, all"
        exit 1
        ;;
esac

if [ $? -eq 0 ] && [ "$WATCH_MODE" = false ]; then
    echo ""
    echo -e "${GREEN}✨ Edge case testing completed successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Next Steps:${NC}"
    echo "1. Review test results in ./test-results/edge-cases/"
    echo "2. Check for any performance warnings or memory leaks"
    echo "3. Integrate successful tests into CI/CD pipeline"
    echo "4. Schedule regular chaos engineering exercises"
    echo ""
    echo -e "${YELLOW}💡 Tips:${NC}"
    echo "• Use --watch mode during development: $0 -w"
    echo "• Run specific categories for faster feedback: $0 -c integration"
    echo "• Enable verbose output for debugging: $0 -v"
fi