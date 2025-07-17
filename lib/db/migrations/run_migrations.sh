#!/bin/bash

# Database Performance Optimization Migration Runner
# This script runs all performance optimization migrations in the correct order

set -e

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-kovachat}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if PostgreSQL is running
check_postgres() {
    print_status "Checking PostgreSQL connection..."
    
    if ! command -v psql &> /dev/null; then
        print_error "PostgreSQL client (psql) is not installed"
        exit 1
    fi
    
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
        print_error "Cannot connect to PostgreSQL at $DB_HOST:$DB_PORT"
        print_error "Please check your database connection settings"
        exit 1
    fi
    
    print_status "PostgreSQL connection successful"
}

# Function to check if pgvector extension is installed
check_pgvector() {
    print_status "Checking pgvector extension..."
    
    if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null 2>&1; then
        print_error "Failed to create pgvector extension"
        print_error "Please install pgvector extension first"
        exit 1
    fi
    
    print_status "pgvector extension is available"
}

# Function to run a migration
run_migration() {
    local migration_file=$1
    local migration_name=$(basename "$migration_file" .sql)
    
    print_status "Running migration: $migration_name"
    
    if [[ -f "$migration_file" ]]; then
        if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration_file"; then
            print_status "✓ Migration $migration_name completed successfully"
        else
            print_error "✗ Migration $migration_name failed"
            exit 1
        fi
    else
        print_error "Migration file not found: $migration_file"
        exit 1
    fi
}

# Function to verify migrations
verify_migrations() {
    print_status "Verifying migrations..."
    
    # Check if key functions exist
    local functions=(
        "search_knowledge_optimized"
        "get_knowledge_base_size"
        "analyze_knowledge_search_performance"
        "refresh_optimization_data"
    )
    
    for func in "${functions[@]}"; do
        if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT proname FROM pg_proc WHERE proname = '$func';" | grep -q "$func"; then
            print_status "✓ Function $func exists"
        else
            print_error "✗ Function $func missing"
            exit 1
        fi
    done
    
    # Check if key indexes exist
    local indexes=(
        "idx_document_chunks_embedding_ivfflat"
        "idx_knowledge_documents_user_id"
        "idx_document_chunks_document_id"
    )
    
    for idx in "${indexes[@]}"; do
        if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT indexname FROM pg_indexes WHERE indexname = '$idx';" | grep -q "$idx"; then
            print_status "✓ Index $idx exists"
        else
            print_warning "Index $idx not found (may be created with different name)"
        fi
    done
    
    print_status "Migration verification completed"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --host HOST      Database host (default: localhost)"
    echo "  -p, --port PORT      Database port (default: 5432)"
    echo "  -d, --database DB    Database name (default: kovachat)"
    echo "  -u, --user USER      Database user (default: postgres)"
    echo "  --password PASS      Database password"
    echo "  --help               Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--host)
            DB_HOST="$2"
            shift 2
            ;;
        -p|--port)
            DB_PORT="$2"
            shift 2
            ;;
        -d|--database)
            DB_NAME="$2"
            shift 2
            ;;
        -u|--user)
            DB_USER="$2"
            shift 2
            ;;
        --password)
            DB_PASSWORD="$2"
            shift 2
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set password in environment if provided
if [[ -n "$DB_PASSWORD" ]]; then
    export PGPASSWORD="$DB_PASSWORD"
fi

# Main execution
main() {
    print_status "Starting database performance optimization migrations..."
    print_status "Target database: $DB_HOST:$DB_PORT/$DB_NAME"
    
    # Pre-flight checks
    check_postgres
    check_pgvector
    
    # Run migrations in order
    local migrations=(
        "001_add_performance_indexes.sql"
        "002_optimized_similarity_search.sql"
        "003_query_optimization_helpers.sql"
    )
    
    for migration in "${migrations[@]}"; do
        run_migration "$migration"
    done
    
    # Verify migrations
    verify_migrations
